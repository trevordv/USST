import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyScanProjectEvent, summarizeScanLineage, getProjectIneligibilityReason } from "./project-eligibility.ts";
import { decideScanDateWindow, filterRelationsForScanWindow, parseSourceAnnouncementDate } from "./scan-date-window.ts";

const window = { startDate: "2026-08-07", endDate: "2026-08-14" };

test("existing LUVI project dated Aug 4 is excluded from an Aug 7-14 scan", () => {
  assert.deepEqual(decideScanDateWindow({ ...window, existingProject: true, persistedAnnouncedDate: "2026-08-04", scrapedAnnouncedDate: "2026-08-14" }), {
    include: false, effectiveDate: "2026-08-04", evidence: "persisted_announcement", reason: "before-start",
  });
});

test("new LUVI project with a source-supported Aug 10 event is included", () => {
  assert.equal(parseSourceAnnouncementDate({ eventDate: "2026-08-10", updatedAt: "2026-08-14" }), "2026-08-10");
  assert.equal(decideScanDateWindow({ ...window, existingProject: false, scrapedAnnouncedDate: "2026-08-10" }).include, true);
});

test("existing media project dated Aug 13 is included", () => {
  assert.equal(decideScanDateWindow({ ...window, existingProject: true, persistedAnnouncedDate: "2026-08-13", scrapedAnnouncedDate: "2026-08-14" }).include, true);
});

test("out-of-range existing lineage is neither linked nor counted", () => {
  const included = filterRelationsForScanWindow([
    { projectId: 1, isNew: false, eventType: "updated", effectiveDate: "2026-08-04" },
    { projectId: 2, isNew: false, eventType: "updated", effectiveDate: "2026-08-13" },
  ], window);
  assert.deepEqual(included.map((row) => row.projectId), [2]);
  assert.deepEqual(summarizeScanLineage(included, { bounded: true }), { projectsFound: 1, newProjects: 0, updatedProjects: 1, inventoryObservedCount: 0 });
});

test("View found and View new derive only from persisted in-window lineage", () => {
  const found = filterRelationsForScanWindow([
    { projectId: 1, isNew: false, effectiveDate: "2026-08-04" },
    { projectId: 2, isNew: true, effectiveDate: "2026-08-10" },
    { projectId: 3, isNew: false, effectiveDate: "2026-08-13" },
  ], window);
  assert.deepEqual(found.map((row) => row.projectId), [2, 3]);
  assert.deepEqual(found.filter((row) => row.isNew).map((row) => row.projectId), [2]);
});

test("rediscovery today cannot make an old persisted announcement current", () => {
  const result = decideScanDateWindow({ ...window, existingProject: true, persistedAnnouncedDate: "2024-03-01", scrapedAnnouncedDate: "2026-08-14" });
  assert.equal(result.include, false);
  assert.equal(result.effectiveDate, "2024-03-01");
});

test("AltEnergy event/news updates still use their event date", () => {
  const result = decideScanDateWindow({
    ...window,
    existingProject: true,
    persistedAnnouncedDate: "2024-03-01",
    scrapedAnnouncedDate: null,
    sourceEventDate: "2026-08-12",
    sourceEventEvidence: "altenergy_source_update",
  });
  assert.deepEqual(result, {
    include: true,
    effectiveDate: "2026-08-12",
    evidence: "altenergy_source_update",
    reason: "in-window",
  });
  assert.deepEqual(summarizeScanLineage([{ projectId: 283, isNew: false, eventType: "updated", effectiveDate: result.effectiveDate }], { bounded: true }), {
    projectsFound: 1,
    newProjects: 0,
    updatedProjects: 1,
    inventoryObservedCount: 0,
  });
});

test("Watts News evidence creates a dated Updated event without redefining is_new", () => {
  const result = decideScanDateWindow({
    startDate: "2026-09-07",
    endDate: "2026-09-14",
    existingProject: true,
    persistedAnnouncedDate: "2026-03-26",
    scrapedAnnouncedDate: "2026-09-11",
    sourceEventDate: "2026-09-11",
    sourceEventEvidence: "altenergy_watts_news_update",
  });
  assert.equal(result.effectiveDate, "2026-09-11");
  assert.equal(result.evidence, "altenergy_watts_news_update");
  assert.equal(classifyScanProjectEvent({ isNew: false, dateEvidence: result.evidence }), "updated");
  assert.equal(classifyScanProjectEvent({ isNew: true, dateEvidence: result.evidence }), "new");
  assert.equal(classifyScanProjectEvent({ isNew: false, dateEvidence: "altenergy_inventory_observation" }), "inventory_observed");
});

test("AltEnergy event/news updates outside the window are excluded", () => {
  assert.deepEqual(decideScanDateWindow({
    ...window,
    existingProject: true,
    persistedAnnouncedDate: "2024-03-01",
    sourceEventDate: "2026-08-06",
    sourceEventEvidence: "altenergy_source_update",
  }), {
    include: false,
    effectiveDate: "2026-08-06",
    evidence: "altenergy_source_update",
    reason: "before-start",
  });
});

