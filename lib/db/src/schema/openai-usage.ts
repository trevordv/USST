import { boolean, check, index, integer, jsonb, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const openAiUsageLedgerTable = pgTable("openai_usage_ledger", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  operation: text("operation").notNull(), sourceName: text("source_name"),
  sourceUrl: text("source_url"), sourceIdentifier: text("source_identifier"),
  projectId: integer("project_id"), model: text("model").notNull(),
  inputTokens: integer("input_tokens"), cachedInputTokens: integer("cached_input_tokens"),
  outputTokens: integer("output_tokens"), reasoningTokens: integer("reasoning_tokens"),
  webSearchCalls: integer("web_search_calls"), responseId: text("response_id"),
  resultCount: integer("result_count"), cacheHit: boolean("cache_hit").notNull().default(false),
  success: boolean("success").notNull(),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 18, scale: 10 }),
  latencyMs: integer("latency_ms").notNull(), metadata: jsonb("metadata").notNull().default({}),
}, table => [
  index("openai_usage_ledger_created_at_idx").on(table.createdAt),
  index("openai_usage_ledger_operation_created_idx").on(table.operation, table.createdAt),
  index("openai_usage_ledger_model_created_idx").on(table.model, table.createdAt),
  index("openai_usage_ledger_source_created_idx").on(table.sourceName, table.createdAt),
  check("openai_usage_ledger_nonnegative_check", sql`coalesce(${table.inputTokens},0) >= 0 AND coalesce(${table.cachedInputTokens},0) >= 0 AND coalesce(${table.outputTokens},0) >= 0 AND coalesce(${table.reasoningTokens},0) >= 0 AND coalesce(${table.webSearchCalls},0) >= 0 AND coalesce(${table.resultCount},0) >= 0 AND ${table.latencyMs} >= 0`),
  check("openai_usage_ledger_metadata_object_check", sql`jsonb_typeof(${table.metadata}) = 'object'`),
]);
