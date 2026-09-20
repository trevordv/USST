import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import * as outcomes from "./source-extraction-outcome.ts";
import { sourceAcquisitionOutcome } from "./source-access-outcome.ts";
import { AEMO_GENERATION_WORKBOOK_URL, getSourceRepairStrategy } from "./source-repair-strategies.ts";
import { browseAiConfigurationProblem } from "./browse-ai-task.ts";
import { filterEligibleScanProjects } from "./project-eligibility.ts";
import { hashMeaningfulSourceContent, hashSourceContent } from "./ai-source-cache.ts";
import { planBrightDataTargets, brightDataConfigured } from "./bright-data.ts";
import { feedPageUrl } from "./feed-items.ts";
import { assignProjectIdentityUrls } from "./project-identity.ts";
import { normalizeProjectName } from "./source-text.ts";

const scraper = await readFile(new URL("./scraper.ts", import.meta.url), "utf8");
const start = scraper.indexOf("async function scrapeSource(");
const end = scraper.indexOf("export async function runScan(", start);
assert.ok(start >= 0 && end > start);
const compiled = stripTypeScriptTypes(scraper.slice(start, end));
const candidateStart = scraper.indexOf("function sourceRepairCandidatesToProjects(");
const candidateEnd = scraper.indexOf("async function scrapeAemoGenerationWorkbook(", candidateStart);
assert.ok(candidateStart >= 0 && candidateEnd > candidateStart);
const mapCandidates = new Function("isEligibleScanProject", `${stripTypeScriptTypes(scraper.slice(candidateStart, candidateEnd))}\nreturn sourceRepairCandidatesToProjects;`)(() => true);
const html = '<article class="post"><h2>Project updates</h2></article>';
const project = { name: "River Solar Farm", description: "Proposed solar farm", capacityMw: 50, country: "AU", sourceUrl: "https://reneweconomy.com.au/river" };
class MockSourceRequestError extends Error {
  constructor(message, problem) { super(message); this.problem = problem; }
}

async function run(options = {}) {
  const logs = [], calls = { ai: 0, aiHashes: [], fetch: [], browse: 0, bright: [], special: 0 };
  const deps = {
    ...outcomes, sourceAcquisitionOutcome, getSourceRepairStrategy, browseAiConfigurationProblem,
    planBrightDataTargets, brightDataConfigured: () => brightDataConfigured(options.env ?? {}),
    diagnosticUrl: url => url ? new URL(url).origin + new URL(url).pathname : undefined,
    fetchApprovedBrightData: async (_name, target) => {
      calls.bright.push(target.url);
      if (options.brightError) throw options.brightError;
      return Buffer.from(options.brightHtml ?? '<h2>Project updates</h2>');
    },
    hashMeaningfulSourceContent, hashSourceContent, SourceRequestError: MockSourceRequestError,
    process: { env: options.env ?? {} },
    logger: { info: (fields, message) => logs.push({ ...fields, message }), warn() {} },
    logScanSourceOutcome: (source, outcome, fields) => logs.push({ source, outcome, ...fields }),
    logDirectSourceFailure() {}, finalFailureOutcome: () => "extraction-failed",
    fetchForSource: async (_, url) => {
      calls.fetch.push(url);
      if (options.fetchByUrl?.[url]) throw options.fetchByUrl[url];
      if (options.fetchError) throw options.fetchError;
      return url.endsWith("/feed/") ? '<rss><channel></channel></rss>' : options.html ?? html;
    },
    parseHtmlPage: () => { if (options.parseError) throw options.parseError; return options.projects ?? []; },
    parseRssFeed: () => options.projects ?? [],
    parseRssFeedPage: () => ({ projects: options.projects ?? [], itemCount: 0, oldestDate: null, firstLink: null }),
    feedPageUrl, assignProjectIdentityUrls, normalizeProjectName,
    FEED_MAX_PAGES_BOUNDED: 10, FEED_MAX_PAGES_UNBOUNDED: 4,
    enrichProjectsFromArticles: async (_source, items) => ({ kept: [...items], attempted: 0, enriched: 0, dropped: 0 }),
    parseOfficialProjectHtml: () => options.projects ?? [],
    sourceRepairCandidatesToProjects: items => filterEligibleScanProjects(items),
    scrapeWithChatGpt: async (_source, _start, _end, contentHash) => { calls.ai++; calls.aiHashes.push(contentHash); return filterEligibleScanProjects(options.aiProjects ?? []); },
    scrapeWithBrowseAi: async () => { calls.browse++; if (options.browseError) throw options.browseError; return options.projects ?? []; },
    AEMO_GENERATION_WORKBOOK_URL,
    scrapeAemoGenerationWorkbook: async () => { calls.special++; if (options.fetchError) throw options.fetchError; return options.projects ?? []; },
    scrapeEpbcOfficialLayer: async () => { calls.special++; return options.projects ?? []; },
  };
  const scrape = new Function(...Object.keys(deps), `${compiled}\nreturn scrapeSource;`)(...Object.values(deps));
  const results = await scrape({ name: "Renew Economy", searchUrl: "https://reneweconomy.com.au/", ...options.source }, "2026-08-01", "2026-08-31");
  return { results, logs, calls };
}

