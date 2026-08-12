import { Router, type IRouter } from "express";
import { db, epbcProjectsTable, projectsTable } from "@workspace/db";
import { eq, ilike, or, and, inArray, sql } from "drizzle-orm";
import multer from "multer";
import {
  classifyApproval,
  classifyEpbc,
  extractMw,
  fetchEpbcRecords,
  type EpbcRecord,
} from "../lib/epbc-scraper";
import { logger } from "../lib/logger";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

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
  const [meta] = await db
    .select({
      lastScrapedAt: sql<Date | null>`max(${epbcProjectsTable.scrapedAt})`,
      total: sql<number>`count(*)::int`,
    })
    .from(epbcProjectsTable);

  res.json({
    lastScrapedAt: meta?.lastScrapedAt?.toISOString() ?? null,
    total: Number(meta?.total ?? 0),
  });
});

// ── POST /epbc/upload (xlsx file) ─────────────────────────────────────────────

/** Convert Excel serial date → YYYY-MM-DD string */
function excelDateToIso(serial: number): string {
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return date.toISOString().slice(0, 10);
}

function cellToString(val: unknown): string {
  if (val == null) return "";
  return String(val).trim();
}

function parseReferralDate(val: unknown): string | null {
  if (val == null || val === "") return null;
  if (typeof val === "number") return excelDateToIso(val);
  const s = String(val).trim();
  if (!s) return null;
  // try ISO-like formats
  const m = s.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/) ?? s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return new Date(s).toISOString().slice(0, 10);
  return s.slice(0, 10);
}

// Accepted column name aliases (xlsx files use varying headers)
const COL_ALIASES: Record<string, string[]> = {
  epbcNumber:    ["epbc number", "epbc no", "referral number", "epbc"],
  projectName:   ["project", "project name", "title"],
  proponent:     ["proposer", "proposer/approval holder", "proponent", "approval holder"],
  location:      ["location"],
  industryType:  ["industry type", "industry"],
  referralDate:  ["valid date", "referral date", "date referred", "referral started"],
  projectStatus: ["project status", "status"],
  state:         ["primary jurisdiction", "jurisdiction", "state"],
  decisionStatus:["decision status", "decision"],
};

