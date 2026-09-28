import { createHash } from "node:crypto";

export const ENRICHMENT_LIMITS = Object.freeze({
  maxLushaCredits: 100,
  maxCompanyBatch: 25,
  maxApifyQueries: 50,
  maxLinkedInQueries: 40,
  cooldownHours: 168,
});

export interface EnrichmentRunOptions {
  approvedPaidProspecting: boolean;
  maxLushaCredits: number;
  companyBatchSize: number;
  maxApifyQueries: number;
  maxLinkedInQueries: number;
  dryRun: boolean;
}

export function boundedInteger(value: unknown, fallback: number, maximum: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : fallback;
}

export function normalizeEnrichmentOptions(value: Partial<EnrichmentRunOptions> = {}): EnrichmentRunOptions {
  const approved = value.approvedPaidProspecting === true;
  return {
    approvedPaidProspecting: approved,
    maxLushaCredits: approved ? boundedInteger(value.maxLushaCredits, 0, ENRICHMENT_LIMITS.maxLushaCredits) : 0,
    companyBatchSize: boundedInteger(value.companyBatchSize, 10, ENRICHMENT_LIMITS.maxCompanyBatch),
    maxApifyQueries: boundedInteger(value.maxApifyQueries, 0, ENRICHMENT_LIMITS.maxApifyQueries),
    maxLinkedInQueries: boundedInteger(value.maxLinkedInQueries, 0, ENRICHMENT_LIMITS.maxLinkedInQueries),
    dryRun: value.dryRun === true,
  };
}

const ROLE_RE = /\b(?:head of (?:project|projects|development)|(?:business development|development|project|commercial|country|general|managing) (?:director|manager|lead|head)|chief executive officer|ceo)\b/i;

function normalizedWords(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizedDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.includes("@") ? value.split("@").pop()! : value;
  try {
    const host = raw.includes("://") ? new URL(raw).hostname : raw;
    return host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch { return null; }
}

function companyMatches(expected: string, actual: string): boolean {
  const left = normalizedWords(expected).replace(/\b(pty|limited|ltd|group|holdings|energy|renewables)\b/g, "").replace(/\s+/g, " ").trim();
  const right = normalizedWords(actual).replace(/\b(pty|limited|ltd|group|holdings|energy|renewables)\b/g, "").replace(/\s+/g, " ").trim();
  return left.length >= 3 && right.length >= 3 && left === right;
}

export interface ProviderContactCandidate {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  currentCompany?: string | null;
  companyDomain?: string | null;
  providerPersonId?: string | null;
  providerCompanyId?: string | null;
}

export type CandidateDecision =
  | { accepted: true; name: string; email: string; phone: string | null; fingerprint: string }
  | { accepted: false; reason: string };

export function validateProviderCandidate(input: {
  candidate: ProviderContactCandidate;
  developer: string;
  developerDomain?: string | null;
  expectedName?: string | null;
  requireRelevantRole?: boolean;
}): CandidateDecision {
  const { candidate } = input;
  const first = normalizedWords(candidate.firstName);
  const last = normalizedWords(candidate.lastName);
  if (!first || !last) return { accepted: false, reason: "incomplete-person-identity" };
  if (input.expectedName) {
    const expected = normalizedWords(input.expectedName).split(" ");
    if (expected.length < 2 || first !== expected[0] || last !== expected.slice(1).join(" ")) {
      return { accepted: false, reason: "person-identity-mismatch" };
    }
  }
  if (!candidate.currentCompany || !companyMatches(input.developer, candidate.currentCompany)) {
    return { accepted: false, reason: "current-employer-mismatch" };
  }
  if (input.requireRelevantRole !== false && !ROLE_RE.test(candidate.jobTitle ?? "")) {
    return { accepted: false, reason: "irrelevant-role" };
  }
  const email = candidate.email?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { accepted: false, reason: "missing-professional-email" };
  const emailDomain = normalizedDomain(email);
  const expectedDomain = normalizedDomain(input.developerDomain ?? candidate.companyDomain);
  if (!emailDomain || !expectedDomain || !(emailDomain === expectedDomain || emailDomain.endsWith(`.${expectedDomain}`))) {
    return { accepted: false, reason: "professional-email-domain-mismatch" };
  }
  const name = `${candidate.firstName!.trim()} ${candidate.lastName!.trim()}`;
  return {
    accepted: true,
    name,
    email,
    phone: candidate.phone?.trim() || null,
    fingerprint: createHash("sha256").update(`${normalizedWords(name)}|${email}`).digest("hex"),
  };
}

export interface AttemptCandidate { key: string; nextEligibleAt?: Date | null; lastAttemptAt?: Date | null }

export function selectResumableBatch<T extends AttemptCandidate>(items: T[], limit: number, now = new Date()): T[] {
  if (limit <= 0) return [];
  return [...items]
    .filter((item) => !item.nextEligibleAt || item.nextEligibleAt <= now)
    .sort((a, b) => (a.lastAttemptAt?.getTime() ?? 0) - (b.lastAttemptAt?.getTime() ?? 0) || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export function safeProviderError(error: unknown): { category: string; status?: number } {
  const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
    ? error.status : undefined;
  return { category: status === 429 ? "quota-or-rate-limit" : "provider-error", ...(status ? { status } : {}) };
}
