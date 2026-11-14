import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedHostsFor,
  enrichProjectsFromDetailPages,
  extractMainText,
  extractSolarCapacityMw,
  isSameSiteUrl,
} from "./detail-enrichment.ts";

const project = (url, overrides = {}) => ({
  sourceUrl: url, capacityMw: null, developer: null, location: null,
  description: "short", status: "announced", ...overrides,
});

test("capacity must sit beside a solar phrase", () => {
  assert.equal(extractSolarCapacityMw("Acme will build a 250 MW solar farm near Dubbo."), 250);
  assert.equal(extractSolarCapacityMw("The 1.2 GW solar and storage hub will..."), 1200);
  assert.equal(extractSolarCapacityMw("A 300 MW wind farm was approved."), null);
  assert.equal(extractSolarCapacityMw("Approval for 1,500 MW pumped hydro."), null);
});

test("ignores battery capacity and nationwide statistics", () => {
  assert.equal(extractSolarCapacityMw("a 400 MW battery paired with the solar farm"), null);
  assert.equal(extractSolarCapacityMw("Australia has 30 GW of solar installed nationwide. The 180 MW solar farm will start."), 180);
  assert.equal(extractSolarCapacityMw("100 MWh of storage at the solar site"), null);
});

test("rejects implausible sizes", () => {
  assert.equal(extractSolarCapacityMw("a 9,000 MW solar precinct"), null);
});

test("main text prefers the article and drops navigation and scripts", () => {
  const html = `<nav>Menu 999 MW solar</nav><script>var a="1 MW solar"</script><article><p>Bravo 90 MW solar farm.</p></article><footer>foot</footer>`;
  const text = extractMainText(html);
  assert.equal(text, "Bravo 90 MW solar farm.");
});

test("detail pages must be on the same approved site", () => {
  const hosts = allowedHostsFor(["https://www.reneweconomy.com.au/feed/", "https://reneweconomy.com.au/?s=solar"]);
  assert.equal(isSameSiteUrl("https://reneweconomy.com.au/a-solar-farm/", hosts), true);
  assert.equal(isSameSiteUrl("https://news.reneweconomy.com.au/x", hosts), true);
  assert.equal(isSameSiteUrl("https://evil.example/reneweconomy.com.au", hosts), false);
  assert.equal(isSameSiteUrl("javascript:alert(1)", hosts), false);
});

test("opens capacity-less items on the same site and fills capacity", async () => {
  const fetched = [];
  const items = [
    project("https://news.test/a"),
    project("https://news.test/b", { capacityMw: 50 }),
    project("https://other.test/c"),
  ];
  const stats = await enrichProjectsFromDetailPages(items, {
    allowedHosts: allowedHostsFor(["https://news.test/feed/"]),
    fetchPage: async (url) => { fetched.push(url); return "<article>The 220 MW solar farm in Victoria, developed by Delta Energy.</article>"; },
    derive: () => ({ developer: "Delta Energy", location: "Victoria" }),
  });
  assert.deepEqual(fetched, ["https://news.test/a"]);
  assert.equal(items[0].capacityMw, 220);
  assert.equal(items[0].developer, "Delta Energy");
  assert.equal(items[0].location, "Victoria");
  assert.equal(items[1].capacityMw, 50);
  assert.equal(items[2].capacityMw, null);
  assert.equal(stats.enriched, 1);
  assert.equal(stats.candidates, 1);
});

test("known URLs, listing URLs and recent misses are not fetched", async () => {
  const fetched = [];
  const misses = new Map([["https://news.test/missed", 1_000]]);
  const items = [
    project("https://news.test/known"),
    project("https://news.test/list"),
    project("https://news.test/missed"),
    project("https://news.test/fresh"),
  ];
  const stats = await enrichProjectsFromDetailPages(items, {
    allowedHosts: allowedHostsFor(["https://news.test/"]),
    knownUrls: new Set(["https://news.test/known"]),
    listingUrls: new Set(["https://news.test/list"]),
    missCache: misses,
    now: () => 2_000,
    fetchPage: async (url) => { fetched.push(url); return "<p>nothing useful</p>"; },
  });
  assert.deepEqual(fetched, ["https://news.test/fresh"]);
  assert.equal(stats.skippedKnown, 1);
  assert.equal(stats.skippedRecentMiss, 1);
  assert.equal(stats.noCapacity, 1);
  assert.ok(misses.has("https://news.test/fresh"));
});

test("misses expire after the cache window", async () => {
  const fetched = [];
  const misses = new Map([["https://news.test/old", 0]]);
  await enrichProjectsFromDetailPages([project("https://news.test/old")], {
    allowedHosts: allowedHostsFor(["https://news.test/"]),
    missCache: misses,
    now: () => 25 * 60 * 60 * 1000,
    fetchPage: async (url) => { fetched.push(url); return "<p>x</p>"; },
  });
  assert.deepEqual(fetched, ["https://news.test/old"]);
});

test("per-source page limit and fetch failures are contained", async () => {
  const items = Array.from({ length: 5 }, (_, i) => project(`https://news.test/${i}`));
  const stats = await enrichProjectsFromDetailPages(items, {
    allowedHosts: allowedHostsFor(["https://news.test/"]),
    maxPages: 3,
    fetchPage: async () => { throw new Error("blocked"); },
  });
  assert.equal(stats.attempted, 3);
  assert.equal(stats.failed, 3);
  assert.equal(stats.skippedOverLimit, 2);
  assert.ok(items.every((item) => item.capacityMw == null));
});

test("operating projects are not enriched", async () => {
  const items = [project("https://news.test/live")];
  await enrichProjectsFromDetailPages(items, {
    allowedHosts: allowedHostsFor(["https://news.test/"]),
    isExcluded: (lead) => /now generating/.test(lead),
    fetchPage: async () => "<article>The 100 MW solar farm is now generating power.</article>",
  });
  assert.equal(items[0].capacityMw, null);
});
