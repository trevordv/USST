import assert from "node:assert/strict";
import test from "node:test";
import { enrichProjectsFromArticles } from "./article-enrichment.ts";

const hosts = new Set(["reneweconomy.com.au"]);
const base = (name, url, extra = {}) => ({
  name, sourceUrl: url, description: "excerpt", capacityMw: null, developer: null, location: null,
  status: "announced", needsArticleEnrichment: true, ...extra,
});
const article = (body) => `<html><nav>menu</nav><div class="entry-content"><div class="ad">ad</div><p>${"Filler sentence. ".repeat(20)}</p><p>${body}</p></div></html>`;
const options = (pages, extra = {}) => ({
  country: "AU", approvedHosts: hosts, isNoisyName: () => false,
  fetchHtml: async (url) => { if (!(url in pages)) throw new Error("HTTP 404"); return pages[url]; },
  ...extra,
});

test("capacity, developer, location and status are recovered from the article body", async () => {
  const project = base("Echo Solar Farm", "https://reneweconomy.com.au/echo");
  const result = await enrichProjectsFromArticles([project], options({
    "https://reneweconomy.com.au/echo": article("The 320 MW solar farm, developed by Acme Energy Pty Ltd, is under development in New South Wales."),
  }));
  assert.equal(result.enriched, 1);
  assert.equal(project.capacityMw, 320);
  assert.equal(project.location, "New South Wales");
  assert.equal(project.status, "under_development");
  assert.equal(project.needsArticleEnrichment, false);
});

test("only approved hosts are fetched (no ad-hoc sites)", async () => {
  const fetched = [];
  const project = base("Echo Solar Farm", "https://other.example/echo");
  const result = await enrichProjectsFromArticles([project], options({}, { fetchHtml: async (url) => { fetched.push(url); return ""; } }));
  assert.equal(result.attempted, 0);
  assert.deepEqual(fetched, []);
  assert.equal(project.capacityMw, null);
});

test("failures leave the candidate unchanged instead of throwing", async () => {
  const project = base("Echo Solar Farm", "https://reneweconomy.com.au/missing");
  const result = await enrichProjectsFromArticles([project], options({}));
  assert.equal(result.attempted, 1);
  assert.equal(result.enriched, 0);
  assert.equal(project.capacityMw, null);
});

test("an article that shows the project already operating is dropped", async () => {
  const project = base("Echo Solar Farm", "https://reneweconomy.com.au/echo");
  const result = await enrichProjectsFromArticles([project], options({
    "https://reneweconomy.com.au/echo": article("The 320 MW solar farm is now generating power."),
  }));
  assert.equal(result.dropped, 1);
  assert.deepEqual(result.kept, []);
});

test("statistics-only articles and noisy names are not enriched", async () => {
  const stats = base("Solar update", "https://reneweconomy.com.au/stats");
  const noisy = base("Industry snapshot", "https://reneweconomy.com.au/noisy");
  const result = await enrichProjectsFromArticles([stats, noisy], options({
    "https://reneweconomy.com.au/stats": article("Australia has 10 GW of cumulative solar capacity installed to date."),
    "https://reneweconomy.com.au/noisy": article("A 100 MW solar farm."),
  }, { isNoisyName: (name) => /snapshot/i.test(name) }));
  assert.equal(result.attempted, 1);
  assert.equal(stats.capacityMw, null);
  assert.equal(noisy.capacityMw, null);
});

test("the per-source fetch budget is enforced", async () => {
  const projects = Array.from({ length: 10 }, (_, index) => base(`P${index} Solar Farm`, `https://reneweconomy.com.au/p${index}`));
  let fetched = 0;
  const result = await enrichProjectsFromArticles(projects, options({}, { limit: 3, fetchHtml: async () => { fetched++; return ""; } }));
  assert.equal(result.attempted, 3);
  assert.equal(fetched, 3);
});
