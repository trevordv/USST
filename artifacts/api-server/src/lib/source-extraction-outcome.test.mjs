import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import * as outcomes from "./source-extraction-outcome.ts";
import { sourceAcquisitionOutcome } from "./source-access-outcome.ts";
import { AEMO_GENERATION_WORKBOOK_URL, getSourceAcquisitionPlan, getSourceRepairStrategy } from "./source-repair-strategies.ts";
import { filterEligibleScanProjects, isEligibleScanProject } from "./project-eligibility.ts";
import { hashMeaningfulSourceContent, hashSourceContent } from "./ai-source-cache.ts";
import { planBrightDataTargets } from "./bright-data.ts";
import { feedPageUrl } from "./feed-items.ts";
import { assignProjectIdentityUrls } from "./project-identity.ts";
import { normalizeProjectName, nextListingPageUrl } from "./source-text.ts";

const scraper = await readFile(new URL("./scraper.ts", import.meta.url), "utf8");
const start = scraper.indexOf("async function scrapeSource(");
const end = scraper.indexOf("export async function runScan(", start);
assert.ok(start >= 0 && end > start);
const compiled = stripTypeScriptTypes(scraper.slice(start, end));
const project = { name: "River Solar Farm", description: "Proposed solar farm", capacityMw: 50, country: "AU", sourceUrl: "https://www.energymagazine.com.au/river" };
const combineContentFingerprints = () => null;
const safeSourceFailureReason = category => category ? "Source acquisition failed" : null;

class MockSourceRequestError extends Error {
  constructor(message, problem) { super(message); this.problem = problem; }
}
class MockFirecrawlError extends Error {
  constructor(category) { super(category); this.category = category; }
}

async function run(options = {}) {
  const logs = [];
  const calls = { ai: 0, fetch: 0, firecrawl: 0, apify: 0, bright: 0 };
  const env = options.env ?? {};
  const deps = {
    ...outcomes, sourceAcquisitionOutcome, getSourceRepairStrategy, getSourceAcquisitionPlan,
    planBrightDataTargets, hashMeaningfulSourceContent, hashSourceContent,
    combineContentFingerprints, safeSourceFailureReason, isEligibleScanProject,
    firecrawlConfigured: () => Boolean(env.FIRECRAWL_API_KEY),
    apifySourceConfigured: () => Boolean(env.APIFY_API_TOKEN),
    brightDataConfigured: () => Boolean(env.BRIGHT_DATA_API_KEY && env.BRIGHT_DATA_ZONE),
    FirecrawlAcquisitionError: MockFirecrawlError,
    acquireApprovedSourceWithFirecrawl: async (_name, url) => {
      calls.firecrawl++;
      if (options.firecrawlError) throw options.firecrawlError;
      return { mode: "scrape", pagesFetched: 1, durationMs: 5, cacheReuse: false,
        pages: [{ finalUrl: url, content: "# Solar projects", contentHash: "a".repeat(64) }] };
    },
    fetchApprovedSourceWithApify: async (_name, url) => {
      calls.apify++;
      if (options.apifyError) throw options.apifyError;
      return [{ finalUrl: url, content: "# Solar projects", contentHash: "b".repeat(64) }];
    },
    fetchApprovedBrightData: async () => { calls.bright++; throw new Error("unused"); },
    diagnosticUrl: url => url ? new URL(url).origin + new URL(url).pathname : undefined,
    SourceRequestError: MockSourceRequestError, process: { env },
    logger: { info: (fields, message) => logs.push({ ...fields, message }), warn: (fields, message) => logs.push({ ...fields, message }) },
    logScanSourceOutcome: (source, outcome, fields) => logs.push({ source, outcome, ...fields }),
    logDirectSourceFailure() {}, finalFailureOutcome: () => "extraction-failed",
    fetchForSource: async () => { calls.fetch++; if (options.fetchError) throw options.fetchError; return "<article>Solar project listing</article>"; },
    parseHtmlPage: () => options.directProjects ?? [], parseRssFeed: () => options.directProjects ?? [],
    parseRssFeedPage: () => ({ projects: options.directProjects ?? [], itemCount: 0, oldestDate: null, firstLink: null }),
    parseOfficialProjectHtml: () => options.directProjects ?? [],
    parseFirecrawlMarkdown: () => options.managedProjects ?? [],
    sourceRepairCandidatesToProjects: items => filterEligibleScanProjects(items),
    scrapeWithChatGpt: async () => { calls.ai++; return filterEligibleScanProjects(options.aiProjects ?? []); },
    feedPageUrl, assignProjectIdentityUrls, normalizeProjectName, nextListingPageUrl,
    FEED_MAX_PAGES_BOUNDED: 10, FEED_MAX_PAGES_UNBOUNDED: 4, EXTRA_LISTING_PAGES: 2,
    fetchApprovedDiscoveredPage: async () => "<html></html>",
    enrichProjectsFromArticles: async (_source, items) => ({ kept: [...items], attempted: 0, enriched: 0, dropped: 0 }),
    AEMO_GENERATION_WORKBOOK_URL, scrapeAemoGenerationWorkbook: async () => options.directProjects ?? [],
    scrapeEpbcOfficialLayer: async () => options.directProjects ?? [],
  };
  const scrape = new Function(...Object.keys(deps), `${compiled}\nreturn scrapeSource;`)(...Object.values(deps));
  const strategy = getSourceRepairStrategy(options.sourceName ?? "Energy Magazine");
  const source = { name: strategy.name, searchUrl: strategy.officialUrls.at(-1), ...(options.source ?? {}) };
  const result = await scrape(source, "2026-08-01", "2026-08-31");
  return { ...result, calls, logs };
}

