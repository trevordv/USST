import { pgTable, text, serial, timestamp, integer, boolean, date, uniqueIndex, index } from "drizzle-orm/pg-core";
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
  startDate: date("start_date", { mode: "string" }),
  endDate: date("end_date", { mode: "string" }),
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
  eventType: text("event_type").notNull().default("inventory_observed"),
  effectiveDate: date("effective_date", { mode: "string" }),
  dateEvidence: text("date_evidence").notNull().default("unknown"),
  sourceUrl: text("source_url"),
  sourceName: text("source_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Contact enrichment runs ──────────────────────────────────────────
export const contactEnrichmentsTable = pgTable("contact_enrichments", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("running"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  checked: integer("checked").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  verifiedContacts: integer("verified_contacts").notNull().default(0),
  tentativeLeads: integer("tentative_leads").notNull().default(0),
  rejectedMatches: integer("rejected_matches").notNull().default(0),
  projectsUpdated: integer("projects_updated").notNull().default(0),
  providerRequests: integer("provider_requests").notNull().default(0),
  creditsEstimated: integer("credits_estimated").notNull().default(0),
  creditsConsumed: integer("credits_consumed").notNull().default(0),
  approvedCreditBudget: integer("approved_credit_budget").notNull().default(0),
  paidProspectingApproved: boolean("paid_prospecting_approved").notNull().default(false),
  dryRun: boolean("dry_run").notNull().default(false),
  errorMessage: text("error_message"),
});

export const contactEnrichmentAttemptsTable = pgTable("contact_enrichment_attempts", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  developerKey: text("developer_key").notNull(),
  status: text("status").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  nextEligibleAt: timestamp("next_eligible_at", { withTimezone: true }),
  lastRunId: integer("last_run_id"),
  failureCategory: text("failure_category"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("contact_enrichment_attempt_provider_developer_uidx").on(table.provider, table.developerKey),
  index("contact_enrichment_attempt_provider_next_idx").on(table.provider, table.nextEligibleAt),
]);

export const contactEnrichmentProvenanceTable = pgTable("contact_enrichment_provenance", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull(),
  projectId: integer("project_id").notNull(),
  developerKey: text("developer_key").notNull(),
  provider: text("provider").notNull(),
  verificationStatus: text("verification_status").notNull(),
  validationReason: text("validation_reason"),
  sourceUrl: text("source_url"),
  contactFingerprint: text("contact_fingerprint"),
  creditsConsumed: integer("credits_consumed").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("contact_enrichment_provenance_run_idx").on(table.runId)]);

export const insertContactEnrichmentSchema = createInsertSchema(contactEnrichmentsTable).omit({
  id: true,
  startedAt: true,
});
export type InsertContactEnrichment = z.infer<typeof insertContactEnrichmentSchema>;
export type ContactEnrichment = typeof contactEnrichmentsTable.$inferSelect;
