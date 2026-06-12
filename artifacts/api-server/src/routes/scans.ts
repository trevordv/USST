import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, scansTable, projectsTable } from "@workspace/db";
import { TriggerScanBody, GetScanParams } from "@workspace/api-zod";
import { runScan } from "../lib/scraper";

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

export default router;
