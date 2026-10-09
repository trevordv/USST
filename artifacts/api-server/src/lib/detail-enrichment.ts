/**
 * Bounded "open the article" step for the generic listing sources.
 *
 * List pages and RSS teasers rarely state the MW figure, so projects that are
 * clearly solar but have no capacity were later dropped by the quality gate.
 * This module opens the item's own page, on the same approved site only, and
 * reads capacity from the article text. It is deterministic: no AI is used,
 * and a capacity is only accepted when a solar/PV phrase sits beside it.
 */
import { htmlToText } from "./listing-parser.ts";
import { mapWithConcurrency } from "./concurrency.ts";

export const DETAIL_PAGES_PER_SOURCE = 20;
export const DETAIL_PAGE_WORKERS = 3;
export const DETAIL_MISS_TTL_MS = 24 * 60 * 60 * 1000;
const LEAD_TEXT_CHARS = 2_000;
const MAX_TEXT_CHARS = 12_000;
const MAX_PROJECT_MW = 5_000;

const MW_RE = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(mw|gw|megawatts?|gigawatts?)(?![a-z])/gi;
const SOLAR_CONTEXT_RE = /\b(solar|photovoltaic|pv)\b/i;
const NON_PROJECT_CONTEXT_RE = /\b(nationwide|national(?:ly)?|across (?:australia|new zealand|the country)|installed (?:capacity )?(?:of|in)|total (?:of|installed)|cumulative|pipeline of|record \d)/i;
const OTHER_TECH_RE = /\b(battery|batteries|bess|storage|wind|hydro|pumped)\b/i;

/**
 * Capacity (MW) of the solar project described in article text. Chooses the
 * first figure with a solar/PV word within 60 characters that is not describing
 * a battery, wind unit or nationwide statistic. Returns null rather than guess.
 */
export function extractSolarCapacityMw(text: string): number | null {
  const limited = text.slice(0, MAX_TEXT_CHARS);
  for (const match of limited.matchAll(MW_RE)) {
    const index = match.index ?? 0;
    // Judge the figure by its own sentence only.
    const before = limited.slice(Math.max(0, index - 60), index).split(/[.!?]\s+|\n/).pop() ?? "";
    const after = limited.slice(index + match[0].length, index + match[0].length + 60).split(/[.!?]\s+|\n/)[0] ?? "";
    const window = `${before} ${match[0]} ${after}`;
    if (!SOLAR_CONTEXT_RE.test(window)) continue;
    if (NON_PROJECT_CONTEXT_RE.test(window)) continue;
    // "200 MW solar farm with a 100 MW battery" -> the figure directly before the
    // word "battery/wind" is not the solar capacity.
    if (OTHER_TECH_RE.test(after.slice(0, 20)) && !SOLAR_CONTEXT_RE.test(after.slice(0, 20))) continue;
    const whole = Number(match[1].replace(/,/g, ""));
    let value = match[2] ? Number(`${whole}.${match[2]}`) : whole;
    if (/^g/i.test(match[3])) value *= 1000;
    if (Number.isFinite(value) && value > 0 && value <= MAX_PROJECT_MW) return value;
  }
  return null;
}

/** Main readable text of an article page (prefers <article>/<main>). */
export function extractMainText(html: string): string {
  const stripped = html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<(?:nav|header|footer|aside|form)\b[\s\S]*?<\/(?:nav|header|footer|aside|form)\s*>/gi, " ");
  const region = stripped.match(/<article\b[\s\S]*?<\/article\s*>/i)?.[0]
    ?? stripped.match(/<main\b[\s\S]*?<\/main\s*>/i)?.[0]
    ?? stripped;
  return htmlToText(region).slice(0, MAX_TEXT_CHARS);
}

function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

/** Hosts of the source's own configured URLs; detail pages must stay inside them. */
export function allowedHostsFor(urls: readonly (string | undefined)[]): Set<string> {
  const hosts = new Set<string>();
  for (const value of urls) {
    if (!value) continue;
    try { hosts.add(bareHost(new URL(value).hostname)); } catch { /* ignore malformed */ }
  }
  return hosts;
}

