/**
 * Read-only report of projects stored more than once across sources
 * (e.g. the same farm from LUVI, AltEnergy and a news article). Scans from
 * 2026-10-16 link such reports to one project; rows stored before then are
 * listed here for manual review. This script never writes to the database.
 *
 *   pnpm --filter @workspace/scripts run report-duplicate-projects
 */
import { db, projectsTable } from "@workspace/db";

// Keep identical to canonicalProjectKey/capacitiesCompatible in
// artifacts/api-server/src/lib/project-identity.ts.
const GENERIC_TRAILING_WORDS = new Set([
  "farm", "park", "project", "projects", "plant", "station", "power", "facility",
  "development", "pv", "bess", "battery", "storage", "energy", "system", "hybrid", "and",
]);

function normalizeProjectName(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function canonicalProjectKey(name: string, country: string | null): string | null {
  const words = normalizeProjectName(name).split(" ").filter(Boolean);
  while (words.length > 0 && GENERIC_TRAILING_WORDS.has(words[words.length - 1])) words.pop();
  const core = words.join(" ");
  const distinctive = words.filter((word) => word !== "solar");
  if (core.length < 5 || distinctive.join("").length < 4) return null;
  return `${(country ?? "").toUpperCase()}|${core}`;
}

async function main(): Promise<void> {
  const rows = await db.select({
    id: projectsTable.id, name: projectsTable.name, country: projectsTable.country,
    capacityMw: projectsTable.capacityMw, developer: projectsTable.developer,
    sourceName: projectsTable.sourceName, createdAt: projectsTable.createdAt,
  }).from(projectsTable);

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = canonicalProjectKey(row.name, row.country);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const duplicates = [...groups.entries()]
    .filter(([, members]) => new Set(members.map((m) => m.sourceName)).size > 1)
    .sort(([a], [b]) => a.localeCompare(b));

  console.log(`Checked ${rows.length} projects; ${duplicates.length} cross-source duplicate groups.`);
  for (const [key, members] of duplicates) {
    console.log(`\n${key}`);
    for (const m of members.sort((a, b) => a.id - b.id)) {
      console.log(`  #${m.id}\t${m.name}\t${m.capacityMw ?? "?"} MW\t${m.developer ?? "(no developer)"}\t${m.sourceName ?? ""}\t${m.createdAt.toISOString().slice(0, 10)}`);
    }
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
