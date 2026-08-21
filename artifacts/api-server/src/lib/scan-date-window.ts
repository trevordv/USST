export type ScanDateEvidence =
  | "source_reported"
  | "source_update"
  | "altenergy_source_update"
  | "persisted_announcement"
  | "unknown";

export function parseSourceAnnouncementDate(raw: Record<string, unknown>): string | null {
  for (const value of [raw.announcedDate, raw.announcementDate, raw.eventDate]) {
    if (typeof value !== "string") continue;
    const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})(?:T.*)?$/);
    if (!match) continue;
    const parsed = new Date(`${match[1]}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === match[1]) return match[1];
  }
  return null;
}

export interface ScanDateDecision {
  include: boolean;
  effectiveDate: string | null;
  evidence: ScanDateEvidence;
  reason: "in-window" | "unbounded" | "before-start" | "after-end" | "unknown-date";
}

export function decideScanDateWindow(input: {
  startDate?: string | null;
  endDate?: string | null;
  scrapedAnnouncedDate?: string | null;
  sourceEventDate?: string | null;
  sourceEventEvidence?: Extract<ScanDateEvidence, "source_update" | "altenergy_source_update">;
  persistedAnnouncedDate?: string | null;
  existingProject: boolean;
}): ScanDateDecision {
  const bounded = Boolean(input.startDate || input.endDate);
  // An explicit source event is a real update and may qualify either a new or
  // existing project for the scan window. It remains separate from the
  // project's announcement date and therefore cannot rewrite project history.
  const effectiveDate = input.sourceEventDate ?? (input.existingProject
    ? input.persistedAnnouncedDate ?? null
    : input.scrapedAnnouncedDate ?? null);
  const evidence: ScanDateEvidence = effectiveDate == null
    ? "unknown"
    : input.sourceEventDate
      ? input.sourceEventEvidence ?? "source_update"
      : input.existingProject ? "persisted_announcement" : "source_reported";

  if (!bounded) return { include: true, effectiveDate, evidence, reason: "unbounded" };
  if (effectiveDate == null) return { include: false, effectiveDate: null, evidence, reason: "unknown-date" };
  if (input.startDate && effectiveDate < input.startDate) return { include: false, effectiveDate, evidence, reason: "before-start" };
  if (input.endDate && effectiveDate > input.endDate) return { include: false, effectiveDate, evidence, reason: "after-end" };
  return { include: true, effectiveDate, evidence, reason: "in-window" };
}

export function relationIsInsidePersistedWindow(input: {
  startDate?: string | null;
  endDate?: string | null;
  effectiveDate?: string | null;
}): boolean {
  if (!input.startDate && !input.endDate) return true;
  if (!input.effectiveDate) return false;
  if (input.startDate && input.effectiveDate < input.startDate) return false;
  if (input.endDate && input.effectiveDate > input.endDate) return false;
  return true;
}

export function filterRelationsForScanWindow<T extends { effectiveDate?: string | null }>(
  relations: readonly T[],
  window: { startDate?: string | null; endDate?: string | null },
): T[] {
  return relations.filter((relation) => relationIsInsidePersistedWindow({ ...window, effectiveDate: relation.effectiveDate }));
}
