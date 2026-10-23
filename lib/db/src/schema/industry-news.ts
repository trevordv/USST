import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { scansTable } from "./scans";

export interface IndustryNewsCapacityFact {
  value: number;
  unit: "MW" | "MWac" | "MWdc" | "MWp" | "GW" | "MWh" | "GWh";
}

export interface IndustryNewsSupportingSource {
  name: string;
  url: string;
  sourceClass: "primary" | "secondary" | "commentary";
}

export const industryNewsTable = pgTable(
  "industry_news",
  {
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
    discoveredAt: timestamp("discovered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Additive market-intelligence archive fields. Existing rows remain valid.
    canonicalKey: text("canonical_key"),
    region: text("region"),
    category: text("category"),
    sourceClass: text("source_class"),
    evidenceStatus: text("evidence_status"),
    developmentStatus: text("development_status"),
    noveltyStatus: text("novelty_status"),
    lifecycleStage: text("lifecycle_stage"),
    importance: integer("importance"),
    eventDate: date("event_date", { mode: "string" }),
    secondaryTopics: jsonb("secondary_topics")
      .$type<string[]>()
      .notNull()
      .default([]),
    stakeholderGroups: jsonb("stakeholder_groups")
      .$type<string[]>()
      .notNull()
      .default([]),
    capacityFacts: jsonb("capacity_facts")
      .$type<IndustryNewsCapacityFact[]>()
      .notNull()
      .default([]),
    supportingSources: jsonb("supporting_sources")
      .$type<IndustryNewsSupportingSource[]>()
      .notNull()
      .default([]),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("industry_news_canonical_key_idx").on(table.canonicalKey),
    index("industry_news_scan_id_idx").on(table.scanId),
    index("industry_news_published_date_idx").on(table.publishedDate),
  ],
);

export const industryNewsSourceCoverageTable = pgTable(
  "industry_news_source_coverage",
  {
    id: serial("id").primaryKey(),
    scanId: integer("scan_id")
      .notNull()
      .references(() => scansTable.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    sourceName: text("source_name").notNull(),
    sourceUrl: text("source_url").notNull(),
    geography: text("geography").notNull(),
    sourceClass: text("source_class").notNull(),
    coverage: text("coverage").notNull(),
    accessMethod: text("access_method").notNull().default("targeted-search"),
    status: text("status").notNull(),
    candidateCount: integer("candidate_count").notNull().default(0),
    qualifyingCount: integer("qualifying_count").notNull().default(0),
    failureReason: text("failure_reason"),
    latestPublicationAt: timestamp("latest_publication_at", {
      withTimezone: true,
    }),
    scannedAt: timestamp("scanned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("industry_news_source_coverage_scan_source_unique").on(
      table.scanId,
      table.sourceKey,
    ),
    index("industry_news_source_coverage_scan_idx").on(table.scanId),
    index("industry_news_source_coverage_source_scanned_idx").on(
      table.sourceKey,
      table.scannedAt,
    ),
  ],
);

export type IndustryNewsItem = typeof industryNewsTable.$inferSelect;
export type IndustryNewsSourceCoverage =
  typeof industryNewsSourceCoverageTable.$inferSelect;
