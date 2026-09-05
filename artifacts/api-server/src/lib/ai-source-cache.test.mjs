import assert from "node:assert/strict";
import test from "node:test";
import {
  aiSourceCacheKey, cachedSourceFallback, hashMeaningfulSourceContent,
  hashSourceContent, normaliseSourceContent,
} from "./ai-source-cache.ts";
import { parseSourceFallbackArray } from "./source-access-outcome.ts";

// A deterministic SQL-client double. Schema constraints are also verified on
// Postgres separately; this tests application read-through and locking behavior.
class CacheDatabase {
  rows = new Map();
  locks = new Map();
  clock = 0;
  released = 0;
  async connect() {
    let unlock, pending;
    const db = this;
    return {
      async query(sql, values = []) {
        if (sql === "BEGIN" || sql.startsWith("SET LOCAL")) return { rows: [] };
        if (sql.startsWith("SELECT pg_advisory_xact_lock")) {
          const previous = db.locks.get(values[0]) ?? Promise.resolve();
          let resolve;
          const next = new Promise(r => { resolve = r; });
          db.locks.set(values[0], next);
          await previous;
          unlock = resolve;
          return { rows: [] };
        }
        if (sql.startsWith("SELECT result_json")) {
          const row = db.rows.get(values[0]);
          return { rows: row && row.expires > db.clock ? [{ result_json: structuredClone(row.result) }] : [] };
        }
        if (sql.startsWith("UPDATE public.ai_source_fallback_cache")) {
          db.rows.get(values[0]).lastUsed = db.clock;
          return { rows: [] };
        }
        if (sql.startsWith("INSERT INTO")) {
          assert.match(sql, /ON CONFLICT \(cache_key\) DO UPDATE/);
          const result = JSON.parse(values[9]);
          assert.equal(values[10], result.length);
          pending = [values[0], { result, expires: values[11] ? Number.POSITIVE_INFINITY : db.clock + 6 * 3600000, lastUsed: db.clock }];
          return { rows: [] };
        }
        if (sql === "COMMIT" || sql === "ROLLBACK") {
          if (sql === "COMMIT" && pending) db.rows.set(...pending);
          unlock?.(); unlock = undefined;
          return { rows: [] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      release() { db.released++; },
    };
  }
}
const identity = { sourceName: "ARENA", sourceUrl: "https://arena.gov.au/news/", contentHash: hashSourceContent("page one"), contentObserved: true, startDate: "2026-08-01", endDate: "2026-08-31", model: "gpt-5.6-luna", promptHash: hashSourceContent("prompt") };
const validate = value => parseSourceFallbackArray(JSON.stringify(value));
const sample = [{ name: "River Solar Farm", capacity_mw: 50, country: "AU" }];

test("meaningful source hashing ignores presentation noise but detects project changes", () => {
  const first = `<!doctype html><!-- generated at 1 -->
    <html><head><meta name="csrf-token" content="secret-one"><style>.card { color: red }</style>
    <script nonce="secret-two">window.build = "one"</script></head>
    <body><article>River Solar Farm &nbsp; 50 MW</article>
    <a class="project" href="/river?utm_source=mail&stage=planning&sessionToken=secret-three#top">Details</a></body></html>`;
  const formattingOnly = `<html><head><style>.card{color:blue}</style></head><body>
    <article> River Solar Farm 50 MW </article>
    <a href='/river?stage=planning&utm_source=other'>Details</a></body></html>`;
  const changed = formattingOnly.replace("50 MW", "60 MW");
  assert.equal(hashMeaningfulSourceContent(first), hashMeaningfulSourceContent(formattingOnly));
  assert.notEqual(hashMeaningfulSourceContent(first), hashMeaningfulSourceContent(changed));
  assert.doesNotMatch(normaliseSourceContent(first), /secret-one|secret-two|secret-three|generated at 1|window\.build/);
  assert.equal(
    hashMeaningfulSourceContent('{"projects":[{"capacity":50,"name":"River"}],"sessionToken":"one"}'),
    hashMeaningfulSourceContent('{ "sessionToken":"two", "projects":[{"name":"River","capacity":50}] }'),
  );
});

test("normalised content controls cache reuse for result and empty entries", async () => {
  for (const result of [sample, []]) {
    const db = new CacheDatabase(); let calls = 0;
    const read = (content) => cachedSourceFallback(db,
      { ...identity, contentHash: hashMeaningfulSourceContent(content) },
      async () => { calls++; return result; }, validate, () => {});
    await read("<article>River Solar Farm 50 MW</article>");
    db.clock += 7 * 3600000;
    await read("<article>  River Solar Farm\n50 MW </article><!-- build noise -->");
    assert.equal(calls, 1);
    await read("<article>River Solar Farm 60 MW</article>");
    assert.equal(calls, 2);
  }
});

test("cache miss calls AI once, saves result, then identical hit avoids AI and touches usage", async () => {
  const db = new CacheDatabase(), events = [];
  let calls = 0;
  const load = async () => { calls++; return sample; };
  const read = () => cachedSourceFallback(db, identity, load, validate, (event, fields) => events.push({ event, ...fields }));
  assert.deepEqual(await read(), sample);
  db.clock = 100;
  assert.deepEqual(await read(), sample);
  assert.equal(calls, 1);
  assert.equal(db.rows.size, 1);
  assert.equal(db.rows.get(aiSourceCacheKey(identity)).lastUsed, 100);
  assert.deepEqual(events.map(e => e.event), ["ai_source_cache_miss", "ai_source_cache_write", "ai_source_cache_hit"]);
});

test("successful empty arrays are cached, reused and explicitly logged", async () => {
  const db = new CacheDatabase(), events = [];
  let calls = 0;
  for (let i = 0; i < 2; i++) assert.deepEqual(await cachedSourceFallback(db, identity, async () => { calls++; return []; }, validate, event => events.push(event)), []);
  assert.equal(calls, 1);
  assert.equal(db.rows.size, 1);
  assert.equal(events.filter(e => e === "ai_source_cache_empty_result").length, 2);
});

test("content, source, URL, dates, model, prompt and version prevent inappropriate reuse", async () => {
  const db = new CacheDatabase(); let calls = 0;
  for (const change of [{}, { contentHash: hashSourceContent("page two") }, { sourceName: "Other" }, { sourceUrl: "https://arena.gov.au/projects/" }, { startDate: "2026-08-02" }, { endDate: "2026-08-30" }, { model: "other" }, { promptHash: "changed" }, { version: 3 }]) {
    await cachedSourceFallback(db, { ...identity, ...change }, async () => { calls++; return sample; }, validate, () => {});
  }
  assert.equal(calls, 9);
  assert.equal(db.rows.size, 9);
  assert.notEqual(aiSourceCacheKey({ ...identity, startDate: undefined }), aiSourceCacheKey(identity));
});

test("concurrent connections share one effective entry and one paid request", async () => {
  const db = new CacheDatabase(); let calls = 0;
  const load = async () => { calls++; await new Promise(r => setTimeout(r, 10)); return sample; };
  const results = await Promise.all(Array.from({ length: 8 }, () => cachedSourceFallback(db, identity, load, validate, () => {})));
  assert.ok(results.every(result => JSON.stringify(result) === JSON.stringify(sample)));
  assert.equal(calls, 1);
  assert.equal(db.rows.size, 1);
  assert.equal(db.released, 8);
});

test("expired entries refresh without creating another row", async () => {
  const db = new CacheDatabase(); let calls = 0;
  const read = () => cachedSourceFallback(db, { ...identity, contentObserved: false }, async () => { calls++; return []; }, validate, () => {});
  await read(); db.clock += 6 * 3600000 + 1; await read();
  assert.equal(calls, 2); assert.equal(db.rows.size, 1);
});

test("AI errors, malformed arrays and corrupt cached rows are never saved as empty success", async () => {
  const db = new CacheDatabase();
  await assert.rejects(cachedSourceFallback(db, identity, async () => { throw new Error("AI unavailable"); }, validate, () => {}));
  await assert.rejects(cachedSourceFallback(db, identity, async () => [null], validate, () => {}));
  assert.equal(db.rows.size, 0);
  db.rows.set(aiSourceCacheKey(identity), { result: "corrupt", expires: 100 });
  let calls = 0;
  await assert.rejects(cachedSourceFallback(db, identity, async () => { calls++; return []; }, validate, () => {}));
  assert.equal(calls, 0);
});

test("cache database unavailability does not silently trigger uncached paid work", async () => {
  let calls = 0;
  await assert.rejects(cachedSourceFallback({ connect: async () => { throw new Error("DB unavailable"); } }, identity, async () => { calls++; return []; }, validate, () => {}));
  assert.equal(calls, 0);
});
