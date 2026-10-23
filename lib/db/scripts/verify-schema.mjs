import pg from "pg";

const { Client } = pg;

const REQUIRED_COLUMNS = {
  industry_news: [
    "canonical_key",
    "region",
    "category",
    "source_class",
    "evidence_status",
    "development_status",
    "novelty_status",
    "lifecycle_stage",
    "importance",
    "event_date",
    "secondary_topics",
    "stakeholder_groups",
    "capacity_facts",
    "supporting_sources",
    "first_seen_at",
    "last_seen_at",
  ],
  industry_news_source_coverage: [
    "scan_id",
    "source_key",
    "status",
    "candidate_count",
    "qualifying_count",
    "scanned_at",
  ],
};

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the database schema gate");
}

const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  const tableNames = Object.keys(REQUIRED_COLUMNS);
  const { rows } = await client.query(
    `select table_name, column_name
       from information_schema.columns
      where table_schema = 'public'
        and table_name = any($1::text[])`,
    [tableNames],
  );

  const actual = new Map();
  for (const row of rows) {
    if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
    actual.get(row.table_name).add(row.column_name);
  }

  const missing = [];
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    for (const column of columns) {
      if (!actual.get(table)?.has(column)) missing.push(`${table}.${column}`);
    }
  }

  if (missing.length) {
    throw new Error(
      `Database migration gate failed; missing: ${missing.join(", ")}`,
    );
  }

  console.log(
    JSON.stringify({
      event: "database-schema-gate",
      passed: true,
      tables: tableNames,
    }),
  );
} finally {
  await client.end();
}
