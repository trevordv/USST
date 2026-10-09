import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { extractListingCards, htmlToText } from "./listing-parser.ts";
import { extractSolarCapacityMw } from "./detail-enrichment.ts";

// Run the production parseHtmlPage / parseRssFeed bodies (and the keyword and
// capacity helpers they use) without importing the DB-backed scanner.
const scraper = await readFile(new URL("./scraper.ts", import.meta.url), "utf8");
function slice(from, to) {
  const start = scraper.indexOf(from);
  const end = scraper.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `missing ${from}`);
  return scraper.slice(start, end);
}
const helpers = slice("const EARLY_STAGE_KEYWORDS", "class SourceRequestError");
const parseHtml = slice("function parseHtmlPage(", "// ──────────────────────────────────────────────────────────────\n// Browse.AI integration");
const parseRss = slice("function parseRssFeed(", "/** Pick the right fetch function");
const compiled = `${stripTypeScriptTypes(`${helpers}\n${parseHtml}\n${parseRss}`)}\nreturn { parseHtmlPage, parseRssFeed };`;
const { parseHtmlPage, parseRssFeed } = new Function("extractListingCards", "htmlToText", "extractSolarCapacityMw", compiled)(
  extractListingCards, htmlToText, extractSolarCapacityMw,
);

const source = { name: "Example News", country: "AU", searchUrl: "https://news.test/category/solar/" };

const LIST_PAGE = `
<div class="archive-results">
  <h1>Solar news</h1>
  <div class="post-item">
    <div class="meta"><span class="date">12 September 2026</span></div>
    <h2><a href="/2026/acme-500mw-solar-farm">Acme 500 MW solar farm gets planning approval</a></h2>
    <div class="excerpt">Planning approval granted for the 500 MW solar project in NSW.</div>
  </div>
  <div class="post-item">
    <div class="meta"><span class="date">3 August 2026</span></div>
    <h2><a href="/2026/beta-120mw-solar-farm">Beta 120 MW solar farm application lodged</a></h2>
    <div class="excerpt">Application lodged for a 120 MW solar farm in Victoria.</div>
  </div>
</div>`;

test("nested cards with relative links and day-first dates yield distinct, dated projects", () => {
  const projects = parseHtmlPage(LIST_PAGE, source, undefined, undefined, "https://news.test/category/solar/");
  assert.equal(projects.length, 2);
  assert.deepEqual(projects.map((p) => p.sourceUrl), [
    "https://news.test/2026/acme-500mw-solar-farm",
    "https://news.test/2026/beta-120mw-solar-farm",
  ]);
  assert.deepEqual(projects.map((p) => p.announcedDate), ["2026-09-12", "2026-08-03"]);
  assert.deepEqual(projects.map((p) => p.capacityMw), [500, 120]);
});

test("the date window now works on Australian-format dates", () => {
  const projects = parseHtmlPage(LIST_PAGE, source, "2026-09-01", "2026-09-30", "https://news.test/category/solar/");
  assert.deepEqual(projects.map((p) => p.name), ["Acme 500 MW solar farm gets planning approval"]);
});

test("cards without a link get distinct fragment URLs instead of merging", () => {
  const html = `<article><h2>Alpha solar farm planning application lodged</h2><p>50 MW solar</p></article>
    <article><h2>Bravo solar farm planning application lodged</h2><p>60 MW solar</p></article>`;
  const projects = parseHtmlPage(html, source);
  assert.equal(projects.length, 2);
  assert.notEqual(projects[0].sourceUrl, projects[1].sourceUrl);
  assert.ok(projects.every((p) => p.sourceUrl.startsWith("https://news.test/category/solar/#")));
});

test("RSS items read capacity from the full article body when the teaser has none", () => {
  const xml = `<rss><channel><item>
    <title>Delta Energy lodges solar application</title>
    <link>https://news.test/delta</link>
    <pubDate>Sat, 12 Sep 2026 01:00:00 +0000</pubDate>
    <description>Application lodged this week.</description>
    <content:encoded><![CDATA[<p>Delta Energy has lodged plans for a 300 MW solar farm in Queensland.</p>]]></content:encoded>
  </item></channel></rss>`;
  const [item] = parseRssFeed(xml, source);
  assert.equal(item.capacityMw, 300);
  assert.equal(item.sourceUrl, "https://news.test/delta");
});

test("RSS body capacity is ignored when it is not about solar", () => {
  const xml = `<rss><channel><item>
    <title>Solar developer lodges application</title>
    <link>https://news.test/echo</link>
    <pubDate>Sat, 12 Sep 2026 01:00:00 +0000</pubDate>
    <description>Application lodged this week for a solar project.</description>
    <content:encoded><![CDATA[<p>The developer also owns a 400 MW wind farm.</p>]]></content:encoded>
  </item></channel></rss>`;
  const [item] = parseRssFeed(xml, source);
  assert.equal(item.capacityMw, null);
});