function findCol(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const idx = headers.findIndex((h) => h.toLowerCase().trim() === alias.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

router.post("/epbc/upload", upload.single("file") as unknown as Parameters<typeof router.post>[1], async (req, res): Promise<void> => {
  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const xlsx = await import("xlsx");
  let wb: import("xlsx").WorkBook;
  try {
    wb = xlsx.read(file.buffer, { type: "buffer", cellDates: false });
  } catch {
    res.status(400).json({ error: "Could not parse xlsx file" });
    return;
  }

  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json<string[]>(ws, { header: 1, raw: true }) as unknown[][];

  if (rows.length < 2) { res.status(400).json({ error: "Xlsx has no data rows" }); return; }

  // Map headers
  const headers = (rows[0] as unknown[]).map((h) => cellToString(h));
  const colMap: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(COL_ALIASES)) {
    colMap[field] = findCol(headers, aliases);
  }

  let newCount = 0;
  let updatedCount = 0;
  let skipped = 0;

  for (const row of rows.slice(1)) {
    const cells = row as unknown[];
    const epbcNumber = cellToString(cells[colMap.epbcNumber]);
    if (!epbcNumber || !/\d/.test(epbcNumber)) { skipped++; continue; }

    const projectName = cellToString(cells[colMap.projectName]) || epbcNumber;
    const proponent   = colMap.proponent   >= 0 ? cellToString(cells[colMap.proponent])   || null : null;
    const location    = colMap.location    >= 0 ? cellToString(cells[colMap.location])    || null : null;
    const industryType= colMap.industryType>= 0 ? cellToString(cells[colMap.industryType])|| null : null;
    const projectStatus= colMap.projectStatus>=0? cellToString(cells[colMap.projectStatus])|| null: null;
    const state       = colMap.state       >= 0 ? cellToString(cells[colMap.state])       || null : null;
    const decisionStatus= colMap.decisionStatus>=0? cellToString(cells[colMap.decisionStatus])||null:null;
    const referralDate= colMap.referralDate >= 0 ? parseReferralDate(cells[colMap.referralDate]) : null;

    const { technologyType, isRenewable, isSolar, relevanceStatus } = classifyEpbc(projectName, null);
    const isApproved = classifyApproval(projectStatus, decisionStatus);
    const sizeMw = extractMw(projectName);

    const referralNum = epbcNumber.replace(/\//g, "-");
    const sourceUrl = `https://epbcpublicportal.environment.gov.au/public-register/referral-detail/${referralNum}`;

    try {
      const existing = await db
        .select({ id: epbcProjectsTable.id })
        .from(epbcProjectsTable)
        .where(eq(epbcProjectsTable.epbcNumber, epbcNumber))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(epbcProjectsTable).values({
          epbcNumber, projectName, proponent, industryType, projectStatus, decisionStatus,
          state, location, technologyType,
          sizeMw: sizeMw != null ? String(sizeMw) : null,
          referralDate, sourceUrl,
          isRenewable, isSolar, isApproved, relevanceStatus,
        });
        newCount++;
      } else {
        await db.update(epbcProjectsTable)
          .set({ projectStatus, decisionStatus, isApproved, updatedAt: new Date() })
          .where(eq(epbcProjectsTable.epbcNumber, epbcNumber));
        updatedCount++;
      }
    } catch (err) {
      logger.warn({ err, epbcNumber }, "Failed to upsert EPBC xlsx row");
      skipped++;
    }
  }

  req.log.info({ newCount, updatedCount, skipped }, "EPBC xlsx upload complete");
  res.json({ newCount, updatedCount, skipped, total: rows.length - 1 });
});

// ── POST /epbc/sync ───────────────────────────────────────────────────────────

const EPBC_UPSERT_BATCH_SIZE = 200;

function toEpbcInsert(record: EpbcRecord) {
  return {
    ...record,
    sizeMw: record.sizeMw != null ? String(record.sizeMw) : null,
  };
}

async function upsertEpbcSyncRecords(records: EpbcRecord[]): Promise<{
  newCount: number;
  updatedCount: number;
}> {
  const uniqueRecords = [...new Map(records.map((record) => [record.epbcNumber, record])).values()];
  const existingRows = uniqueRecords.length > 0
    ? await db
      .select({ epbcNumber: epbcProjectsTable.epbcNumber })
      .from(epbcProjectsTable)
      .where(inArray(epbcProjectsTable.epbcNumber, uniqueRecords.map((record) => record.epbcNumber)))
    : [];
  const existingNumbers = new Set(existingRows.map((row) => row.epbcNumber));

  let newCount = 0;
  let updatedCount = 0;

  async function writeBatch(batch: EpbcRecord[]): Promise<void> {
    const updatedAt = new Date();
    await db
      .insert(epbcProjectsTable)
      .values(batch.map(toEpbcInsert))
      .onConflictDoUpdate({
        target: epbcProjectsTable.epbcNumber,
        set: {
          projectStatus: sql`excluded.project_status`,
          decisionStatus: sql`excluded.decision_status`,
          isApproved: sql`excluded.is_approved`,
          rawDescription: sql`excluded.raw_description`,
          updatedAt,
        },
      });
  }

  for (let offset = 0; offset < uniqueRecords.length; offset += EPBC_UPSERT_BATCH_SIZE) {
    const batch = uniqueRecords.slice(offset, offset + EPBC_UPSERT_BATCH_SIZE);
    try {
      await writeBatch(batch);
      for (const record of batch) {
        if (existingNumbers.has(record.epbcNumber)) updatedCount++;
        else newCount++;
      }
    } catch (batchError) {
      logger.warn(
        { err: batchError, offset, batchSize: batch.length },
        "EPBC batch upsert failed; retrying records individually",
      );
      for (const record of batch) {
        try {
          await writeBatch([record]);
          if (existingNumbers.has(record.epbcNumber)) updatedCount++;
          else newCount++;
        } catch (err) {
          logger.warn({ err, epbcNumber: record.epbcNumber }, "Failed to upsert EPBC record");
        }
      }
    }
  }

  return { newCount, updatedCount };
}

router.post("/epbc/sync", async (req, res): Promise<void> => {
  const body = req.body as { startDate?: string; endDate?: string } | undefined;
  const startDate = body?.startDate || undefined;
  const endDate   = body?.endDate   || undefined;

  req.log.info({ startDate, endDate }, "Starting EPBC sync");

  let records;
  try {
    records = await fetchEpbcRecords(startDate, endDate);
  } catch (err) {
    req.log.error({ err }, "EPBC sync failed");
    res.status(502).json({ error: "Failed to fetch EPBC data. The portal may be unavailable." });
    return;
  }

  const persistenceStartedAt = performance.now();
  const { newCount, updatedCount } = await upsertEpbcSyncRecords(records);

  req.log.info(
    {
      newCount,
      updatedCount,
      persistenceDurationMs: Math.round(performance.now() - persistenceStartedAt),
    },
    "EPBC sync complete",
  );
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
