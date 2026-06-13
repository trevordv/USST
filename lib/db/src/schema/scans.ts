import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const scansTable = pgTable("scans", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("running"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  sourcesScanned: integer("sources_scanned").notNull().default(0),
  projectsFound: integer("projects_found").notNull().default(0),
  newProjects: integer("new_projects").notNull().default(0),
  errorMessage: text("error_message"),
});

export const insertScanSchema = createInsertSchema(scansTable).omit({
  id: true,
  startedAt: true,
});
export type InsertScan = z.infer<typeof insertScanSchema>;
export type Scan = typeof scansTable.$inferSelect;

// ── Scan results: every project found by a scan (new or existing) ──
export const scanProjectsTable = pgTable("scan_projects", {
  id: serial("id").primaryKey(),
  scanId: integer("scan_id").notNull(),
  projectId: integer("project_id").notNull(),
  // projectName at the time of scan for traceability
  projectName: text("project_name"),
  isNew: boolean("is_new").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
