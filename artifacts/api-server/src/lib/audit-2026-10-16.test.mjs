import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Wiring checks for the DB-backed scan loop, which cannot run without a database.
const scraper = await readFile(new URL("./scraper.ts", import.meta.url), "utf8");
const runScan = scraper.slice(scraper.indexOf("export async function runScan("));

test("scan-time PVH contact fallback uses the exact-company matcher only", () => {
  assert.doesNotMatch(scraper, /function matchFallbackContact\(/);
  assert.equal(runScan.match(/matchPvhFallbackContact\(project\.developer, pvhContacts\)/g)?.length, 2);
});

test("AltEnergy listing dates are never defaulted to the scan day", () => {
  assert.doesNotMatch(scraper, /parseAltEnergyDate\(/);
  assert.match(scraper, /if \(\(startDate \|\| endDate\) && !card\.date\) return false;/);
  assert.match(scraper, /if \(!listed\.date\) \{/);
});

test("scan loop links cross-source duplicates and never downgrades a same-scan insert", () => {
  assert.match(runScan, /nameMatchedProjectId \?\? crossSourceMatchedProjectId \?\? null/);
  assert.match(runScan, /eventType === "updated" && !insertedThisScan\.has\(persistedProjectId\)/);
});

test("completed scans persist the quality-gate rejection summary", () => {
  assert.match(runScan, /rejections\.record\("noisy-name", project\.sourceName\)/);
  assert.match(runScan, /rejections\.record\(ineligibilityReason, project\.sourceName\)/);
  assert.match(runScan, /status: "completed",[\s\S]{0,200}rejectionSummary: rejectionSummary/);
});

test("legacy token admin route with a hard-coded secret is removed", async () => {
  await assert.rejects(readFile(new URL("../routes/auth.ts", import.meta.url), "utf8"));
});

test("scan runs contact discovery for its new projects and never fails the scan on it", () => {
  assert.match(runScan, /discoverNewProjectContacts\(rows,/);
  assert.match(runScan, /relation\.isNew && \(!bounded \|\| isNewProjectInScanWindow\(relation, \{ startDate, endDate \}\)\)/);
  assert.match(runScan, /New project contact discovery failed; scan results are unaffected/);
  assert.match(runScan, /LUSHA_AUTO_ENRICH_NEW_PROJECTS/);
});

test("scan efficiency: batched last-seen writes and concurrent authenticated sources", () => {
  assert.doesNotMatch(runScan, /set\(\{ lastSeenAt: new Date\(\) \}\)\.where\(eq\(projectsTable\.id, existingProjectId\)\)/);
  assert.match(runScan, /await Promise\.all\(\[genericTask, altEnergyTask, luviTask\]\)/);
});

test("dated scan results endpoint returns only new in-window projects", async () => {
  const scans = await readFile(new URL("../routes/scans.ts", import.meta.url), "utf8");
  assert.match(scans, /relations\.filter\(\(relation\) => isNewProjectInScanWindow\(relation, window\)\)/);
});

test("Lusha calls use v3 endpoints only", async () => {
  const all = scraper + await readFile(new URL("./lusha-v3.ts", import.meta.url), "utf8");
  assert.doesNotMatch(all, /api\.lusha\.com\/prospecting\//);
  assert.doesNotMatch(all, /api\.lusha\.com\/v2\//);
});
