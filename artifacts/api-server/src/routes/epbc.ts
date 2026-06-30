import { Router, type IRouter } from "express";
import { db, epbcProjectsTable, projectsTable } from "@workspace/db";
import { eq, ilike, or, and, isNull, not, sql } from "drizzle-orm";
import { fetchEpbcRecords } from "../lib/epbc-scraper";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── GET /epbc/projects ────────────────────────────────────────────────────────

router.get("/epbc/projects", async (req, res): Promise<void> => {
  const { search, state, technology, relevanceStatus, approvalStatus } = req.query as Record<string, string>;

  const conditions = [];

  if (search) {
    conditions.push(
      or(
        ilike(epbcProjectsTable.projectName, `%${search}%`),
        ilike(epbcProjectsTable.proponent, `%${search}%`),
        ilike(epbcProjectsTable.epbcNumber, `%${search}%`)
      )
    );
  }

  if (state) conditions.push(eq(epbcProjectsTable.state, state));
  if (technology) conditions.push(eq(epbcProjectsTable.technologyType, technology));
  if (relevanceStatus) conditions.push(eq(epbcProjectsTable.relevanceStatus, relevanceStatus));
  if (approvalStatus === "approved") conditions.push(eq(epbcProjectsTable.isApproved, true));
  if (approvalStatus === "not_approved") conditions.push(eq(epbcProjectsTable.isApproved, false));

  const rows = await db
    .select()
    .from(epbcProjectsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(epbcProjectsTable.referralDate);

  res.json(
    rows.map((r) => ({
      ...r,
      sizeMw: r.sizeMw != null ? parseFloat(r.sizeMw) : null,
      scrapedAt: r.scrapedAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))
  );
});

// ── GET /epbc/meta ────────────────────────────────────────────────────────────

router.get("/epbc/meta", async (_req, res): Promise<void> => {
  const [latest] = await db
    .select({ scrapedAt: epbcProjectsTable.scrapedAt })
    .from(epbcProjectsTable)
    .orderBy(sql`${epbcProjectsTable.scrapedAt} DESC`)
    .limit(1);

  const [counts] = await db
    .select({ total: sql<number>`count(*)` })
    .from(epbcProjectsTable);

  res.json({
    lastScrapedAt: latest?.scrapedAt?.toISOString() ?? null,
    total: Number(counts?.total ?? 0),
  });
});

// ── POST /epbc/sync ───────────────────────────────────────────────────────────

router.post("/epbc/sync", async (req, res): Promise<void> => {
  req.log.info("Starting EPBC sync");

  let records;
  try {
    records = await fetchEpbcRecords();
  } catch (err) {
    req.log.error({ err }, "EPBC sync failed");
    res.status(502).json({ error: "Failed to fetch EPBC data. The portal may be unavailable." });
    return;
  }

  let newCount = 0;
  let updatedCount = 0;

  for (const record of records) {
    try {
      const existing = await db
        .select({ id: epbcProjectsTable.id })
        .from(epbcProjectsTable)
        .where(eq(epbcProjectsTable.epbcNumber, record.epbcNumber))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(epbcProjectsTable).values({
          ...record,
          sizeMw: record.sizeMw != null ? String(record.sizeMw) : null,
        });
        newCount++;
      } else {
        await db
          .update(epbcProjectsTable)
          .set({
            projectStatus: record.projectStatus,
            decisionStatus: record.decisionStatus,
            isApproved: record.isApproved,
            rawDescription: record.rawDescription,
            updatedAt: new Date(),
          })
          .where(eq(epbcProjectsTable.epbcNumber, record.epbcNumber));
        updatedCount++;
      }
    } catch (err) {
      logger.warn({ err, epbcNumber: record.epbcNumber }, "Failed to upsert EPBC record");
    }
  }

  req.log.info({ newCount, updatedCount }, "EPBC sync complete");
  res.json({ newCount, updatedCount, total: records.length });
});

// ── PATCH /epbc/projects/:id ──────────────────────────────────────────────────

router.patch("/epbc/projects/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const allowed = ["relevanceStatus", "isSolar", "isApproved", "technologyType"];
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of allowed) {
    if (key in req.body) patch[key] = req.body[key];
  }

  const [updated] = await db
    .update(epbcProjectsTable)
    .set(patch)
    .where(eq(epbcProjectsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  res.json({
    ...updated,
    sizeMw: updated.sizeMw != null ? parseFloat(updated.sizeMw) : null,
    scrapedAt: updated.scrapedAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

// ── POST /epbc/projects/:id/import ────────────────────────────────────────────

router.post("/epbc/projects/:id/import", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [epbc] = await db.select().from(epbcProjectsTable).where(eq(epbcProjectsTable.id, id)).limit(1);
  if (!epbc) { res.status(404).json({ error: "EPBC record not found" }); return; }

  // Check not already imported (by source URL)
  if (epbc.sourceUrl) {
    const existing = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.sourceUrl, epbc.sourceUrl))
      .limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "Project already exists in main database", projectId: existing[0].id });
      return;
    }
  }

  const status = epbc.isApproved ? "under_development" : "announced";
  const capacityMw = epbc.sizeMw != null ? parseFloat(epbc.sizeMw) : 0;

  const [inserted] = await db
    .insert(projectsTable)
    .values({
      name: epbc.projectName,
      description: epbc.rawDescription,
      capacityMw: String(capacityMw),
      developer: epbc.proponent,
      location: epbc.location,
      country: "AU",
      status,
      sourceUrl: epbc.sourceUrl,
      sourceName: "EPBC Portal",
      announcedDate: epbc.referralDate ?? new Date().toISOString().slice(0, 10),
    })
    .returning({ id: projectsTable.id });

  res.json({ projectId: inserted.id, message: "Imported successfully" });
});

export default router;
