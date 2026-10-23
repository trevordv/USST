/**
 * Contact discovery for the projects a scan reports as new.
 *
 * 1. Free: read the project description for a named person, a developer email
 *    and an AU/NZ phone number (fills blank fields only).
 * 2. Paid, bounded: for developers whose new projects still have neither an
 *    email nor a phone, ask Lusha v3 — the named person when the text gave one,
 *    otherwise the most sales-relevant AU/NZ person at the developer. One lookup
 *    per developer covers all of its new projects. Stops at the credit budget or
 *    on a Lusha billing/permission error.
 *
 * Requested by the product owner on 2026-10-16 (see docs/Decision-Log.md):
 * this runs automatically after a scan, replacing the earlier rule that contact
 * enrichment is only ever a manual action.
 */
import { extractContactFromText, emailMatchesCompany } from "./contact-from-text.ts";
import type { LushaContactResult, LushaV3Client } from "./lusha-v3.ts";

export interface NewProjectContactRow {
  id: number;
  name: string;
  developer: string | null;
  description: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

export interface ContactFieldUpdate {
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface NewProjectContactSummary {
  projects: number;
  textContactsApplied: number;
  lushaLookups: number;
  lushaProjectsUpdated: number;
  lushaCreditsUsed: number;
  lushaCreditsReserved: number;
  stoppedReason: "done" | "budget" | "provider-refused" | "disabled";
}

type LushaLike = Pick<LushaV3Client, "findNamedPerson" | "findCompanyContact">;

const NOT_A_PERSON_NAME_RE = /\b(team|group|office|crew|solar|renewables?|energy|pty|ltd|limited|projects?|enquiries|info|media)\b/i;

function personParts(name: string | null | undefined): { firstName: string; lastName: string } | null {
  const clean = name?.replace(/\s+/g, " ").trim();
  if (!clean || NOT_A_PERSON_NAME_RE.test(clean)) return null;
  const space = clean.indexOf(" ");
  if (space <= 0) return null;
  return { firstName: clean.slice(0, space), lastName: clean.slice(space + 1) };
}

function developerKey(developer: string | null | undefined): string | null {
  const key = (developer ?? "").toLowerCase().replace(/\b(pty|ltd|limited)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  return key || null;
}

/** Keep a Lusha email only when it belongs to the developer. */
function acceptedLushaEmail(result: LushaContactResult, developer: string): string | null {
  if (!result.email) return null;
  const domain = result.email.split("@")[1] ?? "";
  if (result.companyDomain && (domain === result.companyDomain || domain.endsWith(`.${result.companyDomain}`))) return result.email;
  return emailMatchesCompany(result.email, developer) ? result.email : null;
}

export async function discoverNewProjectContacts(
  rows: readonly NewProjectContactRow[],
  deps: {
    lusha: LushaLike | null;
    maxCredits: number;
    /**
     * Upper bound configured from the account's Lusha plan.  We must reserve
     * this before a request because Lusha only reports credits after charging.
     */
    maxCreditsPerRequest: number;
    update: (projectId: number, fields: ContactFieldUpdate) => Promise<void>;
    log?: (event: string, fields: Record<string, unknown>) => void;
  },
): Promise<NewProjectContactSummary> {
  const log = deps.log ?? (() => {});
  const summary: NewProjectContactSummary = {
    projects: rows.length, textContactsApplied: 0, lushaLookups: 0, lushaProjectsUpdated: 0,
    lushaCreditsUsed: 0, lushaCreditsReserved: 0, stoppedReason: "done",
  };
  const state = rows.map((row) => ({ ...row }));

  // ── 1. Free extraction from the description ───────────────────────────────
  for (const row of state) {
    if (row.contactEmail && row.contactPhone && row.contactName) continue;
    const found = extractContactFromText(row.description, row.developer);
    const fields: ContactFieldUpdate = {};
    if (!row.contactName?.trim() && found.name) fields.contactName = found.name;
    if (!row.contactEmail?.trim() && found.email) fields.contactEmail = found.email;
    if (!row.contactPhone?.trim() && found.phone) fields.contactPhone = found.phone;
    if (Object.keys(fields).length === 0) continue;
    await deps.update(row.id, fields);
    Object.assign(row, fields);
    summary.textContactsApplied++;
    log("contact_from_description", { projectId: row.id, fields: Object.keys(fields) });
  }

  // ── 2. Lusha for developers still lacking any email or phone ──────────────
  if (!deps.lusha || deps.maxCredits <= 0 || deps.maxCreditsPerRequest <= 0) {
    summary.stoppedReason = "disabled";
    return summary;
  }
  const groups = new Map<string, typeof state>();
  for (const row of state) {
    if (row.contactEmail?.trim() || row.contactPhone?.trim()) continue;
    const key = developerKey(row.developer);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  // Developers with the most new projects first: one lookup covers them all.
  const ordered = [...groups.values()].sort((a, b) => b.length - a.length);
  const canReserve = (requests: number): boolean =>
    summary.lushaCreditsReserved + requests * deps.maxCreditsPerRequest <= deps.maxCredits;
  const reserve = (requests: number): void => {
    summary.lushaCreditsReserved += requests * deps.maxCreditsPerRequest;
  };

  for (const group of ordered) {
    const developer = group[0].developer!;
    const named = group.map((row) => personParts(row.contactName)).find(Boolean) ?? null;
    let result: LushaContactResult | null = null;
    try {
      if (named) {
        if (!canReserve(1)) { summary.stoppedReason = "budget"; break; }
        reserve(1);
        summary.lushaLookups++;
        result = await deps.lusha.findNamedPerson({ ...named, companyName: developer });
        summary.lushaCreditsUsed += Math.max(1, result?.creditsCharged ?? 0);
      }
      const namedUseful = result && (acceptedLushaEmail(result, developer) || result.phone);
      // Company search may perform two prospecting calls (AU/NZ then global)
      // plus one reveal. Reserve all three before asking the provider.
      if (!namedUseful) {
        if (!canReserve(3)) { summary.stoppedReason = "budget"; break; }
        reserve(3);
        summary.lushaLookups++;
        const companyResult = await deps.lusha.findCompanyContact({ companyName: developer, companyDomain: result?.companyDomain ?? null });
        summary.lushaCreditsUsed += Math.max(1, companyResult?.creditsCharged ?? 0);
        result = companyResult;
      }
    } catch (error) {
      const status = (error as { status?: number }).status;
      log("lusha_lookup_failed", { developer, status });
      if (status === 401 || status === 402 || status === 403) { summary.stoppedReason = "provider-refused"; break; }
      continue;
    }
    if (!result) continue;
    const email = acceptedLushaEmail(result, developer);
    const phone = result.phone;
    if (!email && !phone) { log("lusha_no_contact", { developer }); continue; }

    for (const row of group) {
      const fields: ContactFieldUpdate = {};
      // The revealed details belong to the Lusha person: keep name and details consistent.
      if (result.name && (!row.contactName?.trim() || row.contactName.trim().toLowerCase() !== result.name.toLowerCase())) fields.contactName = result.name;
      if (!row.contactEmail?.trim() && email) fields.contactEmail = email;
      if (!row.contactPhone?.trim() && phone) fields.contactPhone = phone;
      if (!fields.contactEmail && !fields.contactPhone) continue;
      await deps.update(row.id, fields);
      Object.assign(row, fields);
      summary.lushaProjectsUpdated++;
    }
    log("lusha_contact_applied", { developer, projects: group.length, email: Boolean(email), phone: Boolean(phone), title: result.title });
  }
  return summary;
}