test("valid fetch and parse with zero projects performs no paid AI call and logs zero success", async () => {
  const { calls, results, logs } = await run();
  assert.equal(calls.ai, 0);
  assert.deepEqual(results, []);
  assert.equal(logs.at(-1).resultOutcome, "success-zero-results");
  assert.match(logs.at(-1).reason, /no paid AI fallback/);
  assert.equal(logs.at(-1).directSucceeded, true);
});

test("valid results perform no AI call and keep duplicate URL handling", async () => {
  const { calls, results, logs } = await run({ projects: [project, project], source: { feedUrl: "https://reneweconomy.com.au/feed/" } });
  assert.equal(calls.ai, 0);
  assert.equal(calls.fetch.length, 2);
  assert.deepEqual(results, [project]);
  assert.equal(logs.at(-1).resultOutcome, "success-with-results");
});

test("fetch failures allow one configured AI repair and log the evidence", async () => {
  const { calls, logs } = await run({ fetchError: new Error("ECONNRESET") });
  assert.equal(calls.ai, 1);
  assert.match(logs.find(l => l.outcome === "fallback-used").reason, /fetch-failed.*network/);
  assert.equal(logs.at(-1).directSucceeded, false);
});

test("a network-failed approved source uses Bright Data before AI and passes existing eligibility gates", async () => {
  const env = { BRIGHT_DATA_API_KEY: "test", BRIGHT_DATA_ZONE: "unlocker" };
  const source = { searchUrl: "https://reneweconomy.com.au/?s=solar+project+announced" };
  const { calls, results, logs } = await run({ env, source, fetchError: new Error("ECONNRESET"), brightHtml: '<article class="post">Solar project</article>', projects: [project] });
  assert.equal(calls.bright.length, 1);
  assert.equal(calls.ai, 0);
  assert.deepEqual(results, [project]);
  assert.equal(logs.at(-1).directSucceeded, false);
  assert.equal(logs.at(-1).brightSucceeded, true);
  assert.equal(logs.at(-1).brightDataCalls, 1);
  assert.ok(logs.at(-1).extractionOutcomes.some(a => a.method === "bright-data-html" && a.outcome === "success-with-results"));
  assert.deepEqual(filterEligibleScanProjects([{ ...project, capacityMw: 4.99 }, { ...project, country: "US" }]), []);
});

test("Bright Data valid zero is not another reason for AI fallback", async () => {
  const env = { BRIGHT_DATA_API_KEY: "test", BRIGHT_DATA_ZONE: "unlocker" };
  const source = { searchUrl: "https://reneweconomy.com.au/?s=solar+project+announced" };
  const { calls, logs } = await run({ env, source, fetchError: new Error("ECONNRESET"), brightHtml: '<article class="post">No projects found</article>' });
  assert.equal(calls.bright.length, 1);
  assert.equal(calls.ai, 0);
  assert.equal(logs.at(-1).resultOutcome, "success-zero-results");
});

test("Bright Data structured candidates do not fabricate announcement dates or bypass a bounded date window", () => {
  const candidate = { ...project, announcedDate: null };
  const source = { name: "RenewMap", country: "AU" };
  assert.deepEqual(mapCandidates([candidate], source, "2026-08-01", "2026-08-31", true), []);
  assert.equal(mapCandidates([candidate], source, undefined, undefined, true)[0].announcedDate, null);
  assert.equal(mapCandidates([{ ...candidate, announcedDate: "2026-08-15" }], source, "2026-08-01", "2026-08-31", true).length, 1);
});

test("Bright Data failure retains the prior bounded AI fallback", async () => {
  const env = { BRIGHT_DATA_API_KEY: "test", BRIGHT_DATA_ZONE: "unlocker" };
  const source = { searchUrl: "https://reneweconomy.com.au/?s=solar+project+announced" };
  const { calls } = await run({ env, source, fetchError: new Error("ECONNRESET"), brightError: new Error("provider unavailable") });
  assert.equal(calls.bright.length, 1);
  assert.equal(calls.ai, 1);
});