test("new AltEnergy inventory record gets lineage but no fabricated announcement date", () => {
  const scrapedProject = {
    announcedDate: null,
    sourceEventDate: "2026-08-10",
  };
  assert.deepEqual(decideScanDateWindow({
    ...window,
    existingProject: false,
    scrapedAnnouncedDate: scrapedProject.announcedDate,
    sourceEventDate: scrapedProject.sourceEventDate,
    sourceEventEvidence: "altenergy_source_update",
    inventoryObservation: true,
  }), {
    include: true,
    effectiveDate: null,
    evidence: "altenergy_inventory_observation",
    reason: "inventory-observation",
  });
  assert.equal(scrapedProject.announcedDate, null);
});

test("Gunnedah inventory is linked in August despite January updated_at and preserves history", () => {
  const historicalAnnouncement = "2026-01-06";
  const result = decideScanDateWindow({
    ...window,
    existingProject: true,
    persistedAnnouncedDate: historicalAnnouncement,
    sourceEventDate: "2026-01-06",
    sourceEventEvidence: "altenergy_source_update",
    inventoryObservation: true,
  });
  assert.equal(result.include, true);
  assert.equal(result.effectiveDate, null);
  assert.equal(result.evidence, "altenergy_inventory_observation");
  assert.equal(historicalAnnouncement, "2026-01-06");
  const lineage = filterRelationsForScanWindow([{
    projectId: 283,
    isNew: false,
    effectiveDate: result.effectiveDate,
    dateEvidence: result.evidence,
  }], window);
  assert.deepEqual(summarizeScanLineage(lineage, { bounded: true }), {
    projectsFound: 0,
    newProjects: 0,
    updatedProjects: 0,
    inventoryObservedCount: 1,
  });
});

test("unknown dates are excluded from bounded scans and allowed without a date window", () => {
  assert.deepEqual(decideScanDateWindow({ ...window, existingProject: false, scrapedAnnouncedDate: null }), { include: false, effectiveDate: null, evidence: "unknown", reason: "unknown-date" });
  assert.equal(decideScanDateWindow({ existingProject: false, scrapedAnnouncedDate: null }).include, true);
  assert.equal(parseSourceAnnouncementDate({ updatedAt: "2026-08-14", importedAt: "2026-08-14" }), null);
  assert.equal(parseSourceAnnouncementDate({ eventDate: "2026-02-30" }), null);
});

test("RUN-0095 fixture excludes all 204 Aug 4 LUVI projects", () => {
  const run95Luvi = Array.from({ length: 204 }, (_, index) => ({ projectId: index + 1, isNew: false, effectiveDate: "2026-08-04", sourceName: "LUVI Project Tracker" }));
  const found = filterRelationsForScanWindow(run95Luvi, window);
  assert.equal(found.length, 0);
  assert.deepEqual(summarizeScanLineage(found, { bounded: true }), { projectsFound: 0, newProjects: 0, updatedProjects: 0, inventoryObservedCount: 0 });
});

test("hard eligibility rules remain unchanged", () => {
  assert.equal(getProjectIneligibilityReason({ name: "Tiny Solar", capacityMw: 4, country: "AU" }), "below-minimum-capacity");
  assert.equal(getProjectIneligibilityReason({ name: "Standalone BESS", capacityMw: 100, country: "AU" }), "no-solar-component");
  assert.equal(getProjectIneligibilityReason({ name: "Coastal Wind Farm", capacityMw: 100, country: "AU" }), "wind-project");
});

test("routes persist the requested window and both scan views use authoritative lineage", async () => {
  const [scanRoutes, projectRoutes, detail] = await Promise.all([
    readFile(new URL("../routes/scans.ts", import.meta.url), "utf8"),
    readFile(new URL("../routes/projects.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../solar-tracker/src/pages/scan-detail.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(scanRoutes, /startDate: parsed\.data\.startDate/);
  assert.match(scanRoutes, /filterRelationsForScanWindow/);
  assert.match(scanRoutes, /eventSourceUrl/);
  assert.match(projectRoutes, /eq\(projectsTable\.scanId, scanId\)/);
  assert.match(detail, /\+\{newCount\}/);
  assert.match(detail, /Inventory Observed/);
  assert.match(detail, /Updated/);
  assert.match(detail, /useState<ScanResultFilter>\("scan_period"\)/);
  assert.match(detail, /\["scan_period", "Scan Period", scanPeriodCount\]/);
  assert.match(detail, /order-2 border rounded-lg/);
  assert.match(detail, /order-3 border rounded-lg/);
});

test("Watts News fallback repairs bounded sections instead of using a newsletter-wide zero gate", async () => {
  const scraper = await readFile(new URL("./scraper.ts", import.meta.url), "utf8");
  assert.match(scraper, /parseWattNewsSections\(newsletterHtml/);
  assert.match(scraper, /parseWattNewsWithChatGpt\(section\.text/);
  assert.doesNotMatch(scraper, /foundInNewsletter\s*===\s*0/);
  assert.match(scraper, /solar_capacity_mw is solar generation MW only/);
  assert.match(scraper, /!eligibleExistingProjectIds\.has\(existingProjectId\) && !wattsMatch/);
});

test("the schema migration preserves historical production values for an explicit remediation", async () => {
  const migration = await readFile(
    new URL("../../../../supabase/migrations/20260814000632_fix_scan_date_window.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /ALTER COLUMN announced_date DROP NOT NULL/i);
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE FROM)\s+public\.(?:projects|scan_projects|scans)\b/i);
});
