import assert from "node:assert/strict";
import test from "node:test";
import { parseHtmlPage, parseRssFeed, parseRssFeedPage } from "./news-parsers.ts";
import { extractCapacity } from "./source-heuristics.ts";

const source = { name: "Renew Economy", country: "AU", searchUrl: "https://reneweconomy.com.au/category/solar/" };

const feed = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<item><title>Neoen&#8217;s Culcairn Solar Farm wins NSW planning approval</title><link>https://reneweconomy.com.au/culcairn</link>
<pubDate>Mon, 10 Aug 2026 01:00:00 +0000</pubDate><description><![CDATA[<p>The project has been approved.</p>]]></description>
<content:encoded><![CDATA[<p>The project has been approved.</p><p>The 1,200 MW solar farm near Culcairn will include a 400 MWh battery, developer Neoen said, in southern New South Wales.</p>]]></content:encoded></item>
<item><title>Industry snapshot: renewables grow</title><link>https://reneweconomy.com.au/snapshot</link><pubDate>Mon, 10 Aug 2026 01:00:00 +0000</pubDate>
<description>Australia has 10 GW of cumulative solar installed to date.</description></item>
<item><title>Alpha Solar Farm energised in Victoria</title><link>https://reneweconomy.com.au/alpha</link><pubDate>Mon, 10 Aug 2026 01:00:00 +0000</pubDate><description>The 90 MW solar farm is now generating power.</description></item>
<item><title>Bravo Solar Farm proposed near Dubbo</title><link>https://reneweconomy.com.au/bravo</link><description>A proposed solar farm.</description></item>
<item><title>Old Charlie Solar Farm lodged</title><link>https://reneweconomy.com.au/charlie</link><pubDate>Mon, 01 Jun 2026 01:00:00 +0000</pubDate><description>A 150 MW solar farm application lodged.</description></item>
<item><title>Delta Solar Farm plans</title><link>https://reneweconomy.com.au/delta</link><pubDate>Tue, 11 Aug 2026 01:00:00 +0000</pubDate><description>Plans for a solar farm were announced, no size given.</description></item>
</channel></rss>`;

test("RSS: full-article capacity is used (1,200 MW, not 200 or the 400 MWh battery) and the project is named", () => {
  const [culcairn] = parseRssFeed(feed, source);
  assert.equal(culcairn.capacityMw, 1200);
  assert.equal(culcairn.name, "Culcairn Solar Farm");
  assert.match(culcairn.description, /Neoen’s Culcairn Solar Farm wins NSW planning approval/);
  assert.equal(culcairn.developer !== null, true);
  assert.equal(culcairn.announcedDate, "2026-08-10");
  assert.equal(culcairn.announcedDateEvidence, "source_reported");
  assert.equal(culcairn.needsArticleEnrichment, false);
});

test("RSS: statistics never become a project capacity; operational articles are excluded", () => {
  const rows = parseRssFeed(feed, source);
  const snapshot = rows.find((project) => /snapshot/i.test(project.name));
  assert.equal(snapshot?.capacityMw ?? null, null); // "10 GW cumulative" is not a project rating
  assert.ok(!rows.some((project) => /Alpha/.test(project.name))); // "energised" / "now generating"
});

test("RSS: an undated item is unknown (null), never today's date, and is excluded from bounded windows", () => {
  const unbounded = parseRssFeed(feed, source);
  const bravo = unbounded.find((project) => /Bravo/.test(project.name));
  assert.equal(bravo.announcedDate, null);
  assert.equal(bravo.announcedDateEvidence, "unknown");
  const bounded = parseRssFeed(feed, source, "2026-08-01", "2026-08-31").map((project) => project.name);
  assert.ok(!bounded.some((name) => /Bravo/.test(name)));
  assert.ok(!bounded.some((name) => /Charlie/.test(name)));
});

test("RSS: items without a capacity in the excerpt are flagged for a same-site article read", () => {
  const delta = parseRssFeed(feed, source).find((project) => /Delta/.test(project.name));
  assert.equal(delta.capacityMw, null);
  assert.equal(delta.needsArticleEnrichment, true);
});

test("RSS page summary supports paging decisions", () => {
  const page = parseRssFeedPage(feed, source, "2026-08-01");
  assert.equal(page.itemCount, 6);
  assert.equal(page.oldestDate, "2026-06-01");
  assert.equal(page.firstLink, "https://reneweconomy.com.au/culcairn");
});

const listing = `<html><body>
<div class="search-results">
  <div class="post-card"><div class="post-thumb"><img src="a.jpg"></div>
    <div class="post-body"><h3><a href="/news/echo-solar-farm">Echo Solar Farm proposed near Wagga</a></h3>
    <time datetime="2026-08-12T00:00:00+10:00">12 August 2026</time>
    <p>A proposed 250 MW solar farm has been lodged for planning approval in NSW.</p></div></div>
  <div class="post-card"><div class="post-body"><h3><a href="https://reneweconomy.com.au/news/foxtrot">Foxtrot Solar Project approved</a></h3>
    <p>Approved solar project in Queensland, size to be confirmed.</p></div></div>
  <div class="post-card"><div class="post-body"><h3>Golf Solar Farm application lodged</h3>
    <p>An application for a 120 MW solar farm in Victoria was lodged on 3 September 2026.</p></div></div>
  <div class="post-card"><h3><a href="/news/wind">Hotel Wind Farm approved</a></h3><p>Wind only.</p></div>
</div></body></html>`;

test("HTML: nested cards keep title, resolved link, date and capacity (regression: non-greedy div regex)", () => {
  const rows = parseHtmlPage(listing, source);
  const echo = rows.find((row) => /Echo/.test(row.name));
  assert.ok(echo, "Echo card should be found despite nested divs");
  assert.equal(echo.sourceUrl, "https://reneweconomy.com.au/news/echo-solar-farm");
  assert.equal(echo.capacityMw, 250);
  assert.equal(echo.announcedDate, "2026-08-12");
  assert.equal(echo.needsArticleEnrichment, false);
});

test("HTML: link-less cards get a per-project identity, undated cards stay undated, missing capacity is flagged", () => {
  const rows = parseHtmlPage(listing, source);
  const golf = rows.find((row) => /Golf/.test(row.name));
  assert.equal(golf.sourceUrl, "https://reneweconomy.com.au/category/solar/#golf-solar-farm");
  assert.equal(golf.announcedDate, "2026-09-03");
  const foxtrot = rows.find((row) => /Foxtrot/.test(row.name));
  assert.equal(foxtrot.announcedDate, null);
  assert.equal(foxtrot.capacityMw, null);
  assert.equal(foxtrot.needsArticleEnrichment, true);
});

test("HTML: bounded window excludes undated cards and out-of-window dates", () => {
  const rows = parseHtmlPage(listing, source, "2026-08-01", "2026-08-31").map((row) => row.name);
  assert.deepEqual(rows.filter((name) => /Echo|Foxtrot|Golf/.test(name)), ["Echo Solar Farm"]);
});

test("shared capacity helper is the one used by every parser", () => {
  assert.equal(extractCapacity("a 1,200 MW solar farm"), 1200);
});
