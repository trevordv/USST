import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeHtmlEntities,
  deriveProjectName,
  extractCapacityMw,
  extractElementBlocks,
  extractMainText,
  htmlToText,
  normalizeProjectName,
  projectSlug,
} from "./source-text.ts";

test("capacity: thousands separators are not truncated (1,200 MW)", () => {
  assert.equal(extractCapacityMw("The 1,200 MW Example Solar Farm was proposed"), 1200);
  assert.equal(extractCapacityMw("a 1,250.5MW solar hub"), 1250.5);
});

test("capacity: GW converts to MW and decimals are kept", () => {
  assert.equal(extractCapacityMw("a 1.2 GW solar and battery hub"), 1200);
  assert.equal(extractCapacityMw("a 275.5 MW solar farm"), 275.5);
});

test("capacity: MWh / GWh energy figures are never read as MW", () => {
  assert.equal(extractCapacityMw("a 400 MWh battery"), null);
  assert.equal(extractCapacityMw("1.6 GWh of storage"), null);
});

test("capacity: solar rating wins over battery rating in a hybrid project", () => {
  const text = "The project pairs a 150 MW solar farm with a 100 MW / 200 MWh battery in regional NSW.";
  assert.equal(extractCapacityMw(text), 150);
});

test("capacity: battery-only rating is not attributed to a solar project", () => {
  assert.equal(extractCapacityMw("The solar farm will include a 100 MW battery."), null);
});

test("capacity: industry statistics are rejected", () => {
  assert.equal(extractCapacityMw("Australia has 10 GW of cumulative large-scale solar installed to date."), null);
});

test("capacity: AC/DC suffixes and hyphenated forms are accepted", () => {
  assert.equal(extractCapacityMw("a 200MWac solar farm"), 200);
  assert.equal(extractCapacityMw("a 400-MW solar park"), 400);
  assert.equal(extractCapacityMw("a 250 megawatt solar plant"), 250);
});

test("capacity: picks the mention nearest solar rather than the first number", () => {
  const text = "The 30 MW wind farm nearby is unrelated. Meanwhile the 220 MW solar farm was lodged.";
  assert.equal(extractCapacityMw(text), 220);
});

test("balanced element extraction survives nested divs", () => {
  const html = '<div class="post"><div class="meta">x</div><h2><a href="/a">Alpha Solar Farm</a></h2><p>200 MW</p></div><div class="post"><h2>Beta</h2></div>';
  const blocks = extractElementBlocks(html, ["div"], /class="post"/);
  assert.equal(blocks.length, 2);
  assert.match(blocks[0].inner, /Alpha Solar Farm/);
  assert.match(blocks[0].inner, /200 MW/);
});

test("main text is not truncated at the first nested closing div", () => {
  const paragraph = "Paragraph. ".repeat(40);
  const html = `<html><nav>menu</nav><div class="entry-content"><div class="ad">ad</div><p>${paragraph}</p><p>The 300 MW Delta Solar Farm was approved.</p></div><footer>foot</footer></html>`;
  const text = extractMainText(html);
  assert.match(text, /300 MW Delta Solar Farm/);
  assert.doesNotMatch(text, /menu|foot/);
});

test("entities are decoded", () => {
  assert.equal(decodeHtmlEntities("Neoen&#8217;s &amp; Co &#x26; more"), "Neoen’s & Co & more");
  assert.equal(htmlToText("<p>A&nbsp;B</p><script>x()</script><p>C</p>"), "A B C");
});

test("project names are derived from headlines conservatively", () => {
  assert.equal(deriveProjectName("Neoen's 400 MW Culcairn Solar Farm wins approval"), "Culcairn Solar Farm");
  assert.equal(deriveProjectName("Green light for New Boree Solar Farm"), "Boree Solar Farm");
  assert.equal(deriveProjectName("Solar farm approved in NSW"), null);
  assert.equal(deriveProjectName("Big year for renewables"), null);
});

test("name identity helpers", () => {
  assert.equal(normalizeProjectName("Smith’s  Solar-Farm & BESS"), "smiths solar farm and bess");
  assert.equal(projectSlug("Boree Solar Farm"), "boree-solar-farm");
});

import { isApprovedDiscoveredUrl, nextListingPageUrl, parseTextDate, resolveHttpUrl, siteHost } from "./source-text.ts";

test("text dates: ISO, day-first and month-first; never today", () => {
  assert.equal(parseTextDate("Published 2026-06-12"), "2026-06-12");
  assert.equal(parseTextDate("Posted 5 June 2026 by staff"), "2026-06-05");
  assert.equal(parseTextDate("June 12th, 2026"), "2026-06-12");
  assert.equal(parseTextDate("Sept 3, 2026"), "2026-09-03");
  assert.equal(parseTextDate("Posted 12/09/2026"), "2026-09-12");
  assert.equal(parseTextDate("32/13/2026"), null);
  assert.equal(parseTextDate("31 February 2026"), null);
  assert.equal(parseTextDate("no date here"), null);
});

test("url helpers", () => {
  assert.equal(resolveHttpUrl("/news/a", "https://example.com/list/"), "https://example.com/news/a");
  assert.equal(resolveHttpUrl("#top", "https://example.com/"), null);
  assert.equal(resolveHttpUrl("mailto:a@b.c", "https://example.com/"), null);
  assert.equal(siteHost("https://www.Example.com/x"), "example.com");
});

test("discovered pages stay on exact approved HTTPS hosts without credentials", () => {
  const hosts = new Set(["example.com"]);
  assert.equal(isApprovedDiscoveredUrl("https://www.example.com/news/a", hosts), true);
  assert.equal(isApprovedDiscoveredUrl("https://example.com.evil.test/a", hosts), false);
  assert.equal(isApprovedDiscoveredUrl("https://evil.test@www.example.com/a", hosts), false);
  assert.equal(isApprovedDiscoveredUrl("http://www.example.com/a", hosts), false);
  assert.equal(isApprovedDiscoveredUrl("https://www.example.com:8443/a", hosts), false);
});

test("next listing page is same-host and explicitly marked", () => {
  const base = "https://www.example.com/news/";
  assert.equal(nextListingPageUrl('<a class="next page-numbers" href="/news/page/2/">Next</a>', base), "https://www.example.com/news/page/2/");
  assert.equal(nextListingPageUrl('<link rel="next" href="/news/?page=2">', base), "https://www.example.com/news/?page=2");
  assert.equal(nextListingPageUrl('<a rel="next" href="https://evil.test/x">Next</a>', base), null);
});