export function isSameSiteUrl(url: string, allowedHosts: ReadonlySet<string>): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = bareHost(parsed.hostname);
    for (const allowed of allowedHosts) {
      if (host === allowed || host.endsWith(`.${allowed}`)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

const MAX_MISS_ENTRIES = 5_000;

function pruneMisses(cache: Map<string, number>, currentTime: number): void {
  if (cache.size <= MAX_MISS_ENTRIES) return;
  for (const [url, at] of cache) {
    if (currentTime - at >= DETAIL_MISS_TTL_MS) cache.delete(url);
  }
  if (cache.size > MAX_MISS_ENTRIES) cache.clear();
}

export interface EnrichableProject {
  sourceUrl: string;
  capacityMw: number | null;
  developer: string | null;
  location: string | null;
  description: string;
  status: "announced" | "under_development";
}

export interface DetailEnrichmentOptions {
  allowedHosts: ReadonlySet<string>;
  fetchPage: (url: string) => Promise<string>;
  /** Extract developer/location/status from the article's lead text. */
  derive?: (leadText: string) => Partial<Pick<EnrichableProject, "developer" | "location" | "status">>;
  /** True when the lead text shows an already-operating project. */
  isExcluded?: (leadText: string) => boolean;
  /** URLs already stored; never re-fetched. */
  knownUrls?: ReadonlySet<string>;
  /** URLs of listing pages themselves, which are not article pages. */
  listingUrls?: ReadonlySet<string>;
  missCache?: Map<string, number>;
  now?: () => number;
  maxPages?: number;
  workers?: number;
}

export interface DetailEnrichmentStats {
  candidates: number;
  attempted: number;
  enriched: number;
  noCapacity: number;
  failed: number;
  skippedKnown: number;
  skippedRecentMiss: number;
  skippedOverLimit: number;
}

/**
 * Fill in capacity (and blank developer/location) for capacity-less projects by
 * reading their own pages. Mutates the projects it enriches. Never throws.
 */
export async function enrichProjectsFromDetailPages<T extends EnrichableProject>(
  projects: readonly T[],
  options: DetailEnrichmentOptions,
): Promise<DetailEnrichmentStats> {
  const now = options.now ?? Date.now;
  const stats: DetailEnrichmentStats = {
    candidates: 0, attempted: 0, enriched: 0, noCapacity: 0, failed: 0,
    skippedKnown: 0, skippedRecentMiss: 0, skippedOverLimit: 0,
  };
  const queue: T[] = [];
  const seen = new Set<string>();

  for (const project of projects) {
    if (project.capacityMw != null) continue;
    const url = project.sourceUrl.split("#")[0];
    if (!isSameSiteUrl(url, options.allowedHosts) || options.listingUrls?.has(url) || seen.has(url)) continue;
    seen.add(url);
    stats.candidates++;
    if (options.knownUrls?.has(project.sourceUrl) || options.knownUrls?.has(url)) { stats.skippedKnown++; continue; }
    const missedAt = options.missCache?.get(url);
    if (missedAt != null && now() - missedAt < DETAIL_MISS_TTL_MS) { stats.skippedRecentMiss++; continue; }
    if (queue.length >= (options.maxPages ?? DETAIL_PAGES_PER_SOURCE)) { stats.skippedOverLimit++; continue; }
    queue.push(project);
  }

  await mapWithConcurrency(queue, options.workers ?? DETAIL_PAGE_WORKERS, async (project) => {
    const url = project.sourceUrl.split("#")[0];
    stats.attempted++;
    let html: string;
    try {
      html = await options.fetchPage(url);
    } catch {
      stats.failed++;
      return;
    }
    const text = extractMainText(html);
    const lead = text.slice(0, LEAD_TEXT_CHARS);
    const capacity = options.isExcluded?.(lead) ? null : extractSolarCapacityMw(text);
    if (capacity == null) {
      stats.noCapacity++;
      if (options.missCache) {
        options.missCache.set(url, now());
        pruneMisses(options.missCache, now());
      }
      return;
    }
    project.capacityMw = capacity;
    const derived = options.derive?.(lead) ?? {};
    if (!project.developer && derived.developer) project.developer = derived.developer;
    if (!project.location && derived.location) project.location = derived.location;
    if (derived.status === "under_development") project.status = derived.status;
    if (project.description.length < 120 && lead.length > project.description.length) {
      project.description = lead.slice(0, 500);
    }
    stats.enriched++;
  });

  return stats;
}
