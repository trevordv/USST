import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("privileged routes are wired to server-side admin authorization while reads remain available", async () => {
  const [projects, scans, epbc, auth] = await Promise.all([
    readFile(new URL("./projects.ts", import.meta.url), "utf8"),
    readFile(new URL("./scans.ts", import.meta.url), "utf8"),
    readFile(new URL("./epbc.ts", import.meta.url), "utf8"),
    readFile(new URL("../middlewares/supabase-auth.ts", import.meta.url), "utf8"),
  ]);
  for (const route of [projects, scans, epbc]) assert.match(route, /requireAdmin/);
  assert.match(projects, /router\.post\("\/projects", requireAdmin/);
  assert.match(projects, /router\.post\("\/projects\/enrich-contacts", requireAdmin/);
  assert.match(projects, /router\.get\("\/projects", async/);
  assert.match(scans, /router\.post\("\/scans", requireAdmin/);
  assert.match(epbc, /router\.post\("\/epbc\/sync", requireAdmin/);
  assert.match(epbc, /router\.post\("\/epbc\/upload", requireAdmin/);
  assert.match(epbc, /router\.post\("\/epbc\/projects\/:id\/import", requireAdmin/);
  assert.match(scans, /requireAdmin, async[\s\S]*admitCostlyOperation\("scan"[\s\S]*import\("\.\.\/lib\/scraper"/);
  assert.match(projects, /requireAdmin, async[\s\S]*admitCostlyOperation\("enrichment"[\s\S]*import\("\.\.\/lib\/scraper"/);
  assert.match(epbc, /requireAdmin, async[\s\S]*admitCostlyOperation\("epbc-sync"[\s\S]*fetchEpbcRecords/);
  assert.match(auth, /if \(!user\) \{[\s\S]*status\(401\)/);
  assert.match(auth, /if \(user\.role !== "admin"\) \{[\s\S]*status\(403\)/);
  assert.match(auth, /if \(user\.role !== "admin"\)[\s\S]*next\(\)/);
  assert.match(scans, /\.finally\(admission\.release\)/);
  assert.match(projects, /completion\.finally\(admission\.release\)/);
  assert.match(epbc, /finally \{ admission\.release\(\); \}/);
  for (const source of [projects, scans, epbc, auth]) {
    assert.doesNotMatch(source, /TEST_AUTH_BYPASS|DISABLE_AUTH|SKIP_AUTH/);
  }
});
