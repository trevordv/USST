/** A valid empty extraction is not an extraction failure. */
export function sourceAcquisitionOutcome(input: {
  projectCount: number;
  directSucceeded: boolean;
  fallbackSucceeded: boolean;
  failureOutcome: "blocked" | "timeout" | "extraction-failed";
}): "success" | "empty" | "blocked" | "timeout" | "extraction-failed" {
  if (input.projectCount > 0) return "success";
  if (input.directSucceeded || input.fallbackSucceeded) return "empty";
  return input.failureOutcome;
}

/** Distinguish an explicit [] from an unavailable or malformed extraction. */
export function parseSourceFallbackArray<T>(text: string): T[] {
  const cleaned = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Source fallback did not return a JSON array");
  const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(parsed) || parsed.some((row) => row === null || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("Source fallback returned an invalid project array");
  }
  return parsed as T[];
}
