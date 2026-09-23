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
import { isApprovedDiscoveredUrl, normalizeProjectName, nextListingPageUrl } from "./source-text.ts";

const scraper = await readFile(new URL("./scraper.ts", import.meta.url), "utf8");
const start = scraper.indexOf("async function scrapeSource(");
const end = scraper.indexOf("export async function runScan(", start);
assert.ok(start >= 0 && end > start);
const compiled = stripTypeScriptTypes(scraper.slice(start, end));
const candidateStart = scraper.indexOf("function sourceRepairCandidatesToProjects(");
const candidateEnd = scraper.indexOf("async function scrapeAemoGenerationWorkbook(", candidateStart);
assert.ok(candidateStart >= 0 && candidateEnd > candidateStart);
const mapCandidates = new Function("isEligibleScanProject", `${stripTypeScriptTypes(scraper.slice(candidateStart, candidateEnd))}\nreturn sourceRepairCandidatesToProjects;`)(isEligibleScanProject);
const project = { name: "River Solar Farm", description: "Proposed solar farm", capacityMw: 50, country: "AU", sourceUrl: "https://www.energymagazine.com.au/river" };
const combineContentFingerprints = () => null;
const safeSourceFailureReason = category => category ? "Source acquisition failed" : null;

class MockSourceRequestError extends Error {
  constructor(message, problem) { super(message); this.problem = problem; }
}
class MockFirecrawlError extends Error {
  constructor(category) { super(category); this.category = category; }
}

test("approved discovered pages reject outside hosts, credentials and custom ports", async () => {
  const begin = scraper.indexOf("function fetchApprovedDiscoveredPage(");
  const finish = scraper.indexOf("/** Same-site article reads", begin);
  assert.ok(begin >= 0 && finish > begin);
  const requests = [];
  const fetchApproved = new Function(
    "isApprovedDiscoveredUrl", "approvedHosts", "SourceRequestError", "fetchWithTimeout",
    `${stripTypeScriptTypes(scraper.slice(begin, finish))}\nreturn fetchApprovedDiscoveredPage;`,
  )(
    isApprovedDiscoveredUrl,
    () => new Set(["reneweconomy.com.au"]),
    MockSourceRequestError,
    async (...args) => { requests.push(args); return "article"; },
  );
  const source = { name: "Renew Economy" };
  assert.equal(await fetchApproved(source, "https://reneweconomy.com.au/article"), "article");
  assert.throws(() => fetchApproved(source, "https://evil.test/article"), /approved HTTPS/);
  assert.throws(() => fetchApproved(source, "https://reneweconomy.com.au:8443/article"), /approved HTTPS/);
  assert.throws(() => fetchApproved(source, "https://user:pass@reneweconomy.com.au/article"), /approved HTTPS/);
  assert.deepEqual(requests, [["https://reneweconomy.com.au/article", 12_000, "error"]]);
});

