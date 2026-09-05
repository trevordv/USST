import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { isEligibleScanProject } from "./project-eligibility.ts";
import { parseSourceFallbackArray } from "./source-access-outcome.ts";
import { getSourceRepairStrategy } from "./source-repair-strategies.ts";
import { hashSourceContent } from "./ai-source-cache.ts";

// Execute the production fallback body, substituting only its SDK import.
// This avoids importing the DB-backed scanner or making paid/network requests.
const scraper = await readFile(new URL("./scraper.ts", import.meta.url), "utf8");
const start = scraper.indexOf("async function scrapeWithChatGpt(");
const end = scraper.indexOf("// ── Per-source scrape", start);
assert.ok(start >= 0 && end > start);
const body = scraper.slice(start, end);
const sdkImport = 'import("@workspace/integrations-openai-ai-server")';
assert.equal(body.split(sdkImport).length, 2);
const compiled = stripTypeScriptTypes(body.replace(sdkImport, "loadOpenAi()"));

const source = { name: "NSW Planning Portal", searchUrl: "https://www.planningportal.nsw.gov.au/major-projects/projects", country: "AU" };
const project = {
  name: "River Solar Farm", description: "Proposed utility-scale solar farm",
  capacity_mw: 50, country: "AU", status: "announced",
  source_url: "https://www.planningportal.nsw.gov.au/major-projects/project/river",
  announced_date: "2026-08-15",
};

async function extract(rows, selectedSource = source, outputText = JSON.stringify(rows), cacheResults) {
  const requests = [];
  const gated = [];
  let responded = false;
  const fallback = new Function("cachedSourceFallback", "pool", "hashSourceContent", "loadOpenAi", "process", "logger", "logScanSourceOutcome", "getSourceRepairStrategy", "parseSourceFallbackArray", "isEligibleScanProject", "runOpenAiEscalation", "OpenAiQualityError", "recordOpenAiCacheHit",
    `${compiled}\nreturn scrapeWithChatGpt;`)(
    async (_pool, _key, load, validate) => validate(cacheResults === undefined ? await load() : cacheResults),
    {}, hashSourceContent,
    async () => ({ openai: { responses: { create: async (request) => {
      requests.push(request); responded = true;
      return { output_text: outputText };
    } } } }),
    { env: { OPENAI_API_KEY: "mock-only" } }, { info() {}, warn() {} }, () => {},
    getSourceRepairStrategy, parseSourceFallbackArray,
    (candidate) => { assert.ok(responded || cacheResults !== undefined); gated.push(candidate); return isEligibleScanProject(candidate); },
    async options => options.validate(await options.request("gpt-5.6-luna", 1), "gpt-5.6-luna"),
    class OpenAiQualityError extends Error { constructor(reason, message) { super(message); this.reason = reason; } },
    async () => {},
  );
  const results = await fallback(selectedSource, "2026-08-01", "2026-08-31");
  return { results, requests, gated };
}

test("source fallback requests Luna with unchanged web-search and JSON contract", async () => {
  const { requests, results } = await extract([project]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, "gpt-5.6-luna");
  assert.deepEqual(requests[0].tools, [{ type: "web_search_preview" }]);
  assert.equal(requests[0].max_output_tokens, 2500);
  assert.match(requests[0].input, /Return ONLY a valid compact JSON array/);
  assert.match(requests[0].input, /No prose, no markdown fences, no chain-of-thought or reasoning/);
  assert.match(requests[0].input, /Include only these parser fields: name, description, capacity_mw, developer, location, country, status, source_url, announced_date\./);
  assert.match(requests[0].input, /avoid repeating source text/);
  assert.match(requests[0].input, /Return \[\] when no valid projects are found/);
  assert.match(requests[0].input, /Search and cite ONLY these approved official hostnames: www\.planningportal\.nsw\.gov\.au/);
  assert.deepEqual(Object.keys(results[0]).sort(), ["name", "description", "capacityMw", "developer", "location", "country", "status", "sourceUrl", "sourceName", "announcedDate", "contactName", "contactEmail", "contactPhone"].sort());
  // Other model callers (including contact work) must not be switched.
  assert.doesNotMatch(scraper.slice(0, start) + scraper.slice(end), /gpt-5\.6-luna/);
});

