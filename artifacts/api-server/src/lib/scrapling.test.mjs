import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchApprovedWithScrapling, planScraplingTargets, SCRAPLING_LIMITS } from "./scrapling.ts";

const source = "Energy Magazine";
const url = "https://www.energymagazine.com.au/?s=solar+project";
const env = { SCRAPLING_ENABLED: "true", SCRAPLING_SOURCES: source };
const failed = { method: "html", url, outcome: "parse-failed", failureCategory: "parser" };
const page = { html: "<article>Example Solar Farm 50 MW proposed</article>", url, status: 200, contentType: "text/html" };

test("opt-in transport only repairs failed exact public URLs", () => {
  assert.deepEqual(planScraplingTargets(source, [failed], {}), []);
  assert.deepEqual(planScraplingTargets(source, [failed], env), [url]);
  assert.deepEqual(planScraplingTargets(source, [failed, { ...failed, outcome: "success-zero-results" }], env), []);
  assert.deepEqual(planScraplingTargets(source, [{ ...failed, url: "https://example.com/" }], env), []);
  for (const failureCategory of ["blocked", "rate-limited", "auth-failed"]) {
    assert.deepEqual(planScraplingTargets(source, [failed, { ...failed, failureCategory }], env), []);
  }
  assert.deepEqual(planScraplingTargets(source, [{ ...failed, url: "https://www.energymagazine.com.au/feed/" }], env), []);
  assert.deepEqual(planScraplingTargets("NZ Fast-track", [{ ...failed, url: "https://www.fasttrack.govt.nz/projects/" }],
    { ...env, SCRAPLING_SOURCES: "NZ Fast-track" }), []);
});

test("valid content retains provenance and never accepts unsafe redirects", async () => {
  assert.deepEqual(await fetchApprovedWithScrapling(source, url, "http", async () => JSON.stringify(page)), page);
  for (const final of ["http://www.energymagazine.com.au/", "https://127.0.0.1/", "https://other.example/", "https://user@www.energymagazine.com.au/", "https://www.energymagazine.com.au:8443/"]) {
    await assert.rejects(fetchApprovedWithScrapling(source, url, "http", async () => JSON.stringify({ ...page, url: final })));
  }
  let called = false;
  await assert.rejects(fetchApprovedWithScrapling(source, "https://other.example/", "http", async () => { called = true; return "{}"; }));
  assert.equal(called, false);
});

test("blocked, malformed, oversized, missing runtime and timeout responses preserve fallback", async () => {
  for (const overrides of [{ status: 429 }, { status: 401 }, { status: 403 }, { html: "Just a moment cf-chl-" },
    { html: "" }, { html: "x".repeat(SCRAPLING_LIMITS.maxBytes + 1) }, { status: "200" }]) {
    await assert.rejects(fetchApprovedWithScrapling(source, url, "http", async () => JSON.stringify({ ...page, ...overrides })));
  }
  await assert.rejects(fetchApprovedWithScrapling(source, url, "http", async () => "invalid json"));
  for (const message of ["Scrapling runtime unavailable", "Scrapling timed out"]) {
    await assert.rejects(fetchApprovedWithScrapling(source, url, "http", async () => { throw new Error(message); }), new RegExp(message));
  }
});

test("real subprocess protocol excludes application secrets and bounds concurrent workers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "usst-scrapling-test-"));
  const script = join(directory, "fixture.cjs");
  const old = { SCRAPLING_PYTHON: process.env.SCRAPLING_PYTHON, SCRAPLING_SCRIPT: process.env.SCRAPLING_SCRIPT,
    SCRAPLING_TEST_SECRET: process.env.SCRAPLING_TEST_SECRET };
  try {
    await writeFile(script, `let input=''; process.stdin.on('data', c => input+=c); process.stdin.on('end', () => {
      const request=JSON.parse(input);
      setTimeout(() => console.log(JSON.stringify({html:'<article>No projects found</article>',url:request.url,
        status:process.env.SCRAPLING_TEST_SECRET ? 401 : 200,contentType:'text/html'})), 50);
    });`);
    process.env.SCRAPLING_PYTHON = process.execPath;
    process.env.SCRAPLING_SCRIPT = script;
    process.env.SCRAPLING_TEST_SECRET = "fixture-secret-never-forward";
    const first = fetchApprovedWithScrapling(source, url, "http");
    await assert.rejects(fetchApprovedWithScrapling(source, url, "http"), /worker busy/);
    assert.equal((await first).status, 200);
    assert.equal((await fetchApprovedWithScrapling(source, url, "http")).status, 200);
    process.env.SCRAPLING_PYTHON = join(directory, "does-not-exist");
    await assert.rejects(fetchApprovedWithScrapling(source, url, "http"), /runtime unavailable/);
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
