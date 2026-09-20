import { mapWithConcurrency } from "./concurrency.ts";
import { EXCLUDE_KEYWORDS, determineStatus, extractCapacity, extractDeveloper, extractLocation } from "./source-heuristics.ts";
import { extractMainText, isApprovedDiscoveredUrl } from "./source-text.ts";

export const ARTICLE_ENRICH_LIMIT = 30;
export const ARTICLE_ENRICH_CONCURRENCY = 4;

export interface EnrichableProject {
  name: string;
  sourceUrl: string;
  description: string;
  capacityMw: number | null;
  developer: string | null;
  location: string | null;
  status: "announced" | "under_development";
  needsArticleEnrichment?: boolean;
}

export interface EnrichmentOptions {
  country: "AU" | "NZ";
  /** Only these hosts (the source's own approved hosts) may be fetched. */
  approvedHosts: ReadonlySet<string>;
  fetchHtml: (url: string) => Promise<string>;
  isNoisyName: (name: string) => boolean;
  limit?: number;
  concurrency?: number;
}

export interface EnrichmentResult<T> {
  kept: T[];
  attempted: number;
  enriched: number;
  dropped: number;
}

/**
 * Read the source's own article page for candidates whose feed excerpt or
 * listing card carried no MW figure.
 *
 * Excerpts rarely include the rating, so previously most solar articles were
 * discarded at the eligibility gate for "missing-capacity". Reading the
 * article is deterministic, free of AI cost, restricted to the source's
 * approved hosts, bounded in count and concurrency, and failure-tolerant: a
 * blocked, slow or missing article leaves the candidate without capacity, so
 * the shared gate drops it exactly as before. Articles whose opening text shows
 * the project is already operating are dropped.
 */
export async function enrichProjectsFromArticles<T extends EnrichableProject>(
  projects: readonly T[],
  options: EnrichmentOptions,
): Promise<EnrichmentResult<T>> {
  const targets = projects
    .filter((project) => project.needsArticleEnrichment && project.capacityMw == null && !options.isNoisyName(project.name))
    .filter((project) => isApprovedDiscoveredUrl(project.sourceUrl, options.approvedHosts))
    .slice(0, options.limit ?? ARTICLE_ENRICH_LIMIT);
  if (!targets.length) return { kept: [...projects], attempted: 0, enriched: 0, dropped: 0 };

  const dropped = new Set<T>();
  let enriched = 0;
  await mapWithConcurrency(targets, options.concurrency ?? ARTICLE_ENRICH_CONCURRENCY, async (project) => {
    try {
      const html = await options.fetchHtml(project.sourceUrl.split("#")[0]);
      const text = extractMainText(html);
      if (!text) return;
      if (EXCLUDE_KEYWORDS.some((keyword) => text.slice(0, 1_200).toLowerCase().includes(keyword))) {
        dropped.add(project);
        return;
      }
      const capacityMw = extractCapacity(`${project.name} ${text}`);
      if (capacityMw == null) return;
      project.capacityMw = capacityMw;
      project.description = `${project.description ? `${project.description.slice(0, 200)}. ` : ""}${text.slice(0, 500)}`.slice(0, 800);
      project.developer ??= extractDeveloper(text.slice(0, 2_000));
      project.location ??= extractLocation(text, options.country);
      if (determineStatus(text) === "under_development") project.status = "under_development";
      enriched++;
    } catch {
      // Blocked / timeout / HTTP error: leave the candidate unchanged.
    }
  });
  for (const project of projects) project.needsArticleEnrichment = false;
  return {
    kept: projects.filter((project) => !dropped.has(project)),
    attempted: targets.length,
    enriched,
    dropped: dropped.size,
  };
}
