import { Router, type IRouter } from "express";
import { and, gte, lte, ilike, eq, or, sql, not, isNull, isNotNull, inArray } from "drizzle-orm";
import { db, projectsTable, contactEnrichmentsTable } from "@workspace/db";
import {
  ListProjectsQueryParams,
  CreateProjectBody,
  GetProjectParams,
  UpdateProjectParams,
  UpdateProjectBody,
  DeleteProjectParams,
  GetProjectStatsQueryParams,
  ExportProjectsQueryParams,
  GetContactEnrichmentParams,
} from "@workspace/api-zod";
import { enrichMissingContacts, startEnrichment } from "../lib/scraper";

const router: IRouter = Router();

function toProjectResponse(p: typeof projectsTable.$inferSelect) {
  return {
    ...p,
    capacityMw: p.capacityMw != null ? parseFloat(p.capacityMw) : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function buildWhereConditions(
  startDate?: string | null,
  endDate?: string | null,
  country?: string | null,
  search?: string | null,
  scanId?: number | null,
  hasContact?: boolean | null,
) {
  const conditions = [];

  // ── Permanent quality filters ──────────────────────────────
  // No wind projects
  conditions.push(not(ilike(projectsTable.name, "%wind%")));
  // Only AU and NZ
  conditions.push(inArray(projectsTable.country, ["AU", "NZ"]));
  // Must have capacity (no null capacity projects) and utility scale: >=5 MW
  conditions.push(isNotNull(projectsTable.capacityMw));
  conditions.push(gte(projectsTable.capacityMw, "5"));

  // ── User-supplied filters ──────────────────────────────────
  if (startDate && endDate) {
    conditions.push(gte(projectsTable.announcedDate, startDate));
    conditions.push(lte(projectsTable.announcedDate, endDate));
  } else if (startDate) {
    conditions.push(gte(projectsTable.announcedDate, startDate));
  } else if (endDate) {
    conditions.push(lte(projectsTable.announcedDate, endDate));
  }

  if (country && country !== "ALL") {
    conditions.push(eq(projectsTable.country, country));
  }
  if (search) {
    conditions.push(
      or(
        ilike(projectsTable.name, `%${search}%`),
        ilike(projectsTable.developer, `%${search}%`),
        ilike(projectsTable.location, `%${search}%`),
        ilike(projectsTable.epc, `%${search}%`),
      )!
    );
  }
  if (scanId != null) {
    conditions.push(eq(projectsTable.scanId, scanId));
  }
  if (hasContact === true) {
    conditions.push(isNotNull(projectsTable.contactEmail));
  }

  return conditions;
}

// GET /projects
router.get("/projects", async (req, res): Promise<void> => {
  const parsed = ListProjectsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { startDate, endDate, country, search, scanId, hasContact } = parsed.data;
  const conditions = buildWhereConditions(startDate, endDate, country, search, scanId, hasContact);

  const projects = await db
    .select()
    .from(projectsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`${projectsTable.announcedDate} DESC`);

  res.json(projects.map(toProjectResponse));
});

// POST /projects
router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const insertData = {
    ...parsed.data,
    capacityMw: String(parsed.data.capacityMw),
  };
  const [project] = await db.insert(projectsTable).values(insertData).returning();
  res.status(201).json(toProjectResponse(project));
});

// GET /projects/stats — must be before /projects/:id
router.get("/projects/stats", async (req, res): Promise<void> => {
  const parsed = GetProjectStatsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { startDate, endDate } = parsed.data;
  const conditions = buildWhereConditions(startDate, endDate, null, null);

  const projects = await db
    .select()
    .from(projectsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const total = projects.length;
  const byCountry: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let totalCapacityMw = 0;
  let recentCount = 0;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

  for (const p of projects) {
    byCountry[p.country] = (byCountry[p.country] ?? 0) + 1;
    byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
    if (p.capacityMw != null) totalCapacityMw += parseFloat(p.capacityMw);
    if (p.announcedDate >= sevenDaysAgoStr) recentCount++;
  }

  res.json({ total, byCountry, byStatus, totalCapacityMw, recentCount });
});

// GET /projects/export — must be before /projects/:id
router.get("/projects/export", async (req, res): Promise<void> => {
  const parsed = ExportProjectsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { startDate, endDate, country } = parsed.data;
  const conditions = buildWhereConditions(startDate, endDate, country, null);

  const projects = await db
    .select()
    .from(projectsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`${projectsTable.announcedDate} DESC`);

  const headers = [
    "ID", "Project Name", "Capacity (MW)", "Developer", "EPC", "Location",
    "Country", "Status", "Announced Date", "Source", "Source URL",
    "Contact Name", "Contact Email", "Contact Phone", "Description"
  ];

  function escapeCsv(val: string | number | null | undefined): string {
    if (val == null) return "";
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  const rows = projects.map(p => [
    p.id,
    p.name,
    p.capacityMw ?? "",
    p.developer ?? "",
    p.epc ?? "",
    p.location ?? "",
    p.country,
    p.status,
    p.announcedDate,
    p.sourceName ?? "",
    p.sourceUrl ?? "",
    p.contactName ?? "",
    p.contactEmail ?? "",
    p.contactPhone ?? "",
    p.description ?? "",
  ].map(escapeCsv).join(","));

  const csv = [headers.join(","), ...rows].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="solar-projects-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

// GET /projects/:id
router.get("/projects/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetProjectParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json(toProjectResponse(project));
});

// PATCH /projects/:id
router.patch("/projects/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateProjectParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData = {
    ...parsed.data,
    capacityMw: parsed.data.capacityMw != null ? String(parsed.data.capacityMw) : undefined,
  };
  const [project] = await db
    .update(projectsTable)
    .set(updateData)
    .where(eq(projectsTable.id, params.data.id))
    .returning();

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json(toProjectResponse(project));
});

// POST /projects/enrich-contacts
router.post("/projects/enrich-contacts", async (req, res): Promise<void> => {
  try {
    const runId = await startEnrichment();
    res.status(202).json({ runId, status: "running" });
  } catch (err) {
    req.log.error({ err }, "Contact enrichment failed to start");
    res.status(500).json({ error: "Contact enrichment failed to start" });
  }
});

// GET /contact-enrichments/:id
router.get("/contact-enrichments/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetContactEnrichmentParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [run] = await db
    .select()
    .from(contactEnrichmentsTable)
    .where(eq(contactEnrichmentsTable.id, params.data.id));

  if (!run) {
    res.status(404).json({ error: "Enrichment run not found" });
    return;
  }

  res.json({
    ...run,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
  });
});

// DELETE /projects/:id
router.delete("/projects/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteProjectParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .delete(projectsTable)
    .where(eq(projectsTable.id, params.data.id))
    .returning();

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