async function run(options = {}) {
  const logs = [];
  const calls = { ai: 0, aiHashes: [], fetch: [], discovered: [], firecrawl: 0, apify: 0, bright: 0 };
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
      const content = options.firecrawlContent ?? "# Solar projects";
      return { mode: "scrape", pagesFetched: 1, durationMs: 5, cacheReuse: false,
        pages: [{ finalUrl: url, content, contentHash: hashMeaningfulSourceContent(content) }] };
    },
    fetchApprovedSourceWithApify: async (_name, url) => {
      calls.apify++;
      if (options.apifyError) throw options.apifyError;
      return [{ finalUrl: url, content: "# Solar projects", contentHash: "b".repeat(64) }];
    },
    fetchApprovedBrightData: async () => {
      calls.bright++;
      if (options.brightError) throw options.brightError;
      return Buffer.from(options.brightHtml ?? "<article>Solar project listing</article>");
    },
    diagnosticUrl: url => url ? new URL(url).origin + new URL(url).pathname : undefined,
    SourceRequestError: MockSourceRequestError, process: { env },
    logger: { info: (fields, message) => logs.push({ ...fields, message }), warn: (fields, message) => logs.push({ ...fields, message }) },
    logScanSourceOutcome: (source, outcome, fields) => logs.push({ source, outcome, ...fields }),
    logDirectSourceFailure() {}, finalFailureOutcome: () => "extraction-failed",
    fetchForSource: async (_source, url) => {
      calls.fetch.push(url);
      if (options.fetchByUrl?.[url]) throw options.fetchByUrl[url];
      if (options.fetchError) throw options.fetchError;
      return options.htmlByUrl?.[url] ?? options.html ?? "<article>Solar project listing</article>";
    },
    parseHtmlPage: (_html, _source, _start, _end, url) => {
      if (options.brightParseError && env.BRIGHT_DATA_API_KEY) throw options.brightParseError;
      if (options.directParseError) throw options.directParseError;
      return options.projectsByUrl?.[url] ?? options.directProjects ?? [];
    },
    parseRssFeed: () => options.directProjects ?? [],
    parseRssFeedPage: () => ({ projects: options.directProjects ?? [], itemCount: 0, oldestDate: null, firstLink: null }),
    parseOfficialProjectHtml: () => options.directProjects ?? [],
    parseFirecrawlMarkdown: () => {
      if (options.managedParseError) throw options.managedParseError;
      return options.managedProjects ?? [];
    },
    sourceRepairCandidatesToProjects: items => filterEligibleScanProjects(items),
    scrapeWithChatGpt: async (_source, _start, _end, contentHash) => {
      calls.ai++;
      calls.aiHashes.push(contentHash);
      return filterEligibleScanProjects(options.aiProjects ?? []);
    },
    feedPageUrl, assignProjectIdentityUrls, normalizeProjectName, nextListingPageUrl,
    FEED_MAX_PAGES_BOUNDED: 10, FEED_MAX_PAGES_UNBOUNDED: 4, EXTRA_LISTING_PAGES: 2,
    fetchApprovedDiscoveredPage: async (_source, url) => {
      calls.discovered.push(url);
      if (options.discoveredErrors?.[url]) throw options.discoveredErrors[url];
      return options.discoveredDocuments?.[url] ?? "<article>No projects found</article>";
    },
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

test("approved listing pagination is same-source and bounded to two discovered pages", async () => {
  const first = "https://reneweconomy.com.au/?s=solar+project+announced";
  const second = "https://reneweconomy.com.au/page/2/";
  const third = "https://reneweconomy.com.au/page/3/";
  const fourth = "https://reneweconomy.com.au/page/4/";
  const result = await run({
    sourceName: "Renew Economy",
    html: '<article>Solar project listing</article><a rel="next" href="/page/2/">Next</a>',
    discoveredDocuments: {
      [second]: '<article>Solar project listing</article><a rel="next" href="/page/3/">Next</a>',
      [third]: '<article>Solar project listing</article><a rel="next" href="/page/4/">Next</a>',
      [fourth]: "<article>Must not be fetched</article>",
    },
    projectsByUrl: {
      [first]: [{ ...project, sourceUrl: first }],
      [second]: [{ ...project, name: "Second Solar Farm", sourceUrl: second }],
      [third]: [{ ...project, name: "Third Solar Farm", sourceUrl: third }],
    },
  });
  assert.deepEqual(result.calls.discovered, [second, third]);
  assert.deepEqual(result.projects.map((item) => item.name), ["River Solar Farm", "Second Solar Farm", "Third Solar Farm"]);
  assert.equal(result.calls.ai, 0);
});

test("source-content fingerprints are stable and change with meaningful content", async () => {
  const common = {
    env: { FIRECRAWL_API_KEY: "x" }, fetchError: new Error("network"),
    managedParseError: new Error("parser changed"), aiProjects: [project],
  };
  const first = await run({ ...common, firecrawlContent: "# River Solar\n50 MW solar farm" });
  const same = await run({ ...common, firecrawlContent: "# River Solar\n50   MW solar farm\n\n" });
  const changed = await run({ ...common, firecrawlContent: "# River Solar\n80 MW solar farm" });
  assert.match(first.calls.aiHashes[0], /^[a-f0-9]{64}$/);
  assert.equal(first.calls.aiHashes[0], same.calls.aiHashes[0]);
  assert.notEqual(first.calls.aiHashes[0], changed.calls.aiHashes[0]);
});

test("Firecrawl acquisition remains the health method when OpenAI normalises its content", async () => {
  const result = await run({
    env: { FIRECRAWL_API_KEY: "x", APIFY_API_TOKEN: "x" },
    fetchError: new Error("network"), managedParseError: new Error("unresolved fields"), aiProjects: [project],
  });
  assert.equal(result.calls.firecrawl, 1);
  assert.equal(result.calls.apify, 0);
  assert.equal(result.calls.ai, 1);
  assert.equal(result.health.acquisitionMethod, "firecrawl");
  assert.equal(result.health.firecrawlSucceeded, true);
  assert.equal(result.health.openaiNormalisationAttempted, true);
  assert.equal(result.health.openaiNormalisationSucceeded, true);
  assert.equal(result.health.outcome, "success-with-results");
});

