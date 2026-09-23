import { boolean, check, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { scansTable } from "./scans";

export const scanSourceHealthTable = pgTable("scan_source_health", {
  id: serial("id").primaryKey(),
  scanId: integer("scan_id").notNull().references(() => scansTable.id, { onDelete: "cascade" }),
  sourceName: text("source_name").notNull(),
  acquisitionMethod: text("acquisition_method").notNull(),
  directAttempted: boolean("direct_attempted").notNull().default(false),
  firecrawlAttempted: boolean("firecrawl_attempted").notNull().default(false),
  firecrawlSucceeded: boolean("firecrawl_succeeded").notNull().default(false),
  apifyAttempted: boolean("apify_attempted").notNull().default(false),
  brightDataAttempted: boolean("bright_data_attempted").notNull().default(false),
  openaiNormalisationAttempted: boolean("openai_normalisation_attempted").notNull().default(false),
  openaiNormalisationSucceeded: boolean("openai_normalisation_succeeded").notNull().default(false),
  fallbackUsed: boolean("fallback_used").notNull().default(false),
  outcome: text("outcome").notNull(),
  candidateCount: integer("candidate_count").notNull().default(0),
  qualifyingProjectCount: integer("qualifying_project_count").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  failureCategory: text("failure_category"),
  failureReason: text("failure_reason"),
  contentFingerprint: text("content_fingerprint"),
  firecrawlCalls: integer("firecrawl_calls").notNull().default(0),
  firecrawlPages: integer("firecrawl_pages").notNull().default(0),
  firecrawlCacheReused: boolean("firecrawl_cache_reused").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("scan_source_health_scan_source_unique").on(table.scanId, table.sourceName),
  index("scan_source_health_scan_id_idx").on(table.scanId),
  index("scan_source_health_source_created_idx").on(table.sourceName, table.createdAt),
  index("scan_source_health_outcome_created_idx").on(table.outcome, table.createdAt),
  check("scan_source_health_outcome_check", sql`${table.outcome} in ('success-with-results','success-zero-results','blocked','timeout','extraction-failed','missing-credentials','rate-limited','provider-error')`),
  check("scan_source_health_nonnegative_check", sql`${table.candidateCount} >= 0 AND ${table.qualifyingProjectCount} >= 0 AND ${table.durationMs} >= 0 AND ${table.firecrawlCalls} >= 0 AND ${table.firecrawlPages} >= 0`),
  check("scan_source_health_fingerprint_check", sql`${table.contentFingerprint} IS NULL OR ${table.contentFingerprint} ~ '^[a-f0-9]{64}$'`),
]);

export type ScanSourceHealth = typeof scanSourceHealthTable.$inferSelect;
export type InsertScanSourceHealth = typeof scanSourceHealthTable.$inferInsert;
