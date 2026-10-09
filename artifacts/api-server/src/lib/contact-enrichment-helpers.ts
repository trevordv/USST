/**
 * Small pure helpers for contact enrichment (kept out of scraper.ts so they can
 * be tested without the database).
 */

/**
 * Up to `size` items, starting at a position that moves with each enrichment
 * run. Successive runs therefore cover successive developers instead of always
 * re-searching the first `size` and never reaching the rest, at the same cost
 * per run.
 */
export function rotatingWindow<T>(items: readonly T[], size: number, runId: number | undefined): T[] {
  if (size <= 0 || items.length === 0) return [];
  if (items.length <= size) return [...items];
  const start = (Math.max(0, Math.trunc(runId ?? 0)) * size) % items.length;
  return Array.from({ length: size }, (_, offset) => items[(start + offset) % items.length]);
}

interface SearchItem { searchQuery?: { term?: string } }

/**
 * Pair each query with its search result. Uses the query text Apify echoes back
 * when present, and falls back to position only when no item carries one, so a
 * skipped or reordered result can never be attributed to the wrong developer.
 */
export function alignSearchResults<T extends SearchItem>(
  queries: readonly string[],
  items: readonly T[],
): Array<T | undefined> {
  const echoed = items.some((item) => typeof item.searchQuery?.term === "string");
  if (!echoed) return queries.map((_, index) => items[index]);
  const byTerm = new Map<string, T>();
  for (const item of items) {
    const term = item.searchQuery?.term;
    if (typeof term === "string" && !byTerm.has(term)) byTerm.set(term, item);
  }
  return queries.map((query) => byTerm.get(query));
}

/** 3 for director/head/CEO/chief/managing, 2 for a manager, otherwise 1. */
export function linkedInTitleSeniority(title: string): number {
  const lower = title.toLowerCase();
  if (["director", "head", "ceo", "chief", "managing"].some((word) => lower.includes(word))) return 3;
  return lower.includes("manager") ? 2 : 1;
}

/**
 * The email to store: a newly found one, else the project's existing one, else
 * null. A blank string is never stored, because it counts as "has a contact".
 */
export function resolveContactEmail(
  found: string | null | undefined,
  existing: string | null | undefined,
): string | null {
  const next = found?.trim();
  if (next) return next;
  const current = existing?.trim();
  return current ? current : null;
}
