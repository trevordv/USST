import { date, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Additive event ledger for source articles. It never replaces project or scan
 * lineage: it prevents the same canonical asset/article/date from becoming a
 * new update every time a feed is reread.
 */
export const projectSourceEventsTable = pgTable("project_source_events", {
  id: serial("id").primaryKey(),
  canonicalProjectId: integer("canonical_project_id").notNull(),
  sourceUrl: text("source_url").notNull(),
  eventDate: date("event_date", { mode: "string" }).notNull(),
  sourceName: text("source_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("project_source_events_identity_idx").on(table.canonicalProjectId, table.sourceUrl, table.eventDate),
]);

/** Reversible, additive mapping for legacy duplicate records; no row is deleted. */
export const projectReconciliationsTable = pgTable("project_reconciliations", {
  id: serial("id").primaryKey(),
  legacyProjectId: integer("legacy_project_id").notNull(),
  canonicalProjectId: integer("canonical_project_id").notNull(),
  reason: text("reason").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("project_reconciliations_legacy_idx").on(table.legacyProjectId),
]);
