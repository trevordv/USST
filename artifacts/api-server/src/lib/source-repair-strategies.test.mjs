import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AEMO_GENERATION_WORKBOOK_URL,
  SOURCE_REPAIR_STRATEGIES,
  getSourceAcquisitionPlan,
  validateSourceRepairStrategies,
} from "./source-repair-strategies.ts";

const expectedGroups = {
  working: 9,
  inaccessible: 11,
  "extraction-problematic": 12,
  authenticated: 2,
};

test("the repair registry preserves exactly all 34 approved source slots", async () => {
  assert.equal(SOURCE_REPAIR_STRATEGIES.length, 34);
  assert.equal(
    new Set(SOURCE_REPAIR_STRATEGIES.map(({ name }) => name)).size,
    34,
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

test("all 23 audited repair sources have an explicit source-specific repair mode", async (t) => {
  const repaired = SOURCE_REPAIR_STRATEGIES.filter(
    ({ auditGroup }) =>
      auditGroup === "inaccessible" || auditGroup === "extraction-problematic",
  );
  assert.equal(repaired.length, 23);
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
