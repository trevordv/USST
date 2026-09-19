import { SOURCE_REPAIR_STRATEGIES, type SourceRepairStrategy } from "./source-repair-strategies.ts";
import type { ExtractionAttempt } from "./source-extraction-outcome.ts";
import { classifySourceResponse } from "./source-repair-parsers.ts";

const BRIGHT_DATA_ENDPOINT = "https://api.brightdata.com/request";
const BRIGHT_DATA_TIMEOUT_MS = 30_000;
const HTML_LIMIT_BYTES = 2 * 1024 * 1024;

export interface BrightDataTarget {
  url: string;
  format: "rss" | "html" | "structured-html";
}

export function brightDataConfigured(environment: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(environment.BRIGHT_DATA_API_KEY?.trim() && environment.BRIGHT_DATA_ZONE?.trim());
}

/** Only previously approved official paths may be retried through the provider. */
export function planBrightDataTargets(
  strategy: SourceRepairStrategy,
  attempts: readonly ExtractionAttempt[],
): BrightDataTarget[] {
  if (strategy.auditGroup === "inaccessible" || strategy.mode === "authenticated" ||
      strategy.mode === "epbc-arcgis" || strategy.mode === "aemo-workbook") return [];
  const successfullyParsedUrls = new Set(attempts.filter((attempt) =>
    attempt.outcome === "success-with-results" || attempt.outcome === "success-zero-results",
  ).map((attempt) => attempt.url));
  const failed = attempts.filter((attempt) =>
    (attempt.outcome === "fetch-failed" && (attempt.failureCategory === "network" || attempt.failureCategory === "timeout")) ||
    (attempt.outcome === "fetch-failed" && attempt.failureCategory === "public-access-block" && strategy.auditGroup === "extraction-problematic") ||
    (attempt.outcome === "content-unusable" && (attempt.failureCategory === "invalid-content" || attempt.failureCategory === "parser")) ||
    (attempt.outcome === "parse-failed" && attempt.failureCategory === "parser") ||
    (attempt.outcome === "requires-js-or-ai-repair" && attempt.method !== "openai-first"),
  );
  if (!failed.length) return [];

  const urls = failed.map((attempt) => attempt.url).filter((url): url is string => Boolean(url));
  const unique = new Set(urls);
  return [...unique].filter((url) => strategy.officialUrls.includes(url) && !successfullyParsedUrls.has(url)).slice(0, 2).map((url) => ({
    url,
    format: strategy.mode === "structured-html" || strategy.mode === "openai-first"
        ? "structured-html"
        : /\/feed\/?(?:\?|$)/i.test(new URL(url).pathname) ? "rss" : "html",
  }));
}

async function readLimitedBody(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) throw new Error("Bright Data returned no response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error("Bright Data response exceeded the size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks);
}

export async function fetchApprovedBrightData(
  sourceName: string,
  target: BrightDataTarget,
  options: { environment?: NodeJS.ProcessEnv; fetcher?: typeof fetch } = {},
): Promise<Buffer> {
  const strategy = SOURCE_REPAIR_STRATEGIES.find((item) => item.name === sourceName);
  const parsed = new URL(target.url);
  if (!strategy || strategy.auditGroup === "inaccessible" || strategy.mode === "authenticated" ||
      strategy.mode === "epbc-arcgis" || strategy.mode === "aemo-workbook" ||
      parsed.protocol !== "https:" || parsed.username || parsed.password ||
      !strategy.officialUrls.includes(target.url)) {
    throw new Error("Bright Data target is not an approved public source URL");
  }
  const environment = options.environment ?? process.env;
  const key = environment.BRIGHT_DATA_API_KEY?.trim();
  const zone = environment.BRIGHT_DATA_ZONE?.trim();
  if (!key || !zone) throw new Error("Bright Data API key and zone must both be configured");
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(zone)) throw new Error("Bright Data zone name is invalid");

  const response = await (options.fetcher ?? fetch)(BRIGHT_DATA_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ zone, url: target.url, format: "raw", method: "GET" }),
    signal: AbortSignal.timeout(BRIGHT_DATA_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Bright Data request failed with HTTP ${response.status}`);
  const body = await readLimitedBody(response, HTML_LIMIT_BYTES);
  const problem = classifySourceResponse(200, response.headers.get("content-type") ?? "text/html", body.toString("utf8"));
  if (problem) throw new Error(`Bright Data returned unusable source content: ${problem}`);
  return body;
}
