import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { appUsersTable } from "./app-users";

export const agentMemoryTable = pgTable("agent_memory", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  memoryType: text("memory_type").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id"),
  key: text("memory_key").notNull(),
  valueJson: jsonb("value_json").$type<Record<string, unknown>>().notNull().default({}),
  summary: text("summary").notNull(),
  confidence: text("confidence").notNull().default("low"),
  source: text("source").notNull(),
  sourceReference: text("source_reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  timesObserved: integer("times_observed").notNull().default(1),
  status: text("status").notNull().default("active"),
  supersededBy: bigint("superseded_by", { mode: "number" }),
  createdBy: integer("created_by").references(() => appUsersTable.id, { onDelete: "set null" }),
  fingerprint: text("fingerprint").notNull().unique(),
}, (table) => [
  index("agent_memory_scope_idx").on(table.subjectType, table.subjectId, table.memoryType, table.status),
  index("agent_memory_last_seen_idx").on(table.lastSeenAt),
]);

export const agentKnowledgeTable = pgTable("agent_knowledge", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  knowledgeType: text("knowledge_type").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id"),
  canonicalKey: text("canonical_key").notNull(),
  valueJson: jsonb("value_json").$type<Record<string, unknown>>().notNull().default({}),
  summary: text("summary").notNull(),
  confidence: text("confidence").notNull().default("medium"),
  approvalStatus: text("approval_status").notNull().default("candidate"),
  approvedBy: integer("approved_by").references(() => appUsersTable.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedBy: integer("rejected_by").references(() => appUsersTable.id, { onDelete: "set null" }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  evidenceCount: integer("evidence_count").notNull().default(0),
  sourceMemoryIds: bigint("source_memory_ids", { mode: "number" }).array().notNull().default([]),
  lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  supersededBy: bigint("superseded_by", { mode: "number" }),
}, (table) => [
  index("agent_knowledge_scope_idx").on(table.subjectType, table.subjectId, table.knowledgeType, table.approvalStatus),
]);

export const agentFeedbackTable = pgTable("agent_feedback", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actionType: text("action_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  originalValue: jsonb("original_value").$type<Record<string, unknown> | null>(),
  correctedValue: jsonb("corrected_value").$type<Record<string, unknown> | null>(),
  feedbackType: text("feedback_type").notNull(),
  reason: text("reason"),
  userId: integer("user_id").notNull().references(() => appUsersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (table) => [index("agent_feedback_entity_idx").on(table.entityType, table.entityId, table.createdAt)]);

export const agentLearningEventsTable = pgTable("agent_learning_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actionType: text("action_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  contextJson: jsonb("context_json").$type<Record<string, unknown>>().notNull().default({}),
  outcome: text("outcome").notNull(),
  durationMs: integer("duration_ms"),
  sourceName: text("source_name"),
  projectCount: integer("project_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (table) => [index("agent_learning_events_source_idx").on(table.sourceName, table.actionType, table.createdAt)]);

export const agentKnowledgeConflictsTable = pgTable("agent_knowledge_conflicts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  knowledgeType: text("knowledge_type").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id"),
  canonicalKey: text("canonical_key").notNull(),
  knowledgeIds: bigint("knowledge_ids", { mode: "number" }).array().notNull().default([]),
  memoryIds: bigint("memory_ids", { mode: "number" }).array().notNull().default([]),
  summary: text("summary").notNull(),
  status: text("status").notNull().default("open"),
  resolvedBy: integer("resolved_by").references(() => appUsersTable.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolution: text("resolution"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AgentMemory = typeof agentMemoryTable.$inferSelect;
export type AgentKnowledge = typeof agentKnowledgeTable.$inferSelect;
export type AgentFeedback = typeof agentFeedbackTable.$inferSelect;
export type AgentLearningEvent = typeof agentLearningEventsTable.$inferSelect;
export type AgentKnowledgeConflict = typeof agentKnowledgeConflictsTable.$inferSelect;