test("shared eligibility gate runs after the AI response and rejects BESS and wind", async () => {
  const { results, gated } = await extract([
    project,
    { ...project, name: "River Battery", description: "Standalone BESS" },
    { ...project, name: "River Wind Farm", description: "Wind turbine project" },
    { ...project, name: "Unknown Solar", capacity_mw: null },
  ]);
  assert.equal(gated.length, 4);
  assert.deepEqual(results.map(r => r.name), [project.name]);
});

test("source fallback rejects AI capacities below 5 MW", async () => {
  for (const capacity_mw of [0, 1, 4.99]) {
    assert.deepEqual((await extract([{ ...project, capacity_mw }])).results, []);
  }
  assert.equal((await extract([{ ...project, capacity_mw: 5 }])).results.length, 1);
});

test("source fallback rejects invalid or missing AI countries instead of coercing to AU", async () => {
  for (const country of ["US", "GB", "", null, undefined]) {
    assert.deepEqual((await extract([{ ...project, country }])).results, []);
  }
  for (const country of ["AU", "NZ"]) {
    assert.equal((await extract([{ ...project, country }])).results[0].country, country);
  }
});

test("source fallback preserves date filtering and official URL restrictions", async () => {
  const { results } = await extract([
    { ...project, announced_date: "2026-07-31" },
    { ...project, announced_date: "2026-09-01" },
    { ...project, source_url: "https://www.planningportal.nsw.gov.au.evil.example/project" },
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].sourceUrl, source.searchUrl);
  assert.equal(results[0].announcedDate, project.announced_date);
});

test("source fallback rejects unapproved source configuration before the AI call", async () => {
  await assert.rejects(extract([project], { ...source, name: "Unapproved Site" }), /No source repair strategy/);
});

test("source fallback parses compact JSON without changing field values", async () => {
  const raw = JSON.stringify([{ ...project, developer: "Solar Co", location: "NSW" }]);
  assert.doesNotMatch(raw, /\n/);
  const { results } = await extract([], source, raw);
  assert.deepEqual(results, [{
    name: project.name, description: project.description, capacityMw: 50,
    developer: "Solar Co", location: "NSW", country: "AU", status: "announced",
    sourceUrl: project.source_url, sourceName: source.name, announcedDate: project.announced_date,
    contactName: null, contactEmail: null, contactPhone: null,
  }]);
});

test("source fallback treats an explicit empty JSON array as a valid empty result", async () => {
  const { results, requests, gated } = await extract([], source, "[]");
  assert.deepEqual(results, []);
  assert.equal(requests.length, 1);
  assert.deepEqual(gated, []);
});

test("source fallback rejects malformed, non-JSON and truncated output safely", async () => {
  for (const raw of ["", "No projects found", "{not json}", "[invalid]", "[null]", '[{"name":"Truncated Solar Farm"', JSON.stringify(project)]) {
    await assert.rejects(extract([], source, raw));
  }
});

test("cached AI rows still pass current country, capacity, technology, date and source gates", async () => {
  const cached = [
    project, { ...project, capacity_mw: 4.99 }, { ...project, country: "US" },
    { ...project, name: "Battery", description: "Standalone BESS" },
    { ...project, name: "Wind Farm", description: "Wind turbines" },
    { ...project, announced_date: "2026-07-01" },
    { ...project, source_url: "https://unapproved.example/solar" },
  ];
  const { requests, results } = await extract([], source, "", cached);
  assert.equal(requests.length, 0);
  assert.equal(results.length, 2);
  assert.deepEqual(results.map(r => r.sourceUrl), [project.source_url, source.searchUrl]);
  await assert.rejects(extract([], { ...source, name: "Unapproved Site" }, "", cached), /No source repair strategy/);
});

test("cached empty AI result needs no SDK call", async () => {
  const { requests, results } = await extract([], source, "", []);
  assert.deepEqual(results, []);
  assert.equal(requests.length, 0);
});
