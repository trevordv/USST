import { createHash } from "node:crypto";

export const HARD_BUSINESS_RULES = Object.freeze([
  "Scope is Australia and New Zealand only.",
  "Minimum project capacity is 5 MW.",
  "Projects must include solar; solar plus BESS is allowed.",
  "Standalone BESS and wind-only projects are excluded.",
  "Only the approved source registry may be scanned.",
  "Authentication, deletion, and database access controls require human review.",
]);

export const CRITICAL_KNOWLEDGE_KEYS = new Set([
  "geographic_scope",
  "minimum_capacity_mw",
  "allowed_technologies",
  "approved_source_registry",
  "authentication_rules",
  "deletion_policy",
  "database_access_controls",
]);

export type Confidence = "low" | "medium" | "high";

export function confidenceForEvidence(input: {
  independentObservations: number;
  humanConfirmed?: boolean;
  conflicting?: boolean;
  stale?: boolean;
}): Confidence {
  if (input.conflicting) return "low";
  if (input.humanConfirmed) return "high";
  if (input.independentObservations >= 5 && !input.stale) return "high";
  if (input.independentObservations >= 3) return "medium";
  return "low";
}

const SECRET_KEY = /(password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|session|database_url)/i;
const TOKEN_VALUE = /^(?:eyJ[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|sb_(?:secret|publishable)_[A-Za-z0-9_-]{20,})$/;

export function sanitizeLearningPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeLearningPayload);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? "[redacted]" : sanitizeLearningPayload(item),
    ]));
  }
  if (typeof value === "string" && TOKEN_VALUE.test(value.trim())) return "[redacted]";
  return value;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function memoryFingerprint(input: {
  memoryType: string;
  subjectType: string;
  subjectId?: string | null;
  key: string;
  value: unknown;
  source: string;
}): string {
  return createHash("sha256").update(stable({
    memoryType: input.memoryType,
    subjectType: input.subjectType,
    subjectId: input.subjectId ?? null,
    key: input.key,
    value: sanitizeLearningPayload(input.value),
    source: input.source,
  })).digest("hex");
}

export function contactCacheDecision(input: {
  outcome: "confirmed" | "failed" | "stale";
  observedAt: Date;
  now?: Date;
  confirmedDays?: number;
  failedDays?: number;
}): "reuse" | "skip-identical-query" | "retry" {
  const now = input.now ?? new Date();
  const ageMs = now.getTime() - input.observedAt.getTime();
  const confirmedMs = (input.confirmedDays ?? 90) * 86_400_000;
  const failedMs = (input.failedDays ?? 7) * 86_400_000;
  if (input.outcome === "confirmed" && ageMs < confirmedMs) return "reuse";
  if (input.outcome === "failed" && ageMs < failedMs) return "skip-identical-query";
  return "retry";
}

export function reliabilityScore(input: {
  successes: number;
  failures: number;
  parserSuccesses: number;
  parserFailures: number;
  fallbackSuccesses: number;
}): number {
  const accessTotal = input.successes + input.failures;
  const parserTotal = input.parserSuccesses + input.parserFailures;
  if (accessTotal + parserTotal === 0) return 50;
  const access = accessTotal ? input.successes / accessTotal : 0.5;
  const parser = parserTotal ? input.parserSuccesses / parserTotal : 0.5;
  const fallbackPenalty = input.successes ? Math.min(0.15, input.fallbackSuccesses / input.successes * 0.1) : 0;
  return Math.round(Math.max(0, Math.min(1, access * 0.55 + parser * 0.45 - fallbackPenalty)) * 100);
}

export function canKnowledgeOverrideHardRules(): false {
  return false;
}
