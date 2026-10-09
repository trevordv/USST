import { pgTable, serial, text, integer, date, jsonb, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const aiSourceFallbackCacheTable = pgTable("ai_source_fallback_cache", {
  id: serial("id").primaryKey(),
  cacheKey: text("cache_key").notNull().unique(),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url").notNull(),
  contentHash: text("content_hash").notNull(),
  startDate: date("start_date"),
  endDate: date("end_date"),
  model: text("model").notNull(),
  promptHash: text("prompt_hash").notNull(),
  cacheVersion: integer("cache_version").notNull(),
  resultJson: jsonb("result_json").notNull(),
  resultCount: integer("result_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`now() + interval '6 hours'`),
}, table => [
  index("ai_source_fallback_cache_expiry_idx").on(table.expiresAt),
  check("ai_source_cache_array_check", sql`jsonb_typeof(${table.resultJson}) = 'array'`),
  check("ai_source_cache_count_check", sql`${table.resultCount} >= 0 AND ${table.resultCount} = jsonb_array_length(${table.resultJson})`),
  check("ai_source_cache_window_check", sql`${table.startDate} IS NULL OR ${table.endDate} IS NULL OR ${table.startDate} <= ${table.endDate}`),
]);
