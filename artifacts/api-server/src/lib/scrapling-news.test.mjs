import assert from "node:assert/strict";
import test from "node:test";
import { parseScraplingNewsPage } from "./scrapling-news.ts";

const source = { name: "Energy Magazine", country: "AU", searchUrl: "https://www.energymagazine.com.au/?s=solar+project" };
// De-identified version of the live search-result card structure, not publisher text.
const card = date => `<article class="jeg_post"><div class="jeg_postblock_content">
  <h3 class="jeg_post_title"><a href="/river-solar/">River Solar Farm approved in NSW</a></h3>
  <div class="jeg_meta_date"><a href="/river-solar/">${date}</a></div>
  <div class="jeg_post_excerpt">A proposed 50 MW solar farm in Australia.</div></div></article>`;

test("release and production parser extract a dated qualifying candidate from a nested news card", () => {
  const [item] = parseScraplingNewsPage(card("September 29, 2026"), source, "2026-09-28", "2026-10-01");
  assert.equal(item.name, "River Solar Farm");
  assert.equal(item.capacityMw, 50);
  assert.equal(item.announcedDate, "2026-09-29");
  assert.equal(item.sourceUrl, "https://www.energymagazine.com.au/river-solar/");
});

test("dated historical cards produce a valid scan-window zero without requesting repair", () => {
  assert.deepEqual(parseScraplingNewsPage(card("October 21, 2024"), source, "2026-09-28", "2026-10-01"), []);
  assert.deepEqual(parseScraplingNewsPage(card("October 2, 2026"), source, undefined, "2026-10-01"), []);
});

test("unknown dates, navigation shells and changed structures are not historical-zero evidence", () => {
  for (const html of [card("Date unknown"), "<article>Solar navigation</article>", "<main>Solar navigation</main>"]) {
    assert.throws(() => parseScraplingNewsPage(html, source, "2026-09-28", "2026-10-01"));
  }
});

test("an explicit empty state and unrelated readable cards remain legitimate zero results", () => {
  assert.deepEqual(parseScraplingNewsPage("<main>No matching results</main>", source, "2026-09-28", "2026-10-01"), []);
  assert.deepEqual(parseScraplingNewsPage("<article>Gas network update</article>", source, "2026-09-28", "2026-10-01"), []);
});
