import { firecrawlContentHash } from "./firecrawl.ts";
import { getSourceAcquisitionPlan, getSourceRepairStrategy } from "./source-repair-strategies.ts";

const APIFY_ENDPOINT = "https://api.apify.com/v2/acts/apify~website-content-crawler/run-sync-get-dataset-items?timeout=45&memory=512";
const APIFY_TIMEOUT_MS = 50_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface ApifySourcePage {
  requestedUrl: string;
  finalUrl: string;
  title: string | null;
  content: string;
  contentHash: string;
}

export function apifySourceConfigured(environment: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(environment.APIFY_API_TOKEN?.trim());
}

function validateUrl(sourceName: string, value: string): string {
  const strategy = getSourceRepairStrategy(sourceName);
  const hosts = new Set(strategy.officialUrls.map((url) => new URL(url).hostname));
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error("Apify returned an invalid source URL"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || !hosts.has(parsed.hostname)) {
    throw new Error("Apify URL is outside the approved source hostname boundary");
  }
  return parsed.href;
}

async function readLimited(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Apify returned no response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error("Apify response exceeded the size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Apify returned malformed JSON"); }
}

/** Bounded secondary acquisition after Firecrawl, never a source discovery API. */
export async function fetchApprovedSourceWithApify(
  sourceName: string,
  requestedUrl: string,
  options: { environment?: NodeJS.ProcessEnv; fetcher?: typeof fetch } = {},
): Promise<ApifySourcePage[]> {
  const plan = getSourceAcquisitionPlan(sourceName);
  if (!plan.methods.includes("apify")) throw new Error("Apify is not allowed for this approved source");
  const url = validateUrl(sourceName, requestedUrl);
  const token = (options.environment ?? process.env).APIFY_API_TOKEN?.trim();
  if (!token) throw new Error("APIFY_API_TOKEN is not configured");
  const maxPages = Math.min(3, Math.max(1, plan.maxFirecrawlPages ?? 1));
  const response = await (options.fetcher ?? fetch)(APIFY_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      startUrls: [{ url }],
      crawlerType: "playwright:adaptive",
      maxCrawlPages: maxPages,
      maxCrawlDepth: Math.min(1, Math.max(0, plan.maxFirecrawlDepth ?? 0)),
      useSitemaps: false,
      useLlmsTxt: false,
      respectRobotsTxtFile: true,
      blockMedia: true,
      storeSkippedUrls: false,
      summarize: false,
      proxyConfiguration: { useApifyProxy: true },
    }),
    signal: AbortSignal.timeout(APIFY_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Apify source request failed with HTTP ${response.status}`);
  const body = await readLimited(response);
  if (!Array.isArray(body)) throw new Error("Apify source response is not a dataset array");
  const pages = body.slice(0, maxPages).map((item): ApifySourcePage | null => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const content = (typeof row.markdown === "string" ? row.markdown
      : typeof row.text === "string" ? row.text : "").slice(0, 1024 * 1024).trim();
    if (!content) return null;
    const finalUrl = validateUrl(sourceName, typeof row.url === "string" ? row.url : url);
    return {
      requestedUrl: url, finalUrl,
      title: typeof row.title === "string" ? row.title : null,
      content, contentHash: firecrawlContentHash(content),
    };
  }).filter((page): page is ApifySourcePage => Boolean(page));
  if (!pages.length) throw new Error("Apify returned no usable source content");
  return pages;
}
