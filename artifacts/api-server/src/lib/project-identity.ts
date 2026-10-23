import { normalizeProjectName, projectSlug } from "./source-text.ts";

function stripUrlFragment(url: string): string {
  return url.split("#")[0].replace(/\/$/, "");
}

/**
 * Give every project a source URL that identifies *it*.
 *
 * The scan pipeline keys existing records, deduplication and lineage on
 * `source_url`. Projects extracted from a listing page (or several projects
 * covered by one article) used to carry the same URL, so only the first project
 * per page survived. A listing-level or shared URL gets a stable
 * `#<project-slug>` fragment; a unique article/detail URL is left untouched so
 * previously stored records keep matching. The result is independent of the
 * order in which projects were extracted.
 */
export function assignProjectIdentityUrls<T extends { name: string; sourceUrl: string }>(
  listingUrls: ReadonlyArray<string | null | undefined>,
  projects: T[],
): T[] {
  const listings = new Set(listingUrls.filter((url): url is string => Boolean(url)).map(stripUrlFragment));
  const namesByUrl = new Map<string, Set<string>>();
  for (const project of projects) {
    const base = stripUrlFragment(project.sourceUrl);
    const names = namesByUrl.get(base) ?? new Set<string>();
    names.add(normalizeProjectName(project.name));
    namesByUrl.set(base, names);
  }
  for (const project of projects) {
    if (project.sourceUrl.includes("#")) continue;
    const base = stripUrlFragment(project.sourceUrl);
    const shared = (namesByUrl.get(base)?.size ?? 0) > 1;
    if (listings.has(base) || shared) {
      project.sourceUrl = `${project.sourceUrl}#${projectSlug(project.name)}`;
    }
  }
  return projects;
}

// Trailing words that describe the asset type rather than identify it. "Corop
// Solar Farm", "Corop Solar Project" and "Corop Solar & BESS Project" all
// reduce to "corop solar". "Solar" itself is retained so a solar project is
// never keyed together with an unrelated non-solar asset of the same place name.
const GENERIC_TRAILING_WORDS = new Set([
  "farm", "park", "project", "projects", "plant", "station", "power", "facility",
  "development", "pv", "bess", "battery", "storage", "energy", "system", "hybrid", "and",
]);

/**
 * Cross-source identity key: country + project name without generic asset
 * suffixes. Returns null when the remaining name is too short to be specific.
 */
export function canonicalProjectKey(name: string | null | undefined, country: string | null | undefined): string | null {
  const words = normalizeProjectName(name ?? "").split(" ").filter(Boolean);
  while (words.length > 0 && GENERIC_TRAILING_WORDS.has(words[words.length - 1])) words.pop();
  const core = words.join(" ");
  // Require a distinctive place/name token besides "solar".
  const distinctive = words.filter((word) => word !== "solar");
  if (core.length < 5 || distinctive.join("").length < 4) return null;
  return `${(country ?? "").toUpperCase()}|${core}`;
}

/** Capacities agree when either is unknown or they are within 35% of each other. */
export function capacitiesCompatible(a: number | string | null | undefined, b: number | string | null | undefined): boolean {
  const x = Number(a);
  const y = Number(b);
  if (a == null || b == null || !Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) return true;
  return Math.min(x, y) / Math.max(x, y) >= 0.65;
}