test("unparseable Bright Data content is hashed before bounded AI repair", async () => {
  const env = { BRIGHT_DATA_API_KEY: "test", BRIGHT_DATA_ZONE: "unlocker" };
  const source = { searchUrl: "https://reneweconomy.com.au/?s=solar+project+announced" };
  const first = await run({ env, source, fetchError: new Error("ECONNRESET"), brightHtml: "changed page markup" });
  const second = await run({ env, source, fetchError: new Error("ECONNRESET"), brightHtml: "different page markup" });
  assert.equal(first.calls.ai, 1);
  assert.equal(second.calls.ai, 1);
  assert.notEqual(first.calls.aiHashes[0], second.calls.aiHashes[0]);
});

test("registry-designated JavaScript sources use Bright Data after safe direct failure", async () => {
  const env = { BRIGHT_DATA_API_KEY: "test", BRIGHT_DATA_ZONE: "unlocker" };
  const source = { name: "RenewMap", searchUrl: "https://renewmap.com.au/resources/" };
  const { calls, logs } = await run({ env, source, fetchError: new Error("ECONNRESET"), brightHtml: "<h2>Solar project</h2>", projects: [project] });
  assert.deepEqual(calls.bright, getSourceRepairStrategy("RenewMap").officialUrls);
  assert.equal(calls.ai, 0);
  assert.equal(logs.at(-1).brightSucceeded, true);
});

test("plain public 403 on a reviewed source uses Bright Data but protected paths do not", async () => {
  const env = { BRIGHT_DATA_API_KEY: "test", BRIGHT_DATA_ZONE: "unlocker" };
  const source = { name: "Energy Magazine", searchUrl: getSourceRepairStrategy("Energy Magazine").officialUrls[1] };
  const ordinary = await run({ env, source, fetchError: new MockSourceRequestError("HTTP 403", "public-access-block"), brightHtml: '<article class="post">Solar project</article>', projects: [project] });
  const challenge = await run({ env, source, fetchError: new MockSourceRequestError("challenge", "blocked") });
  const aemo = await run({ env, source: { name: "AEMO" }, fetchError: new MockSourceRequestError("HTTP 403", "blocked") });
  assert.deepEqual(ordinary.calls.bright, [source.searchUrl]);
  assert.equal(ordinary.calls.ai, 0);
  assert.equal(challenge.calls.bright.length, 0);
  assert.equal(aemo.calls.bright.length, 0);
  assert.equal(aemo.calls.ai, 1);
});

test("Energy Magazine's empty RSS plus plain-403 search retries only the search URL", async () => {
  const strategy = getSourceRepairStrategy("Energy Magazine");
  const source = { name: strategy.name, feedUrl: strategy.officialUrls[0], searchUrl: strategy.officialUrls[1] };
  const env = { BRIGHT_DATA_API_KEY: "test", BRIGHT_DATA_ZONE: "unlocker" };
  const { calls, logs } = await run({
    env, source, brightHtml: '<article class="post">No matching projects</article>',
    fetchError: undefined,
    html: '<article class="post">No matching projects</article>',
    // The RSS is a valid zero, while only the search page is denied.
    fetchByUrl: { [source.searchUrl]: new MockSourceRequestError("HTTP 403", "public-access-block") },
  });
  assert.deepEqual(calls.bright, [source.searchUrl]);
  assert.equal(calls.ai, 0);
  assert.equal(logs.at(-1).brightDataCalls, 1);
});

test("parse failures, unusable documents and JS-only shells allow repair", async () => {
  for (const [options, outcome] of [
    [{ parseError: new Error("parser broke") }, "parse-failed"],
    [{ html: "" }, "content-unusable"],
    [{ html: '<html><script src="app.js"></script><body>Loading...</body></html>' }, "requires-js-or-ai-repair"],
    [{ html: "<html><body>Changed project markup</body></html>" }, "parse-failed"],
  ]) {
    const { calls, logs } = await run(options);
    assert.equal(calls.ai, 1);
    assert.ok(logs.find(l => l.outcome === "fallback-used").extractionOutcomes.some(a => a.outcome === outcome));
    assert.equal(logs.at(-1).directSucceeded, false);
  }
});

test("source fallback fingerprints the actual fetched content even when parsing fails", async () => {
  const options = { html, parseError: new Error("parser broke") };
  const first = await run(options);
  const same = await run(options);
  const changed = await run({ ...options, html: html.replace("Project updates", "New project updates") });
  assert.match(first.calls.aiHashes[0], /^[a-f0-9]{64}$/);
  assert.equal(first.calls.aiHashes[0], same.calls.aiHashes[0]);
  assert.notEqual(first.calls.aiHashes[0], changed.calls.aiHashes[0]);
});

