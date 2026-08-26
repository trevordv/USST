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
import { MINIMUM_SOLAR_CAPACITY_MW } from "../lib/project-eligibility";
import { requireAdmin } from "../middlewares/supabase-auth";
import { admitCostlyOperation } from "../lib/job-admission";

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
  // Utility-scale gate: ≥5 MW.
  // Projects imported from government databases (e.g. EPBC) may have unknown
  // capacity stored as 0 — allow those through alongside normal ≥5 MW projects.
  conditions.push(
    or(
      eq(projectsTable.capacityMw, "0"),
      gte(projectsTable.capacityMw, String(MINIMUM_SOLAR_CAPACITY_MW)),
    )!,
  );

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
    // New scan results do not use the historical government-import capacity=0 exception.
    conditions.push(gte(projectsTable.capacityMw, String(MINIMUM_SOLAR_CAPACITY_MW)));
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
router.post("/projects", requireAdmin, async (req, res): Promise<void> => {
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

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [[summary], countryRows, statusRows] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        totalCapacityMw: sql<string>`coalesce(sum(${projectsTable.capacityMw}), 0)`,
        recentCount: sql<number>`count(*) filter (where ${projectsTable.announcedDate} >= ${sevenDaysAgoStr})::int`,
      })
      .from(projectsTable)
      .where(where),
    db
      .select({
        country: projectsTable.country,
        count: sql<number>`count(*)::int`,
      })
      .from(projectsTable)
      .where(where)
      .groupBy(projectsTable.country),
    db
      .select({
        status: projectsTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(projectsTable)
      .where(where)
      .groupBy(projectsTable.status),
  ]);

  const byCountry = Object.fromEntries(countryRows.map((row) => [row.country, Number(row.count)]));
  const byStatus = Object.fromEntries(statusRows.map((row) => [row.status, Number(row.count)]));
  res.json({
    total: Number(summary?.total ?? 0),
    byCountry,
    byStatus,
    totalCapacityMw: Number(summary?.totalCapacityMw ?? 0),
    recentCount: Number(summary?.recentCount ?? 0),
  });
});

// GET /projects/export — must be before /projects/:id
router.get("/projects/export", async (req, res): Promise<void> => {
  const parsed = ExportProjectsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { startDate, endDate, country, search, scanId, hasContact } = parsed.data;
  const conditions = buildWhereConditions(startDate, endDate, country, search ?? null, scanId ?? null, hasContact ?? null);

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

// POST /projects/:id/research — bounded supporting evidence for an existing project
router.post("/projects/:id/research", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetProjectParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      developer: projectsTable.developer,
      location: projectsTable.location,
      country: projectsTable.country,
      capacityMw: projectsTable.capacityMw,
    })
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const admission = admitCostlyOperation("project-research", res.locals.usstUser.id);
  if (!admission) {
    req.log.warn({ operation: "project-research", projectId: project.id }, "Costly operation rejected");
    res.status(429).json({ error: "Project research already running or recently started" });
    return;
  }

  try {
    const { researchProjectWithBrave } = await import("../lib/brave-research");
    const evidence = await researchProjectWithBrave({
      projectName: project.name,
      developer: project.developer,
      location: project.location,
      country: project.country,
      capacityMw: project.capacityMw,
    });
    req.log.info({ projectId: project.id, resultCount: evidence.length }, "Project research completed");
    res.json({ projectId: project.id, purpose: "project_corroboration", evidence });
  } catch (err) {
    req.log.error({ err, projectId: project.id }, "Project research failed");
    res.status(502).json({ error: "Project research unavailable" });
  } finally {
    admission.release();
  }
});

// PATCH /projects/:id
router.patch("/projects/:id", requireAdmin, async (req, res): Promise<void> => {
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
router.post("/projects/enrich-contacts", requireAdmin, async (req, res): Promise<void> => {
  const admission = admitCostlyOperation("enrichment", res.locals.usstUser.id);
  if (!admission) { req.log.warn({ operation: "enrichment" }, "Costly operation rejected"); res.status(429).json({ error: "Operation already running or recently started" }); return; }
  try {
    const { startEnrichment } = await import("../lib/scraper");
    const { runId, completion } = await startEnrichment();
    void completion.finally(admission.release);
    res.status(202).json({ runId, status: "running" });
  } catch (err) {
    admission.release();
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
router.delete("/projects/:id", requireAdmin, async (req, res): Promise<void> => {
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
