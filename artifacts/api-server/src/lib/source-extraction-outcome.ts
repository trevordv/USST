export type ExtractionOutcome =
  | "success-with-results"
  | "success-zero-results"
  | "fetch-failed"
  | "parse-failed"
  | "content-unusable"
  | "requires-js-or-ai-repair";

export interface ExtractionAttempt {
  method: string;
  url?: string;
  outcome: ExtractionOutcome;
  reason?: string;
  failureCategory?: "blocked" | "public-access-block" | "timeout" | "http-error" | "invalid-content" | "network" | "parser";
}

export class SourceExtractionError extends Error {
  readonly outcome: "parse-failed" | "content-unusable" | "requires-js-or-ai-repair";
  constructor(outcome: "parse-failed" | "content-unusable" | "requires-js-or-ai-repair", message: string) {
    super(message);
    this.name = "SourceExtractionError";
    this.outcome = outcome;
  }
}

export function failedExtractionOutcome(error: unknown, phase: "fetch" | "parse"): ExtractionOutcome {
  if (error instanceof SourceExtractionError) return error.outcome;
  if (error && typeof error === "object" && "problem" in error && error.problem === "invalid-content") return "content-unusable";
  return phase === "fetch" ? "fetch-failed" : "parse-failed";
}

export function successfulExtractionOutcome(count: number): ExtractionOutcome {
  return count > 0 ? "success-with-results" : "success-zero-results";
}

/** A repair needs positive failure evidence, never just a zero project count. */
export function paidSourceFallbackReason(attempts: readonly ExtractionAttempt[], configured: boolean): string | undefined {
  if (!configured || attempts.some(a => a.outcome === "success-with-results")) return undefined;
  const failed = attempts.filter(a => a.outcome !== "success-zero-results");
  if (!failed.length) return undefined;
  return failed.map(a => `${a.method}: ${a.outcome}${a.reason ? ` (${a.reason})` : ""}`).join("; ");
}

/** Validate parser input/shape before treating a regex parser's [] as success. */
export function assertSourceDocument(text: string, format: "rss" | "html" | "structured-html"): void {
  if (!text.trim()) throw new SourceExtractionError("content-unusable", "empty source document");
  if (format === "rss") {
    if (!/<rss\b/i.test(text) || !/<channel\b/i.test(text)) {
      throw new SourceExtractionError("content-unusable", "expected an RSS channel");
    }
    if (!/<\/rss\s*>/i.test(text) || !/<\/channel\s*>/i.test(text) ||
        (text.match(/<item\b/gi)?.length ?? 0) !== (text.match(/<\/item\s*>/gi)?.length ?? 0)) {
      throw new SourceExtractionError("parse-failed", "incomplete RSS document");
    }
    return;
  }
  const visible = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").trim();
  if (!visible || /^(?:loading[.\s…]*|(?:please )?enable javascript[.\s]*)$/i.test(visible)) {
    throw new SourceExtractionError(/<script\b/i.test(text) ? "requires-js-or-ai-repair" : "content-unusable", "no usable server-rendered content");
  }
  // Match the structures consumed by the existing parsers, not project keywords
  // or eligibility. Non-solar, out-of-window and sub-threshold entries are valid.
  const hasStructure = format === "structured-html"
    ? /<(?:tr|article|h[2-4])\b/i.test(text)
    : /<article\b/i.test(text) ||
      /<(?:div|section|li)\b[^>]*\bclass=["'][^"']*(?:post|article|entry|item|result|card|teaser|story|listing|news|views-row)/i.test(text);
  const explicitEmpty = /\bno (?:matching |current |eligible )?(?:results|projects|items|posts|articles)\b|nothing found/i.test(visible);
  if (!hasStructure && !explicitEmpty) {
    throw new SourceExtractionError("parse-failed", "source document does not contain the configured parser structure or an explicit empty state");
  }
}
