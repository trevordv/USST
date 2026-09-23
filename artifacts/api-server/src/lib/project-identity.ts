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
