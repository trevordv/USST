import { Router, type IRouter } from "express";
import { and, desc, eq, gte, ilike, lte, or, type SQL } from "drizzle-orm";
import { db, industryNewsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/industry-news", async (req, res): Promise<void> => {
  const conditions: SQL[] = [];
  const startDate = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
  const endDate = typeof req.query.endDate === "string" ? req.query.endDate : undefined;
  const country = typeof req.query.country === "string" ? req.query.country.toUpperCase() : undefined;
  const contentType = typeof req.query.contentType === "string" ? req.query.contentType.toLowerCase() : undefined;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
  const scanIdRaw = typeof req.query.scanId === "string" ? Number(req.query.scanId) : undefined;

  if (startDate) conditions.push(gte(industryNewsTable.publishedDate, startDate));
  if (endDate) conditions.push(lte(industryNewsTable.publishedDate, endDate));
  if (country === "AU" || country === "NZ") conditions.push(eq(industryNewsTable.country, country));
  if (["news", "linkedin", "journalist", "industry"].includes(contentType ?? "")) {
    conditions.push(eq(industryNewsTable.contentType, contentType!));
  }
  if (Number.isInteger(scanIdRaw)) conditions.push(eq(industryNewsTable.scanId, scanIdRaw!));
  if (search) {
    conditions.push(or(
      ilike(industryNewsTable.title, `%${search}%`),
      ilike(industryNewsTable.summary, `%${search}%`),
      ilike(industryNewsTable.sourceName, `%${search}%`),
      ilike(industryNewsTable.author, `%${search}%`),
    )!);
  }

  const rows = await db
    .select()
    .from(industryNewsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(industryNewsTable.publishedDate), desc(industryNewsTable.id))
    .limit(500);

  res.json(rows.map((row) => ({
    ...row,
    discoveredAt: row.discoveredAt.toISOString(),
  })));
});

export default router;