test("valid empty RSS, explicit empty HTML and non-project structures are usable", () => {
  outcomes.assertSourceDocument("<rss><channel></channel></rss>", "rss");
  outcomes.assertSourceDocument("<html><body>No projects found</body></html>", "html");
  outcomes.assertSourceDocument(html, "html");
  outcomes.assertSourceDocument("<h2>Wind project updates</h2>", "structured-html");
  for (const text of ["<html>Not a feed</html>", "<rss><channel>", "<rss><channel><item></channel></rss>"]) {
    assert.throws(() => outcomes.assertSourceDocument(text, "rss"));
  }
});

test("documented AI-first strategy remains deliberate repair, not zero-count fallback", async () => {
  const { calls, logs } = await run({ source: { name: "NSW Planning Portal" } });
  assert.equal(calls.ai, 1);
  assert.equal(calls.fetch.length, 0);
  assert.match(logs.find(l => l.outcome === "fallback-used").reason, /requires-js-or-ai-repair.*approved source strategy/);
});

test("Browse.AI remains first when configured; valid zero and nonzero results need no OpenAI", async () => {
  const source = { name: "NZ Fast-track" };
  const env = { BROWSE_AI_API_KEY: "test", BROWSE_AI_NZ_FAST_TRACK_ROBOT_ID: "robot" };
  for (const projects of [[], [project]]) {
    const { calls } = await run({ source, env, projects });
    assert.equal(calls.browse, 1);
    assert.equal(calls.ai, 0);
  }
  for (const options of [{ source }, { source, env, browseError: new Error("robot unavailable") }]) {
    const { calls } = await run(options);
    assert.equal(calls.ai, 1);
  }
});

test("Browse.AI failure does not bypass the NZ site's access controls through Bright Data", async () => {
  const env = {
    BROWSE_AI_API_KEY: "test", BROWSE_AI_NZ_FAST_TRACK_ROBOT_ID: "robot",
    BRIGHT_DATA_API_KEY: "test", BRIGHT_DATA_ZONE: "unlocker",
  };
  const { calls } = await run({
    source: { name: "NZ Fast-track" }, env,
    browseError: new Error("robot unavailable"),
    brightHtml: "<h2>Solar project</h2>", projects: [project],
  });
  assert.equal(calls.browse, 1);
  assert.equal(calls.bright.length, 0);
  assert.equal(calls.ai, 1);
});

test("structured sources do not search after valid empty acquisition", async () => {
  for (const name of ["AEMO", "EPBC Act Referrals", "Transpower NZ"]) {
    const { calls } = await run({ source: { name }, html: "<h2>Project updates</h2>" });
    assert.equal(calls.ai, 0);
  }
});

test("no repair without configured permission or failure evidence; partial failures stay visible", () => {
  const zero = { method: "rss", outcome: "success-zero-results" };
  const failure = { method: "html", outcome: "fetch-failed" };
  assert.equal(outcomes.paidSourceFallbackReason([], true), undefined);
  assert.equal(outcomes.paidSourceFallbackReason([zero], true), undefined);
  assert.equal(outcomes.paidSourceFallbackReason([failure], false), undefined);
  assert.match(outcomes.paidSourceFallbackReason([zero, failure], true), /html: fetch-failed/);
  assert.equal(outcomes.paidSourceFallbackReason([{ ...zero, outcome: "success-with-results" }, failure], true), undefined);
});

test("eligibility filtering cannot turn normal acquisition into an AI repair trigger", async () => {
  const projects = [
    { ...project, capacityMw: 4.99 }, { ...project, country: "US" },
    { ...project, name: "Standalone Battery", description: "BESS" },
    { ...project, name: "Wind Farm", description: "Wind turbines" },
  ];
  for (const invalid of projects) {
    const { calls, results } = await run({ projects: [invalid] });
    assert.equal(calls.ai, 0);
    assert.deepEqual(filterEligibleScanProjects(results), []);
  }
  // The production ingestion gate remains after collection and before writes.
  assert.ok(scraper.indexOf("getProjectIneligibilityReason(project)", end) > end);
});

test("dedicated authenticated paths and existing Firecrawl helper remain outside generic fallback", () => {
  const scan = scraper.slice(end);
  assert.match(scan, /await scrapeAltEnergy\(startDate, endDate\)/);
  assert.match(scan, /await scrapeLuvi\(startDate, endDate\)/);
  assert.match(scraper, /return source\.authenticated \? fetchAltEnergy\(url\) : fetchWithTimeout\(url\)/);
  assert.match(scraper, /async function scrapeWithFirecrawl\(/);
  assert.doesNotMatch(compiled, /scrapeAltEnergy\(|scrapeLuvi\(|scrapeWithFirecrawl\(/);
});
