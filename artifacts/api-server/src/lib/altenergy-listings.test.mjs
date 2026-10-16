import assert from "node:assert/strict";
import test from "node:test";
import { parseAltEnergyDate, parseAltEnergyListing, parseWattNewsListing } from "./altenergy-listings.ts";

const card = (body) => `<div class="news-block-four"><div><div>${body}</div></div></div>`;

test("AltEnergy dates parse to ISO and never fall back to today", () => {
  assert.equal(parseAltEnergyDate("2026-June-12"), "2026-06-12");
  assert.equal(parseAltEnergyDate("2026-Junee-12"), null);
  assert.equal(parseAltEnergyDate("2026-February-30"), null);
  assert.equal(parseAltEnergyDate("garbage"), null);
});

test("newsandviews cards without a readable date are returned undated", () => {
  const html = card('<a href="https://altenergy.com.au/newsandviews/show/1">x</a><h3>Alpha Solar Farm</h3><p>Published Date: 2026-June-12</p>')
    + card('<a href="https://altenergy.com.au/newsandviews/show/2">x</a><h3>Beta Solar Farm</h3><p>no date here</p>');
  const cards = parseAltEnergyListing(html);
  assert.deepEqual(cards.map((c) => c.date), ["2026-06-12", null]);
});

test("watt_news issues without a readable date are returned undated", () => {
  const html = `<div class="pdf-block-watts-new"><div><div><a href="https://altenergy.com.au/watt_news/show/10">x</a><h2>Watts News 3 October 2026</h2></div></div></div>
    <div class="pdf-block-watts-new"><div><div><a href="https://altenergy.com.au/watt_news/show/11">x</a><h2>Watts News special edition</h2></div></div></div>`;
  assert.deepEqual(parseWattNewsListing(html), [
    { url: "https://altenergy.com.au/watt_news/show/10", date: "2026-10-03" },
    { url: "https://altenergy.com.au/watt_news/show/11", date: null },
  ]);
});
