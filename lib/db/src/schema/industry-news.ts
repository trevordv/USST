import { pgTable, text, serial, timestamp, integer, date } from "drizzle-orm/pg-core";

export const industryNewsTable = pgTable("industry_news", {
  id: serial("id").primaryKey(),
  scanId: integer("scan_id").notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url").notNull(),
  author: text("author"),
  country: text("country").notNull(),
  contentType: text("content_type").notNull().default("news"),
  publishedDate: date("published_date", { mode: "string" }).notNull(),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IndustryNewsItem = typeof industryNewsTable.$inferSelect;
