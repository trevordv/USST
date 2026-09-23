import { Router, type IRouter } from "express";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db, scansTable, projectsTable, scanProjectsTable, scanSourceHealthTable } from "@workspace/db";
import { TriggerScanBody, GetScanParams } from "@workspace/api-zod";
import { classifyScanProjectEvent, filterEligibleScanProjects } from "../lib/project-eligibility";
import { filterRelationsForScanWindow } from "../lib/scan-date-window";
import { requireAdmin } from "../middlewares/supabase-auth";
import { admitCostlyOperation } from "../lib/job-admission";

const router: IRouter = Router();

// GET /scans
router.get("/scans", async (_req, res): Promise<void> => {
  const scans = await db
    .select()
    .from(scansTable)
    .orderBy(desc(scansTable.startedAt));

  res.json(
    scans.map((s) => ({
      ...s,
      startedAt: s.startedAt.toISOString(),
      completedAt: s.completedAt ? s.completedAt.toISOString() : null,
    }))
  );
});

// POST /scans
router.post("/scans", requireAdmin, async (req, res): Promise<void> => {
  const parsed = TriggerScanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const admission = admitCostlyOperation("scan", res.locals.usstUser.id);
  if (!admission) {
    req.log.warn({ operation: "scan" }, "Costly operation rejected");
    res.status(429).json({ error: "Operation already running or recently started" });
    return;
  }

  let scan;
  try {
    [scan] = await db
      .insert(scansTable)
      .values({ status: "running", sourcesScanned: 0, projectsFound: 0, newProjects: 0, startDate: parsed.data.startDate ?? null, endDate: parsed.data.endDate ?? null })
      .returning();
  } catch (err) {
    admission.release();
    throw err;
  }

  // Load the scanner only when explicitly requested, then run it in the background.
  void import("../lib/scraper").then(({ runScan }) => runScan(
    scan.id,
    parsed.data.startDate ?? undefined,
    parsed.data.endDate ?? undefined,
  )).catch(
    (err: Error) => {
      req.log?.error({ err, scanId: scan.id }, "Scan background task failed");
    }
  ).finally(admission.release);

  res.status(202).json({
    ...scan,
    startedAt: scan.startedAt.toISOString(),
    completedAt: null,
  });
});

// GET /scans/:id
router.get("/scans/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetScanParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [scan] = await db
    .select()
    .from(scansTable)
    .where(eq(scansTable.id, params.data.id));

  if (!scan) {
    res.status(404).json({ error: "Scan not found" });
    return;
  }

  res.json({
    ...scan,
    startedAt: scan.startedAt.toISOString(),
    completedAt: scan.completedAt ? scan.completedAt.toISOString() : null,
  });
});

// GET /scans/:id/sources — durable acquisition health for all attempted sources
router.get("/scans/:id/sources", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = Number.parseInt(raw, 10);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid scan id" });
    return;
  }
  const [scan] = await db.select({ id: scansTable.id }).from(scansTable).where(eq(scansTable.id, id)).limit(1);
  if (!scan) {
    res.status(404).json({ error: "Scan not found" });
    return;
  }
  const rows = await db.select().from(scanSourceHealthTable)
    .where(eq(scanSourceHealthTable.scanId, id))
    .orderBy(asc(scanSourceHealthTable.sourceName));
  res.json(rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  })));
});

// GET /scans/:id/projects — all projects discovered by this scan
router.get("/scans/:id/projects", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid scan id" });
    return;
  }

  const [[scan], relations] = await Promise.all([
    db.select().from(scansTable).where(eq(scansTable.id, id)).limit(1),
    db
      .select()
      .from(scanProjectsTable)
      .where(eq(scanProjectsTable.scanId, id)),
  ]);
  if (!scan) {
    res.status(404).json({ error: "Scan not found" });
    return;
  }

  // 1. Try modern scan_projects table
  if (relations.length > 0) {
    const inWindowRelations = filterRelationsForScanWindow(relations, { startDate: scan.startDate, endDate: scan.endDate });
    const projectIds = inWindowRelations.map((r) => r.projectId);
    if (projectIds.length === 0) { res.json([]); return; }
    const projects = await db
      .select()
      .from(projectsTable)
      .where(inArray(projectsTable.id, projectIds));
    const relationMap = new Map(inWindowRelations.map((r) => [r.projectId, r]));

    res.json(
      filterEligibleScanProjects(projects).map((p) => {
        const relation = relationMap.get(p.id);
        return {
          ...p,
          capacityMw: p.capacityMw != null ? parseFloat(p.capacityMw) : null,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
          isNew: relation?.isNew ?? false,
          eventType: classifyScanProjectEvent({
            isNew: relation?.isNew ?? false,
            dateEvidence: relation?.dateEvidence,
            eventType: relation?.eventType,
          }),
          effectiveDate: relation?.effectiveDate ?? null,
          dateEvidence: relation?.dateEvidence ?? "unknown",
          eventSourceUrl: relation?.sourceUrl ?? p.sourceUrl,
          eventSourceName: relation?.sourceName ?? p.sourceName,
        };
      })
    );
    return;
  }

  // 2. Fallback: historical scans stored only the *new* projects via scan_id on projects table.
  // We cannot show "all found" for historical scans, but we can show the new ones at minimum.
  const historicalProjects = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.scanId, id));

  res.json(
    filterEligibleScanProjects(historicalProjects).map((p) => ({
      ...p,
      capacityMw: p.capacityMw != null ? parseFloat(p.capacityMw) : null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      isNew: true,
      eventType: "new",
      effectiveDate: p.announcedDate,
      dateEvidence: p.announcedDate ? "source_reported" : "unknown",
      eventSourceUrl: p.sourceUrl,
      eventSourceName: p.sourceName,
    }))
  );
});

export default router;
