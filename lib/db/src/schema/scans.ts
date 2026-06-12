import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
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
