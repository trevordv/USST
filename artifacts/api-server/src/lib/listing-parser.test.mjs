import assert from "node:assert/strict";
import test from "node:test";
import {
  extractListingCards,
  feedPageUrl,
  findNextPageUrl,
  parseListingDate,
  resolveHttpUrl,
} from "./listing-parser.ts";

test("reads Australian day-first, ISO, month-first and numeric dates", () => {
  assert.equal(parseListingDate("Published 12 September 2026"), "2026-09-12");
  assert.equal(parseListingDate("5th Sept 2026 by staff"), "2026-09-05");
  assert.equal(parseListingDate("September 12, 2026"), "2026-09-12");
  assert.equal(parseListingDate("2026-09-12T10:00:00+10:00"), "2026-09-12");
  assert.equal(parseListingDate("Lodged 03/11/2026"), "2026-11-03");
});

test("date parsing rejects impossible dates and returns null when none present", () => {
  assert.equal(parseListingDate("31 February 2026"), null);
  assert.equal(parseListingDate("no date here, 250 MW"), null);
  assert.equal(parseListingDate("32/13/2026"), null);
});

test("uses the earliest date in the text", () => {
  assert.equal(parseListingDate("Updated 20 October 2026. Originally 3 March 2026"), "2026-10-20");
});

const NESTED_CARD = `
<div class="results-list">
  <h1>Search results</h1>
  <div class="post-item">
    <div class="meta"><span>12 September 2026</span></div>
    <h2><a href="/news/acme-500mw-solar-farm-approved">Acme 500 MW solar farm approved</a></h2>
    <div class="excerpt">Planning approval granted for the 500 MW solar project in NSW.</div>
  </div>
  <div class="post-item">
    <div class="meta">3 August 2026</div>
    <h2><a href="https://example.com.au/beta-solar">Beta Solar Farm lodged</a></h2>
    <div class="excerpt">Application lodged for a 120 MW solar farm in Victoria.</div>
  </div>
</div>`;

test("a nested card keeps its title, link, date and capacity text", () => {
  const cards = extractListingCards(NESTED_CARD, "https://example.com.au/news/");
  assert.equal(cards.length, 2);
  assert.equal(cards[0].title, "Acme 500 MW solar farm approved");
  assert.equal(cards[0].url, "https://example.com.au/news/acme-500mw-solar-farm-approved");
  assert.equal(cards[0].date, "2026-09-12");
  assert.match(cards[0].text, /500 MW solar project in NSW/);
  assert.equal(cards[1].url, "https://example.com.au/beta-solar");
  assert.equal(cards[1].date, "2026-08-03");
});

test("relative links resolve against the page URL, so cards do not share one URL", () => {
  const cards = extractListingCards(NESTED_CARD, "https://example.com.au/news/");
  assert.notEqual(cards[0].url, cards[1].url);
});

test("articles without a class are cards; time datetime wins", () => {
  const html = `<article><time datetime="2026-07-01T00:00:00Z">yesterday</time><h3><a href="p1">Gamma Solar</a></h3><p>Text</p></article>`;
  const [card] = extractListingCards(html, "https://x.test/list/");
  assert.equal(card.date, "2026-07-01");
  assert.equal(card.url, "https://x.test/list/p1");
});

test("wrapper elements with several headings are skipped in favour of their cards", () => {
  const html = `<div class="item-list"><article><h2>One solar</h2></article><article><h2>Two solar</h2></article></div>`;
  const cards = extractListingCards(html, "https://x.test/");
  assert.deepEqual(cards.map((c) => c.title), ["One solar", "Two solar"]);
});

test("cards without a usable link return a null url", () => {
  const html = `<article><h2>Solar without link</h2><a href="javascript:void(0)">x</a></article>`;
  const [card] = extractListingCards(html, "https://x.test/");
  assert.equal(card.url, null);
});

test("resolveHttpUrl only returns http(s) URLs", () => {
  assert.equal(resolveHttpUrl("mailto:a@b.c", "https://x.test/"), null);
  assert.equal(resolveHttpUrl("#top", "https://x.test/"), null);
  assert.equal(resolveHttpUrl("/a/b", "https://x.test/z/"), "https://x.test/a/b");
});

test("finds a same-host next page link and ignores other hosts", () => {
  const html = `<a class="page-numbers" href="/p/1">1</a><a class="next page-numbers" href="/news/page/2/">Next</a>`;
  assert.equal(findNextPageUrl(html, "https://x.test/news/"), "https://x.test/news/page/2/");
  assert.equal(findNextPageUrl(`<a rel="next" href="https://evil.test/x">n</a>`, "https://x.test/news/"), null);
  assert.equal(findNextPageUrl(`<link rel="next" href="/news/?page=2">`, "https://x.test/news/"), "https://x.test/news/?page=2");
  assert.equal(findNextPageUrl("<p>none</p>", "https://x.test/news/"), null);
});

test("feed pagination only applies to /feed/ URLs", () => {
  assert.equal(feedPageUrl("https://x.test/feed/", 2), "https://x.test/feed/?paged=2");
  assert.equal(feedPageUrl("https://x.test/category/solar/feed", 3), "https://x.test/category/solar/feed?paged=3");
  assert.equal(feedPageUrl("https://x.test/news/", 2), null);
});
