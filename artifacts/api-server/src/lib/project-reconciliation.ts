import { normalizeProjectName } from "./source-text.ts";

export interface ReconciliationProject {
  id: number;
  name: string;
  developer?: string | null;
  location?: string | null;
  country?: string | null;
}

export interface CanonicalAliasMatch {
  canonicalProjectId: number;
  reason: "known-alias-with-corroboration";
}

export const REVIEWED_NARROGIN_RECONCILIATIONS = [
  { legacyProjectId: 1563, canonicalProjectId: 570, aliases: ["Narrogin East Renewable Energy Project"], developer: /lightsource\s*bp/i },
  { legacyProjectId: 1564, canonicalProjectId: 570, aliases: ["Narrogin East Renewable Energy Precinct"], developer: /lightsource\s*bp/i },
  { legacyProjectId: 1565, canonicalProjectId: 554, aliases: ["Ace Power's approved Narrogin Solar Farm"], developer: /tagenergy|arp australian solar/i },
] as const;

function developerMatches(value: string | null | undefined, expected: RegExp): boolean {
  return expected.test(value ?? "");
}

/**
 * Explicit, evidence-backed aliases for the two distinct Narrogin assets.
 * This is deliberately not fuzzy matching: shared town names must never merge
 * Lightsource bp's eastern hybrid project with ACE Power/TagEnergy's solar
 * farm south of Narrogin.
 */
export function matchKnownCanonicalAlias(
  candidate: Pick<ReconciliationProject, "name" | "developer" | "country">,
  existing: readonly ReconciliationProject[],
): CanonicalAliasMatch | null {
  if (candidate.country && candidate.country !== "AU") return null;
  const name = normalizeProjectName(candidate.name);
  const reviewed = REVIEWED_NARROGIN_RECONCILIATIONS.find((entry) =>
    entry.aliases.some((alias) => normalizeProjectName(alias) === name),
  );
  if (reviewed) {
    const canonical = existing.find((project) => project.id === reviewed.canonicalProjectId
      && developerMatches(project.developer, reviewed.developer));
    if (canonical) return { canonicalProjectId: canonical.id, reason: "known-alias-with-corroboration" };
  }
  return null;
}

export function reviewedLegacyIdsForCanonical(canonicalProjectId: number): number[] {
  return REVIEWED_NARROGIN_RECONCILIATIONS
    .filter((entry) => entry.canonicalProjectId === canonicalProjectId)
    .map((entry) => entry.legacyProjectId);
}

/** An article may mention related assets, but only its primary subject is an event. */
export function isPrimaryArticleSubject(candidateName: string, articleTitle: string, articleBody: string): boolean {
  const candidate = normalizeProjectName(candidateName);
  const title = normalizeProjectName(articleTitle);
  if (candidate.length < 6) return false;
  if (title.includes(candidate)) return true;
  const opening = articleBody.slice(0, 1_200).toLowerCase();
  const position = opening.indexOf(candidateName.toLowerCase());
  if (position < 0) return false;
  // A secondary asset is eligible only when its own sentence has both a real
  // calendar date and an explicit project-change verb. A publication date is
  // not sufficient evidence for a contextual reference.
  const sentence = opening.slice(Math.max(0, opening.lastIndexOf(".", position - 1) + 1), opening.indexOf(".", position) + 1 || opening.length);
  return /\b(?:20\d{2}|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(sentence)
    && /\b(?:approved|lodged|submitted|commenced|commences|constructed|announced|received|granted)\b/i.test(sentence);
}

/** Select one primary subject unless a secondary has explicit dated change evidence. */
export function filterPrimaryArticleSubjects<T extends { name: string }>(
  candidates: readonly T[], articleTitle: string, articleBody: string,
): T[] {
  if (candidates.length < 2) return [...candidates];
  const title = normalizeProjectName(articleTitle);
  const titled = candidates.filter((candidate) => title.includes(normalizeProjectName(candidate.name)));
  if (titled.length) return candidates.filter((candidate) => titled.includes(candidate) || isPrimaryArticleSubject(candidate.name, articleTitle, articleBody));
  const opening = articleBody.slice(0, 1_200).toLowerCase();
  const first = [...candidates].sort((a, b) => opening.indexOf(a.name.toLowerCase()) - opening.indexOf(b.name.toLowerCase()))[0];
  return candidates.filter((candidate) => candidate === first || isPrimaryArticleSubject(candidate.name, articleTitle, articleBody));
}

/** Stable cross-scan event identity. Date prevents distinct dated changes from collapsing. */
export function sourceEventKey(projectId: number, sourceUrl: string, eventDate: string): string {
  return `${projectId}|${sourceUrl.split("#")[0].replace(/\/$/, "")}|${eventDate}`;
}
