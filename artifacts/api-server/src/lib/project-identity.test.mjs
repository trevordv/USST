import assert from "node:assert/strict";
import test from "node:test";
import { assignProjectIdentityUrls } from "./project-identity.ts";

const listing = "https://www.planningportal.nsw.gov.au/major-projects/projects";

test("projects listed on one page keep distinct identities", () => {
  const rows = assignProjectIdentityUrls([listing], [
    { name: "Alpha Solar Farm", sourceUrl: listing },
    { name: "Beta Solar Farm", sourceUrl: listing },
  ]);
  assert.deepEqual(rows.map((row) => row.sourceUrl), [`${listing}#alpha-solar-farm`, `${listing}#beta-solar-farm`]);
});

test("a single project on a listing URL is still fragment-identified (stable across scans)", () => {
  const [row] = assignProjectIdentityUrls([`${listing}/`], [{ name: "Alpha Solar Farm", sourceUrl: listing }]);
  assert.equal(row.sourceUrl, `${listing}#alpha-solar-farm`);
});

test("unique article URLs are left untouched so stored records keep matching", () => {
  const rows = assignProjectIdentityUrls([listing], [{ name: "Alpha Solar Farm", sourceUrl: "https://example.com/news/alpha" }]);
  assert.equal(rows[0].sourceUrl, "https://example.com/news/alpha");
});

test("one article covering two projects splits them; result is order independent", () => {
  const url = "https://example.com/news/two-farms";
  const a = assignProjectIdentityUrls([], [{ name: "Alpha Solar Farm", sourceUrl: url }, { name: "Beta Solar Farm", sourceUrl: url }]);
  const b = assignProjectIdentityUrls([], [{ name: "Beta Solar Farm", sourceUrl: url }, { name: "Alpha Solar Farm", sourceUrl: url }]);
  const byName = (rows) => Object.fromEntries(rows.map((row) => [row.name, row.sourceUrl]));
  assert.deepEqual(byName(a), byName(b));
  assert.equal(byName(a)["Alpha Solar Farm"], `${url}#alpha-solar-farm`);
});

test("existing fragments (AEMO sites, Watts News sections) are preserved", () => {
  const rows = assignProjectIdentityUrls([], [{ name: "X Solar", sourceUrl: "https://a.example/w.xlsx#site=X" }]);
  assert.equal(rows[0].sourceUrl, "https://a.example/w.xlsx#site=X");
});

test("cross-source key merges naming variants of one project only", async () => {
  const { canonicalProjectKey, capacitiesCompatible } = await import("./project-identity.ts");
  const key = canonicalProjectKey("Corop Solar Farm", "AU");
  assert.equal(key, "AU|corop solar");
  assert.equal(canonicalProjectKey("Corop Solar Project", "AU"), key);
  assert.equal(canonicalProjectKey("Corop Solar & BESS Project", "AU"), key);
  assert.equal(canonicalProjectKey("Corop Solar Farm", "NZ"), "NZ|corop solar");
  assert.notEqual(canonicalProjectKey("Corop Solar Farm Stage 2", "AU"), key);
  assert.notEqual(canonicalProjectKey("Corop East Solar Farm", "AU"), key);
  assert.equal(canonicalProjectKey("Solar Farm", "AU"), null);
  assert.equal(canonicalProjectKey("Ayr Solar Farm", "AU"), null);
  assert.equal(capacitiesCompatible(440, 400), true);
  assert.equal(capacitiesCompatible(440, null), true);
  assert.equal(capacitiesCompatible(440, 100), false);
});
