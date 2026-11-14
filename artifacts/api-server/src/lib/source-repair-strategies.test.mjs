import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AEMO_GENERATION_WORKBOOK_URL,
  APPROVED_PROJECT_SOURCE_COUNT,
  SOURCE_REPAIR_STRATEGIES,
  getSourceAcquisitionPlan,
  validateSourceRepairStrategies,
} from "./source-repair-strategies.ts";

const expectedGroups = {
  working: 13,
  inaccessible: 8,
  "extraction-problematic": 26,
  authenticated: 2,
};

test("the repair registry preserves exactly all 49 approved source slots", async () => {
  assert.equal(APPROVED_PROJECT_SOURCE_COUNT, 49);
  assert.equal(SOURCE_REPAIR_STRATEGIES.length, 49);
  assert.equal(
    new Set(SOURCE_REPAIR_STRATEGIES.map(({ name }) => name)).size,
    49,
  );

  const counts = Object.fromEntries(
    Object.keys(expectedGroups).map((group) => [
      group,
      SOURCE_REPAIR_STRATEGIES.filter(({ auditGroup }) => auditGroup === group)
        .length,
    ]),
  );
  assert.deepEqual(counts, expectedGroups);

  const scraper = await readFile(
    new URL("./scraper.ts", import.meta.url),
    "utf8",
  );
  const sourceBlock = scraper.slice(
    scraper.indexOf("const SOURCES: ScrapeSource[]"),
    scraper.indexOf("export const CONFIGURED_SCAN_SOURCE_NAMES"),
  );
  const configuredNames = [...sourceBlock.matchAll(/\bname:\s*"([^"]+)"/g)].map(
    (match) => match[1],
  );
  configuredNames.push("AltEnergy Australia", "LUVI Project Tracker");
  assert.doesNotThrow(() => validateSourceRepairStrategies(configuredNames));
  assert.match(scraper, /configuredSourceCount !== APPROVED_PROJECT_SOURCE_COUNT/);
  assert.match(scraper, /expectedSourceCount: APPROVED_PROJECT_SOURCE_COUNT/);
});

test("retired project sources cannot resolve an acquisition plan", () => {
  for (const name of [
    "SA Energy & Mining", "WA EPA", "NT Development Applications",
    "Planning Alerts Australia", "Clean Energy Council", "QLD Planning – Renewable Energy",
  ]) {
    assert.throws(() => getSourceAcquisitionPlan(name), /No source repair strategy/);
  }
  const urls = SOURCE_REPAIR_STRATEGIES.flatMap(({ officialUrls }) => officialUrls).join("\n");
  assert.doesNotMatch(urls, /energymining\.sa\.gov\.au|epa\.wa\.gov\.au|ntlis\.nt\.gov\.au|planningalerts\.org\.au|cleanenergycouncil\.org\.au|planning\.qld\.gov\.au/);
});

test("approved network sources use exact URLs and no managed acquisition providers", () => {
  for (const [name, url] of [
    ["Open Electricity", "https://openelectricity.org.au/facilities"],
    ["NSW EnergyCo", "https://www.energyco.nsw.gov.au/our-projects"],
    ["VicGrid", "https://www.vicgrid.com.au/"],
  ]) {
    const strategy = SOURCE_REPAIR_STRATEGIES.find((entry) => entry.name === name);
    assert.ok(strategy, name);
    assert.deepEqual(strategy.officialUrls, [url]);
    assert.equal(strategy.mode, "standard");
    assert.deepEqual(getSourceAcquisitionPlan(name).methods, ["html", "openai-normalisation"]);
  }
});

test("every approved source has an HTTPS official endpoint and a named parser contract", () => {
  for (const strategy of SOURCE_REPAIR_STRATEGIES) {
    assert.ok(
      strategy.parserTest,
      `${strategy.name} is missing a parser test contract`,
    );
    assert.ok(
      strategy.officialUrls.length > 0,
      `${strategy.name} has no official URL`,
    );
    for (const url of strategy.officialUrls) {
      assert.equal(
        new URL(url).protocol,
        "https:",
        `${strategy.name} must use HTTPS`,
      );
    }
  }
});

test("all 34 repaired sources have an explicit source-specific repair mode", async (t) => {
  const repaired = SOURCE_REPAIR_STRATEGIES.filter(
    ({ auditGroup }) =>
      auditGroup === "inaccessible" || auditGroup === "extraction-problematic",
  );
  assert.equal(repaired.length, 34);
  for (const strategy of repaired) {
    await t.test(strategy.name, () => {
      assert.notEqual(strategy.mode, "authenticated");
      assert.ok(strategy.fallback !== "none" || strategy.mode === "standard");
    });
  }
});

