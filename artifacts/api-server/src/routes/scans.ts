import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, scansTable, projectsTable, scanProjectsTable } from "@workspace/db";
import { TriggerScanBody, GetScanParams } from "@workspace/api-zod";
import { runScan } from "../lib/scraper";
import { filterEligibleScanProjects } from "../lib/project-eligibility";

const router: IRouter = Router();

// GET /scans
router.get("/scans", async (_req, res): Promise<void> => {
  const scans = await db
    .select()
    .from(scansTable)
    .orderBy(scansTable.startedAt);

  res.json(
    scans.reverse().map((s) => ({
      ...s,
      startedAt: s.startedAt.toISOString(),
      completedAt: s.completedAt ? s.completedAt.toISOString() : null,
    }))
  );
});

// POST /scans
router.post("/scans", async (req, res): Promise<void> => {
  const parsed = TriggerScanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [scan] = await db
    .insert(scansTable)
    .values({ status: "running", sourcesScanned: 0, projectsFound: 0, newProjects: 0 })
    .returning();

  // Run scan in background — don't await
  runScan(scan.id, parsed.data.startDate ?? undefined, parsed.data.endDate ?? undefined).catch(
    (err: Error) => {
      req.log?.error({ err, scanId: scan.id }, "Scan background task failed");
    }
  );

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

// GET /scans/:id/projects — all projects discovered by this scan
router.get("/scans/:id/projects", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid scan id" });
    return;
  }

  const [scan] = await db.select().from(scansTable).where(eq(scansTable.id, id));
  if (!scan) {
    res.status(404).json({ error: "Scan not found" });
    return;
  }

  // 1. Try modern scan_projects table
  const relations = await db
    .select()
    .from(scanProjectsTable)
    .where(eq(scanProjectsTable.scanId, id));

  if (relations.length > 0) {
    const projectIds = relations.map((r) => r.projectId);
    const projects = await db
      .select()
      .from(projectsTable)
      .where(inArray(projectsTable.id, projectIds));
    const isNewMap = new Map(relations.map((r) => [r.projectId, r.isNew]));

    res.json(
      filterEligibleScanProjects(projects).map((p) => ({
        ...p,
        capacityMw: p.capacityMw != null ? parseFloat(p.capacityMw) : null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        isNew: isNewMap.get(p.id) ?? false,
      }))
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
    }))
  );
});

export default router;
