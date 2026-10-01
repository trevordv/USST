import { createHash } from "node:crypto";
import { db, scanSourceHealthTable, type InsertScanSourceHealth } from "@workspace/db";

export type DurableSourceOutcome =
  | "success-with-results"
  | "success-zero-results"
  | "blocked"
  | "timeout"
  | "extraction-failed"
  | "missing-credentials"
  | "rate-limited"
  | "provider-error";

export interface ScanSourceHealthInput {
  sourceName: string;
  acquisitionMethod: string;
  directAttempted: boolean;
  firecrawlAttempted: boolean;
  firecrawlSucceeded: boolean;
  apifyAttempted: boolean;
  brightDataAttempted: boolean;
  openaiNormalisationAttempted: boolean;
  openaiNormalisationSucceeded: boolean;
  fallbackUsed: boolean;
  outcome: DurableSourceOutcome;
  candidateCount: number;
  qualifyingProjectCount: number;
  durationMs: number;
  failureCategory?: string | null;
  failureReason?: string | null;
  contentFingerprint?: string | null;
  firecrawlCalls?: number;
  firecrawlPages?: number;
  firecrawlCacheReused?: boolean;
}

export function combineContentFingerprints(values: Iterable<string>): string | null {
  const unique = [...new Set(values)].filter((value) => /^[a-f0-9]{64}$/.test(value)).sort();
  if (!unique.length) return null;
  return createHash("sha256").update(unique.join(":"), "utf8").digest("hex");
}

export function safeSourceFailureReason(category?: string | null): string | null {
  if (!category) return null;
  const messages: Record<string, string> = {
    "missing-credentials": "Required provider credentials are not configured",
    "auth-failed": "Provider authentication failed",
    blocked: "Approved source access was blocked",
    "public-access-block": "Approved public source denied direct access",
    timeout: "Source acquisition timed out",
    "rate-limited": "Provider rate or quota limit was reached",
    network: "Source acquisition encountered a network failure",
    parser: "Acquired content could not be parsed deterministically",
    "invalid-content": "Acquired content was unusable",
    "provider-error": "Managed acquisition provider failed",
    "malformed-response": "Managed provider returned an invalid response",
    "empty-content": "Managed provider returned no usable content",
    "unsafe-final-url": "Managed provider redirected outside the approved hostname",
    unclassified: "Source acquisition failed",
  };
  return messages[category] ?? "Source acquisition failed";
}

export async function persistScanSourceHealth(scanId: number, input: ScanSourceHealthInput): Promise<void> {
  const row: InsertScanSourceHealth = {
    scanId,
    ...input,
    failureCategory: input.failureCategory ?? null,
    failureReason: input.failureReason ?? safeSourceFailureReason(input.failureCategory),
    contentFingerprint: input.contentFingerprint ?? null,
    firecrawlCalls: input.firecrawlCalls ?? 0,
    firecrawlPages: input.firecrawlPages ?? 0,
    firecrawlCacheReused: input.firecrawlCacheReused ?? false,
  };
  await db.insert(scanSourceHealthTable).values(row);
}