test("AEMO uses the current official Generator Information workbook", () => {
  const url = new URL(AEMO_GENERATION_WORKBOOK_URL);
  assert.equal(url.hostname, "www.aemo.com.au");
  assert.match(url.pathname, /nem-generation-information-july-2026\.xlsx$/);
});

test("blocked NZ sources use bounded Firecrawl before Apify and Bright Data", () => {
  const browseStrategies = SOURCE_REPAIR_STRATEGIES.filter(
    ({ mode }) => mode === "browse-ai-or-openai",
  );
  assert.equal(browseStrategies.length, 4);
  for (const strategy of browseStrategies) {
    const plan = getSourceAcquisitionPlan(strategy.name);
    assert.deepEqual(plan.methods, ["html", "firecrawl", "apify", "brightdata", "openai-normalisation"]);
    assert.equal(plan.firecrawlMode, "crawl");
    assert.equal(plan.maxFirecrawlPages, 3);
    assert.equal(plan.maxFirecrawlDepth, 1);
  }
});

test("every registry slot derives an explicit bounded acquisition plan", () => {
  for (const strategy of SOURCE_REPAIR_STRATEGIES) {
    const plan = getSourceAcquisitionPlan(strategy.name);
    assert.ok(plan.methods.length > 0, `${strategy.name} has no acquisition methods`);
    assert.equal(new Set(plan.methods).size, plan.methods.length);
    if (plan.methods.includes("firecrawl")) {
      assert.ok(plan.methods.indexOf("html") < plan.methods.indexOf("firecrawl"));
      assert.ok(plan.methods.indexOf("firecrawl") < plan.methods.indexOf("apify"));
      assert.ok(plan.methods.indexOf("apify") < plan.methods.indexOf("brightdata"));
      assert.ok((plan.maxFirecrawlPages ?? 0) <= 3);
      assert.ok((plan.maxFirecrawlDepth ?? 0) <= 1);
    }
  }
});

test("obsolete endpoints are absent from the repair registry", () => {
  const urls = SOURCE_REPAIR_STRATEGIES.flatMap(
    ({ officialUrls }) => officialUrls,
  ).join("\n");
  assert.doesNotMatch(urls, /policy-and-legislation\/renewable-energy/);
  assert.doesNotMatch(urls, /planning-issues-and-interests\/renewable-energy/);
  assert.doesNotMatch(urls, /energymagazine\.com\.au\/category\/solar/);
});

test("registry validation rejects a missing or stale source", () => {
  const names = SOURCE_REPAIR_STRATEGIES.map(({ name }) => name);
  assert.throws(
    () => validateSourceRepairStrategies(names.slice(1)),
    /mismatch/,
  );
  assert.throws(
    () =>
      validateSourceRepairStrategies([...names.slice(1), "Unapproved Source"]),
    /mismatch/,
  );
});


test("PV Magazine Global is scoped to Australian solar searches and uses bounded managed fallback", () => {
  const strategy = SOURCE_REPAIR_STRATEGIES.find(({ name }) => name === "PV Magazine Global");
  assert.ok(strategy);
  assert.deepEqual(strategy.officialUrls, [
    "https://www.pv-magazine.com/?s=Australia+solar+project",
    "https://www.pv-magazine.com/?s=Australia+solar+farm",
  ]);
  const plan = getSourceAcquisitionPlan("PV Magazine Global");
  assert.deepEqual(plan.methods, ["html", "firecrawl", "apify", "brightdata", "openai-normalisation"]);
  assert.equal(plan.firecrawlMode, "scrape");
  assert.equal(plan.maxFirecrawlPages, 1);
  assert.equal(plan.maxFirecrawlDepth, 0);
});


test("the 17 newly added publications have bounded managed acquisition", () => {
  const names = [
    "PV Tech", "Energy-Storage.news", "SolarQuarter", "Energy Global",
    "Green Review", "Renewables Now", "Power Technology", "Australian Mining",
    "Infrastructure Magazine", "Energy News Bulletin", "Carbon News NZ",
    "Energy News NZ", "SEANZ Utility Solar", "MBIE Energy", "BusinessDesk NZ",
    "NZ Herald Business", "EECA",
  ];
  for (const name of names) {
    const strategy = SOURCE_REPAIR_STRATEGIES.find((entry) => entry.name === name);
    assert.ok(strategy, name);
    const plan = getSourceAcquisitionPlan(name);
    assert.deepEqual(plan.methods, ["html", "firecrawl", "apify", "brightdata", "openai-normalisation"]);
    assert.equal(plan.maxFirecrawlPages, 1);
    assert.equal(plan.maxFirecrawlDepth, 0);
  }
});