test("successful direct zero is legitimate and performs no paid fallback", async () => {
  const result = await run();
  assert.deepEqual(result.projects, []);
  assert.deepEqual({ firecrawl: result.calls.firecrawl, ai: result.calls.ai }, { firecrawl: 0, ai: 0 });
  assert.equal(result.health.outcome, "success-zero-results");
});

test("successful direct results perform no managed acquisition", async () => {
  const result = await run({ directProjects: [project] });
  assert.equal(result.projects.length, 1);
  assert.deepEqual({ firecrawl: result.calls.firecrawl, apify: result.calls.apify, bright: result.calls.bright, ai: result.calls.ai },
    { firecrawl: 0, apify: 0, bright: 0, ai: 0 });
});

test("blocked approved source uses Firecrawl first and records provenance", async () => {
  const result = await run({ env: { FIRECRAWL_API_KEY: "secret" }, fetchError: new MockSourceRequestError("HTTP 403", "public-access-block"), managedProjects: [project] });
  assert.equal(result.calls.firecrawl, 1);
  assert.equal(result.calls.apify, 0);
  assert.equal(result.health.acquisitionMethod, "firecrawl");
  assert.equal(result.health.firecrawlPages, 1);
  assert.equal(result.health.outcome, "success-with-results");
});

test("valid empty Firecrawl result terminates the fallback hierarchy", async () => {
  const result = await run({ env: { FIRECRAWL_API_KEY: "x", APIFY_API_TOKEN: "x", BRIGHT_DATA_API_KEY: "x", BRIGHT_DATA_ZONE: "z" }, fetchError: new Error("network") });
  assert.deepEqual({ firecrawl: result.calls.firecrawl, apify: result.calls.apify, bright: result.calls.bright, ai: result.calls.ai },
    { firecrawl: 1, apify: 0, bright: 0, ai: 0 });
  assert.equal(result.health.outcome, "success-zero-results");
});

test("Firecrawl failure advances to bounded Apify", async () => {
  const result = await run({ env: { FIRECRAWL_API_KEY: "x", APIFY_API_TOKEN: "x" }, fetchError: new Error("network"), firecrawlError: new MockFirecrawlError("provider-error"), managedProjects: [project] });
  assert.equal(result.calls.firecrawl, 1);
  assert.equal(result.calls.apify, 1);
  assert.equal(result.calls.ai, 0);
  assert.equal(result.health.acquisitionMethod, "apify");
});

test("all provider failures return safe source health without throwing", async () => {
  const result = await run({ env: { FIRECRAWL_API_KEY: "x", APIFY_API_TOKEN: "x" }, fetchError: new Error("network"), firecrawlError: new MockFirecrawlError("provider-error"), apifyError: new Error("provider") });
  assert.deepEqual(result.projects, []);
  assert.equal(result.health.outcome, "provider-error");
  assert.equal(result.health.fallbackUsed, true);
  assert.doesNotMatch(result.health.failureReason ?? "", /secret|network/i);
});

test("managed acquisition cannot bypass project eligibility", async () => {
  const invalid = [{ ...project, capacityMw: 4.99 }, { ...project, country: "US" },
    { ...project, name: "Standalone Battery", description: "BESS only" },
    { ...project, name: "Wind Farm", description: "Wind turbines" }];
  const result = await run({ env: { FIRECRAWL_API_KEY: "x" }, fetchError: new Error("network"), managedProjects: invalid });
  assert.equal(result.health.qualifyingProjectCount, 0);
  assert.deepEqual(filterEligibleScanProjects(result.projects), []);
  assert.equal(result.calls.ai, 0);
});

test("Firecrawl is centralized and authenticated sources stay outside generic acquisition", () => {
  const scan = scraper.slice(end);
  assert.match(scan, /await scrapeAltEnergy\(startDate, endDate\)/);
  assert.match(scan, /await scrapeLuvi\(startDate, endDate\)/);
  assert.doesNotMatch(scraper, /api\.firecrawl\.dev\/v1\/scrape/);
  assert.match(scraper, /acquireApprovedSourceWithFirecrawl/);
  assert.doesNotMatch(compiled, /scrapeAltEnergy\(|scrapeLuvi\(/);
});