test("Apify and Bright Data remain the acquisition method when OpenAI normalises their content", async () => {
  const apify = await run({
    env: { FIRECRAWL_API_KEY: "x", APIFY_API_TOKEN: "x" }, fetchError: new Error("network"),
    firecrawlError: new MockFirecrawlError("provider-error"), managedParseError: new Error("unresolved fields"), aiProjects: [project],
  });
  assert.equal(apify.health.acquisitionMethod, "apify");
  assert.equal(apify.health.openaiNormalisationSucceeded, true);

  const bright = await run({
    env: { FIRECRAWL_API_KEY: "x", APIFY_API_TOKEN: "x", BRIGHT_DATA_API_KEY: "x", BRIGHT_DATA_ZONE: "z" },
    fetchError: new Error("network"), firecrawlError: new MockFirecrawlError("provider-error"),
    apifyError: new Error("provider-error"), brightParseError: new Error("unresolved fields"), aiProjects: [project],
  });
  assert.equal(bright.calls.bright, 1, JSON.stringify(bright.logs));
  assert.equal(bright.health.acquisitionMethod, "brightdata");
  assert.equal(bright.health.openaiNormalisationSucceeded, true);
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

test("eligibility rejection after a successful direct parse never triggers paid fallback", async () => {
  for (const invalid of [
    { ...project, capacityMw: 4.99 },
    { ...project, country: "US" },
    { ...project, name: "Standalone Battery", description: "BESS only" },
    { ...project, name: "Wind Farm", description: "Wind turbines" },
  ]) {
    const result = await run({ directProjects: [invalid] });
    assert.equal(result.calls.firecrawl, 0);
    assert.equal(result.calls.ai, 0);
    assert.deepEqual(filterEligibleScanProjects(result.projects), []);
  }
});

test("Bright Data structured candidates preserve missing dates and bounded-window safety", () => {
  const candidate = { ...project, announcedDate: null };
  const source = { name: "RenewMap", country: "AU" };
  assert.deepEqual(mapCandidates([candidate], source, "2026-08-01", "2026-08-31", true), []);
  assert.equal(mapCandidates([candidate], source, undefined, undefined, true)[0].announcedDate, null);
  assert.equal(mapCandidates([{ ...candidate, announcedDate: "2026-08-15" }], source, "2026-08-01", "2026-08-31", true).length, 1);
});

test("valid empty and historical deterministic document semantics remain intact", () => {
  outcomes.assertSourceDocument("<rss><channel></channel></rss>", "rss");
  outcomes.assertSourceDocument("<html><body>No projects found</body></html>", "html");
  outcomes.assertSourceDocument("<h2>Wind project updates</h2>", "structured-html");
  for (const text of ["<html>Not a feed</html>", "<rss><channel>", "<rss><channel><item></channel></rss>"]) {
    assert.throws(() => outcomes.assertSourceDocument(text, "rss"));
  }
  const zero = { method: "rss", outcome: "success-zero-results" };
  const failure = { method: "html", outcome: "fetch-failed" };
  assert.equal(outcomes.paidSourceFallbackReason([zero], true), undefined);
  assert.equal(outcomes.paidSourceFallbackReason([failure], false), undefined);
  assert.match(outcomes.paidSourceFallbackReason([zero, failure], true), /html: fetch-failed/);
  assert.equal(outcomes.paidSourceFallbackReason([{ ...zero, outcome: "success-with-results" }, failure], true), undefined);
});

test("Firecrawl is centralized and authenticated sources stay outside generic acquisition", () => {
  const scan = scraper.slice(end);
  assert.match(scan, /await scrapeAltEnergy\(startDate, endDate\)/);
  assert.match(scan, /await scrapeLuvi\(startDate, endDate\)/);
  assert.doesNotMatch(scraper, /api\.firecrawl\.dev\/v1\/scrape/);
  assert.match(scraper, /acquireApprovedSourceWithFirecrawl/);
  assert.doesNotMatch(compiled, /scrapeAltEnergy\(|scrapeLuvi\(/);
});
