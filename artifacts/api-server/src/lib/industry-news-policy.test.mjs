import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  INDUSTRY_NEWS_SOURCES,
  buildSearchPlans,
  candidateFromSearchRow,
  canonicalEventKey,
  chooseCanonical,
  evidenceStatusFor,
  extractCapacityFacts,
  groupEventCandidates,
  resolveIndustryNewsWindow,
  sourceForUrl,
  sydneyMidnightUtc,
} from "./industry-news-policy.ts";

const window = resolveIndustryNewsWindow({
  startDate: "2026-10-16",
  endDate: "2026-10-23",
});

function candidate(overrides = {}) {
  return {
    title: "AEMO approves 500 MW River Solar Farm grid connection",
    summary:
      "The NSW utility-scale solar project received its grid connection approval.",
    sourceName: "AEMO",
    sourceUrl: "https://www.aemo.com.au/news/river-solar",
    sourceKey: "aemo",
    sourceClass: "primary",
    author: null,
    country: "AU",
    region: "NSW",
    contentType: "industry",
    publishedDate: "2026-10-21",
    eventDate: null,
    category: "Grid Connections, Transmission and Curtailment",
    secondaryTopics: ["solar", "grid"],
    stakeholderGroups: ["developers-and-owners"],
    lifecycleStage: "approved",
    importance: 4,
    developmentStatus: "approved",
    capacityFacts: [{ value: 500, unit: "MW" }],
    contentHash: "one",
    ...overrides,
  };
}

test("Sydney midnight boundaries account for daylight saving", () => {
  assert.equal(
    sydneyMidnightUtc("2026-10-23").toISOString(),
    "2026-10-22T13:00:00.000Z",
  );
  assert.equal(
    sydneyMidnightUtc("2026-07-23").toISOString(),
    "2026-07-22T14:00:00.000Z",
  );
});

test("custom windows use inclusive start and exclusive day after the selected end", () => {
  assert.equal(window.startDate, "2026-10-16");
  assert.equal(window.endExclusiveDate, "2026-10-24");
  assert.equal(window.endAt.toISOString(), "2026-10-23T13:00:00.000Z");
});

test("every approved registry source is covered by a targeted plan", () => {
  const keys = new Set(
    buildSearchPlans(window).flatMap((plan) => plan.sourceKeys),
  );
  assert.deepEqual(
    [
      ...INDUSTRY_NEWS_SOURCES.map((source) => source.key).filter(
        (key) => !keys.has(key),
      ),
    ],
    [],
  );
});

test("only registry hosts can become candidates", () => {
  assert.equal(sourceForUrl("https://www.aemo.com.au/news/item")?.key, "aemo");
  assert.equal(sourceForUrl("https://unknown.example/solar"), null);
  assert.equal(sourceForUrl("http://www.aemo.com.au/news/item"), null);
  assert.equal(sourceForUrl("https://evil.aemo.com.au/news/item"), null);
  assert.equal(sourceForUrl("https://jobs.ashbyhq.com/unrelated/item"), null);
  assert.equal(
    sourceForUrl("https://jobs.ashbyhq.com/plantedsolar/item")?.key,
    "planted",
  );
});

test("an exact publication timestamp after the scan boundary is excluded", () => {
  const rolling = resolveIndustryNewsWindow({
    previousEnd: new Date("2026-10-22T13:00:00Z"),
    now: new Date("2026-10-23T01:00:00Z"),
  });
  const result = candidateFromSearchRow(
    {
      title: "AEMO reports 500 MW Australian utility-scale solar connection",
      url: "https://www.aemo.com.au/news/future-item",
      description: "The Australian NEM grid connection project update.",
      publishedAt: "2026-10-23T02:00:00Z",
    },
    { country: "AU", sourceKeys: ["aemo"], query: "test" },
    rolling,
    new Date("2026-10-23T01:00:00Z"),
  );
  assert.equal(result, null);
});

test("capacity extraction preserves AC, DC, peak and energy units", () => {
  assert.deepEqual(
    extractCapacityFacts("150 MWac / 168 MWdc, 172 MWp and 300 MWh"),
    [
      { value: 150, unit: "MWac" },
      { value: 168, unit: "MWdc" },
      { value: 172, unit: "MWp" },
      { value: 300, unit: "MWh" },
    ],
  );
});

test("global or foreign stories cannot be misclassified as New Zealand", () => {
  const result = candidateFromSearchRow(
    {
      title: "Michigan approves 300 MW solar farm",
      url: "https://www.pv-tech.org/michigan-solar",
      description: "A United States utility-scale project received approval.",
      date: "2026-10-21",
    },
    { country: "NZ", sourceKeys: ["pv-tech"], query: "test" },
    window,
  );
  assert.equal(result, null);
});

test("same event is grouped while a different jurisdiction remains separate", () => {
  const groups = groupEventCandidates([
    candidate(),
    candidate({
      title: "River Solar Farm wins 500 MW connection approval from AEMO",
      sourceUrl: "https://www.abc.net.au/news/river",
      sourceKey: "abc",
      sourceName: "ABC News",
      sourceClass: "secondary",
    }),
    candidate({
      title: "WA approves 500 MW Coastal Solar Farm",
      region: "WA",
      sourceUrl: "https://www.wa.gov.au/coastal",
      sourceKey: "wa-government",
    }),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups.find((group) => group.length === 2)?.length, 2);
});

test("primary plus independent reporting is corroborated and keeps primary canonical", () => {
  const group = [
    candidate(),
    candidate({
      sourceUrl: "https://www.abc.net.au/news/river",
      sourceKey: "abc",
      sourceName: "ABC News",
      sourceClass: "secondary",
    }),
  ];
  assert.equal(evidenceStatusFor(group), "independently_corroborated");
  assert.equal(chooseCanonical(group).sourceClass, "primary");
  assert.equal(
    canonicalEventKey(group[0]),
    canonicalEventKey({
      ...group[0],
      sourceUrl: "https://mirror.example/item",
    }),
  );
});

test("the existing scan action invokes the stricter workflow", async () => {
  const route = await readFile(
    new URL("../routes/scans.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /import\("\.\.\/lib\/industry-news-workflow"\)/);
  assert.match(route, /scanIndustryNewsWorkflow/);
});

test("production deploys fail closed when the archive migration is missing", async () => {
  const railway = JSON.parse(
    await readFile(new URL("../../../../railway.json", import.meta.url), "utf8"),
  );
  const migration = await readFile(
    new URL(
      "../../../../supabase/migrations/20261023023415_add_industry_news_market_intelligence_archive.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const gate = await readFile(
    new URL("../../../../lib/db/scripts/verify-schema.mjs", import.meta.url),
    "utf8",
  );

  assert.match(railway.deploy.preDeployCommand.join(" "), /verify-schema/);
  assert.match(migration, /add column if not exists canonical_key text/);
  assert.match(migration, /create table if not exists public\.industry_news_source_coverage/);
  assert.match(gate, /industry_news_source_coverage/);
  assert.match(gate, /Database migration gate failed/);
  assert.match(gate, /scripts\/scrapling\/validate\.mjs/);
});
