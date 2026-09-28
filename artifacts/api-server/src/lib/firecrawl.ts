import { createHash } from "node:crypto";
import { getSourceAcquisitionPlan, getSourceRepairStrategy } from "./source-repair-strategies.ts";

const FIRECRAWL_API_ORIGIN = "https://api.firecrawl.dev";
const FIRECRAWL_API_VERSION = "v2";
const REQUEST_TIMEOUT_MS = 35_000;
const CRAWL_TOTAL_BUDGET_MS = 55_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CONTENT_BYTES = 1024 * 1024;
const MAX_LINKS = 100;
const PROVIDER_CACHE_MAX_AGE_MS = 60 * 60 * 1000;
const MEMORY_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CONCURRENCY = 2;
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 0;

// RUN-0118 recorded two simultaneous Firecrawl 429 responses for separate,
// approved NZ EPA endpoints. Keep those public pages within the existing
// provider and source bounds, but never start two of them at once. This is a
// targeted pacing control, not a retry or an access-control bypass.
const NZ_EPA_SOURCE_NAMES = new Set([
  "NZ EPA – Fast-track Projects",
  "NZ EPA – RMA Proposals",
  "NZ EPA – Public Consultations",
]);

export type FirecrawlFailureCategory =
  | "missing-credentials"
  | "auth-failed"
  | "blocked"
  | "rate-limited"
  | "timeout"
  | "provider-error"
  | "malformed-response"
  | "empty-content"
  | "unsafe-final-url";

export class FirecrawlAcquisitionError extends Error {
  readonly category: FirecrawlFailureCategory;
  readonly status?: number;

  constructor(
    category: FirecrawlFailureCategory,
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "FirecrawlAcquisitionError";
    this.category = category;
    this.status = status;
  }
}

export interface FirecrawlPage {
  requestedUrl: string;
  finalUrl: string;
  title: string | null;
  content: string;
  links: string[];
  metadata: Record<string, unknown>;
  statusCode: number | null;
  contentHash: string;
}

export interface FirecrawlAcquisitionResult {
  provider: "firecrawl";
  apiVersion: "v2";
  mode: "scrape" | "crawl";
  status: "success";
  requestedUrl: string;
  pages: FirecrawlPage[];
  pagesFetched: number;
  durationMs: number;
  cacheReuse: boolean;
}

export interface FirecrawlRequestOptions {
  environment?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  bypassMemoryCache?: boolean;
}

export interface FirecrawlContactResult {
  content: string;
  finalUrl: string;
  contentHash: string;
  cacheReuse: boolean;
}

interface CachedResult {
  expiresAt: number;
  result: FirecrawlAcquisitionResult;
}

const resultCache = new Map<string, CachedResult>();
const inFlight = new Map<string, Promise<FirecrawlAcquisitionResult>>();
const sourceHostTails = new Map<string, Promise<void>>();
let providerRequestTail: Promise<void> = Promise.resolve();
let providerNotBeforeMs = 0;
let activeRequests = 0;
const waiters: Array<() => void> = [];

async function withConcurrency<T>(operation: () => Promise<T>): Promise<T> {
  if (activeRequests >= MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  activeRequests++;
  try {
    return await operation();
  } finally {
    activeRequests--;
    waiters.shift()?.();
  }
}

async function withSourceHostPacing<T>(
  sourceName: string,
  url: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!NZ_EPA_SOURCE_NAMES.has(sourceName)) return operation();

  const host = new URL(url).hostname;
  const previous = sourceHostTails.get(host) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  sourceHostTails.set(host, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (sourceHostTails.get(host) === tail) sourceHostTails.delete(host);
  }
}

/**
 * Firecrawl's HTTP 429 describes the API plan/account's rate or concurrency
 * limit, not necessarily the target website. Dispatch pacing is therefore
 * global to this process. Operators may configure a small minimum interval
 * once their plan's documented limit is known; zero preserves current timing.
 */
export function firecrawlMinimumRequestIntervalMs(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const value = environment.FIRECRAWL_MIN_REQUEST_INTERVAL_MS?.trim();
  if (!value) return DEFAULT_MIN_REQUEST_INTERVAL_MS;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_MIN_REQUEST_INTERVAL_MS;
}

function retryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1_000) : null;
}

async function waitForProviderRequestSlot(
  now: () => number,
  sleep: (ms: number) => Promise<void>,
  minimumIntervalMs: number,
): Promise<void> {
  const previous = providerRequestTail;
  let release!: () => void;
  providerRequestTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const waitMs = Math.max(0, providerNotBeforeMs - now());
    if (waitMs) await sleep(waitMs);
    providerNotBeforeMs = Math.max(providerNotBeforeMs, now() + minimumIntervalMs);
  } finally {
    release();
  }
}

export function clearFirecrawlMemoryCacheForTests(): void {
  resultCache.clear();
  inFlight.clear();
  sourceHostTails.clear();
  providerRequestTail = Promise.resolve();
  providerNotBeforeMs = 0;
}

export function firecrawlConfigured(environment: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(environment.FIRECRAWL_API_KEY?.trim());
}

export function firecrawlContentHash(content: string): string {
  const normalized = content
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
}

function approvedHosts(sourceName: string): Set<string> {
  return new Set(getSourceRepairStrategy(sourceName).officialUrls.map((url) => new URL(url).hostname));
}

function validateApprovedUrl(sourceName: string, value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new FirecrawlAcquisitionError("unsafe-final-url", "Firecrawl URL is invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port ||
      !approvedHosts(sourceName).has(parsed.hostname)) {
    throw new FirecrawlAcquisitionError(
      "unsafe-final-url",
      "Firecrawl URL is outside the approved source hostname boundary",
    );
  }
  return parsed;
}

function safeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const allowed = [
    "title", "description", "sourceURL", "url", "statusCode", "error",
    "contentType", "cacheState", "creditsUsed", "proxyUsed", "scrapeId",
  ];
  return Object.fromEntries(allowed.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
}

function classifyHttpFailure(status: number): FirecrawlFailureCategory {
  if (status === 401 || status === 403) return status === 401 ? "auth-failed" : "blocked";
  if (status === 429) return "rate-limited";
  if (status === 408 || status === 504) return "timeout";
  return "provider-error";
}

async function readLimitedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new FirecrawlAcquisitionError("malformed-response", "Firecrawl returned no response body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        throw new FirecrawlAcquisitionError("provider-error", "Firecrawl response exceeded the size limit");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new FirecrawlAcquisitionError("malformed-response", "Firecrawl returned malformed JSON");
  }
}

async function providerRequest(
  path: string,
  init: RequestInit,
  key: string,
  fetcher: typeof fetch,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
  minimumIntervalMs: number,
): Promise<unknown> {
  let response: Response;
  try {
    await waitForProviderRequestSlot(now, sleep, minimumIntervalMs);
    response = await fetcher(`${FIRECRAWL_API_ORIGIN}/${FIRECRAWL_API_VERSION}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    throw new FirecrawlAcquisitionError(timeout ? "timeout" : "provider-error", timeout
      ? "Firecrawl request timed out" : "Firecrawl network request failed");
  }
  const body = await readLimitedJson(response);
  if (!response.ok) {
    if (response.status === 429) {
      const delayMs = retryAfterMs(response.headers.get("Retry-After"));
      if (delayMs !== null) providerNotBeforeMs = Math.max(providerNotBeforeMs, now() + delayMs);
    }
    throw new FirecrawlAcquisitionError(
      classifyHttpFailure(response.status),
      `Firecrawl request failed with HTTP ${response.status}`,
      response.status,
    );
  }
  return body;
}

function normalizePage(sourceName: string, requestedUrl: string, value: unknown): FirecrawlPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FirecrawlAcquisitionError("malformed-response", "Firecrawl page payload is invalid");
  }
  const document = value as Record<string, unknown>;
  const metadata = safeMetadata(document.metadata);
  const statusCode = typeof metadata.statusCode === "number" ? metadata.statusCode : null;
  if (statusCode && statusCode >= 400) {
    throw new FirecrawlAcquisitionError(classifyHttpFailure(statusCode), `Firecrawl target returned HTTP ${statusCode}`, statusCode);
  }
  const finalValue = typeof metadata.url === "string" ? metadata.url
    : typeof metadata.sourceURL === "string" ? metadata.sourceURL : requestedUrl;
  const finalUrl = validateApprovedUrl(sourceName, finalValue).href;
  const markdown = typeof document.markdown === "string" ? document.markdown : "";
  const html = typeof document.html === "string" ? document.html : "";
  const content = (markdown || html).slice(0, MAX_CONTENT_BYTES).trim();
  if (!content) throw new FirecrawlAcquisitionError("empty-content", "Firecrawl returned empty content");
  const rawLinks = Array.isArray(document.links) ? document.links : [];
  const links = rawLinks.flatMap((link) => {
    if (typeof link !== "string") return [];
    try { return [validateApprovedUrl(sourceName, new URL(link, finalUrl).href).href]; }
    catch { return []; }
  }).filter((link, index, all) => all.indexOf(link) === index).slice(0, MAX_LINKS);
  return {
    requestedUrl,
    finalUrl,
    title: typeof metadata.title === "string" ? metadata.title : null,
    content,
    links,
    metadata,
    statusCode,
    contentHash: firecrawlContentHash(content),
  };
}

function unwrapScrapeData(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new FirecrawlAcquisitionError("malformed-response", "Firecrawl response is invalid");
  }
  const record = body as Record<string, unknown>;
  if (record.success !== true || !record.data) {
    throw new FirecrawlAcquisitionError("provider-error", "Firecrawl response did not report success");
  }
  return record.data;
}

function cacheKey(sourceName: string, url: string, mode: "scrape" | "crawl", pages: number, depth: number): string {
  return JSON.stringify({ sourceName, url, mode, pages, depth, version: FIRECRAWL_API_VERSION });
}

async function cachedOperation(
  key: string,
  now: () => number,
  bypass: boolean,
  operation: () => Promise<FirecrawlAcquisitionResult>,
): Promise<FirecrawlAcquisitionResult> {
  if (!bypass) {
    const cached = resultCache.get(key);
    if (cached && cached.expiresAt > now()) return { ...cached.result, cacheReuse: true };
    const pending = inFlight.get(key);
    if (pending) return { ...(await pending), cacheReuse: true };
  }
  const promise = withConcurrency(operation);
  inFlight.set(key, promise);
  try {
    const result = await promise;
    resultCache.set(key, { result, expiresAt: now() + MEMORY_CACHE_TTL_MS });
    return result;
  } finally {
    inFlight.delete(key);
  }
}

export async function firecrawlScrapeApprovedSource(
  sourceName: string,
  requestedUrl: string,
  options: FirecrawlRequestOptions = {},
): Promise<FirecrawlAcquisitionResult> {
  const plan = getSourceAcquisitionPlan(sourceName);
  if (!plan.methods.includes("firecrawl")) {
    throw new FirecrawlAcquisitionError("blocked", "Firecrawl is not allowed for this approved source");
  }
  const url = validateApprovedUrl(sourceName, requestedUrl).href;
  const environment = options.environment ?? process.env;
  const key = environment.FIRECRAWL_API_KEY?.trim();
  if (!key) throw new FirecrawlAcquisitionError("missing-credentials", "FIRECRAWL_API_KEY is not configured");
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const minimumIntervalMs = firecrawlMinimumRequestIntervalMs(environment);
  const id = cacheKey(sourceName, url, "scrape", 1, 0);
  return withSourceHostPacing(sourceName, url, () => cachedOperation(id, now, options.bypassMemoryCache ?? false, async () => {
    const started = now();
    const body = await providerRequest("/scrape", {
      method: "POST",
      body: JSON.stringify({
        url,
        formats: ["markdown", "links"],
        onlyMainContent: true,
        maxAge: PROVIDER_CACHE_MAX_AGE_MS,
        storeInCache: true,
        timeout: 30_000,
      }),
    }, key, options.fetcher ?? fetch, now, sleep, minimumIntervalMs);
    const page = normalizePage(sourceName, url, unwrapScrapeData(body));
    return {
      provider: "firecrawl", apiVersion: "v2", mode: "scrape", status: "success",
      requestedUrl: url, pages: [page], pagesFetched: 1,
      durationMs: Math.max(0, now() - started), cacheReuse: page.metadata.cacheState === "hit",
    };
  }));
}

export async function firecrawlCrawlApprovedSource(
  sourceName: string,
  requestedUrl: string,
  options: FirecrawlRequestOptions = {},
): Promise<FirecrawlAcquisitionResult> {
  const plan = getSourceAcquisitionPlan(sourceName);
  if (!plan.methods.includes("firecrawl") || plan.firecrawlMode !== "crawl") {
    throw new FirecrawlAcquisitionError("blocked", "Firecrawl crawl is not allowed for this approved source");
  }
  const url = validateApprovedUrl(sourceName, requestedUrl).href;
  const pages = Math.min(3, Math.max(1, plan.maxFirecrawlPages ?? 1));
  const depth = Math.min(1, Math.max(0, plan.maxFirecrawlDepth ?? 0));
  const environment = options.environment ?? process.env;
  const key = environment.FIRECRAWL_API_KEY?.trim();
  if (!key) throw new FirecrawlAcquisitionError("missing-credentials", "FIRECRAWL_API_KEY is not configured");
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const minimumIntervalMs = firecrawlMinimumRequestIntervalMs(environment);
  const id = cacheKey(sourceName, url, "crawl", pages, depth);
  return withSourceHostPacing(sourceName, url, () => cachedOperation(id, now, options.bypassMemoryCache ?? false, async () => {
    const started = now();
    const submitted = await providerRequest("/crawl", {
      method: "POST",
      body: JSON.stringify({
        url,
        limit: pages,
        maxDiscoveryDepth: depth,
        sitemap: "skip",
        ignoreQueryParameters: true,
        allowExternalLinks: false,
        allowSubdomains: false,
        crawlEntireDomain: false,
        maxConcurrency: 1,
        scrapeOptions: {
          formats: ["markdown", "links"], onlyMainContent: true,
          maxAge: PROVIDER_CACHE_MAX_AGE_MS, storeInCache: true, timeout: 30_000,
        },
      }),
    }, key, options.fetcher ?? fetch, now, sleep, minimumIntervalMs) as Record<string, unknown>;
    const jobId = typeof submitted.id === "string" ? submitted.id : null;
    if (submitted.success !== true || !jobId || !/^[a-zA-Z0-9_-]{1,200}$/.test(jobId)) {
      throw new FirecrawlAcquisitionError("malformed-response", "Firecrawl crawl response has no valid job ID");
    }
    while (now() - started < CRAWL_TOTAL_BUDGET_MS) {
      await sleep(500);
      const polled = await providerRequest(
        `/crawl/${jobId}`,
        { method: "GET" },
        key,
        options.fetcher ?? fetch,
        now,
        sleep,
        minimumIntervalMs,
      ) as Record<string, unknown>;
      if (polled.status === "failed" || polled.success === false) {
        throw new FirecrawlAcquisitionError("provider-error", "Firecrawl crawl job failed");
      }
      if (polled.status !== "completed") continue;
      const rawPages = Array.isArray(polled.data) ? polled.data.slice(0, pages) : [];
      if (!rawPages.length) throw new FirecrawlAcquisitionError("empty-content", "Firecrawl crawl returned no pages");
      const normalized = rawPages.map((page) => normalizePage(sourceName, url, page));
      return {
        provider: "firecrawl", apiVersion: "v2", mode: "crawl", status: "success",
        requestedUrl: url, pages: normalized, pagesFetched: normalized.length,
        durationMs: Math.max(0, now() - started),
        cacheReuse: normalized.every((page) => page.metadata.cacheState === "hit"),
      };
    }
    throw new FirecrawlAcquisitionError("timeout", "Firecrawl crawl exceeded the total source budget");
  }));
}

export async function acquireApprovedSourceWithFirecrawl(
  sourceName: string,
  requestedUrl: string,
  options: FirecrawlRequestOptions = {},
): Promise<FirecrawlAcquisitionResult> {
  const plan = getSourceAcquisitionPlan(sourceName);
  return plan.firecrawlMode === "crawl"
    ? firecrawlCrawlApprovedSource(sourceName, requestedUrl, options)
    : firecrawlScrapeApprovedSource(sourceName, requestedUrl, options);
}

/**
 * Bounded fallback for an already-approved official developer hostname.
 * This deliberately does not discover or broaden domains and does not enable
 * Firecrawl AI extraction, screenshots, crawl, or external links.
 */
export async function firecrawlScrapeDeveloperContactPage(
  requestedUrl: string,
  approvedHostname: string,
  options: FirecrawlRequestOptions = {},
): Promise<FirecrawlContactResult> {
  const parsed = new URL(requestedUrl);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port ||
      parsed.hostname.toLowerCase() !== approvedHostname.toLowerCase()) {
    throw new FirecrawlAcquisitionError("unsafe-final-url", "Developer contact URL is outside the approved hostname");
  }
  const environment = options.environment ?? process.env;
  const key = environment.FIRECRAWL_API_KEY?.trim();
  if (!key) throw new FirecrawlAcquisitionError("missing-credentials", "FIRECRAWL_API_KEY is not configured");
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const body = await providerRequest("/scrape", {
    method: "POST",
    body: JSON.stringify({
      url: parsed.href,
      formats: ["markdown"],
      onlyMainContent: true,
      maxAge: PROVIDER_CACHE_MAX_AGE_MS,
      storeInCache: true,
      timeout: 20_000,
    }),
  }, key, options.fetcher ?? fetch, now, sleep, firecrawlMinimumRequestIntervalMs(environment));
  const raw = unwrapScrapeData(body);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new FirecrawlAcquisitionError("malformed-response", "Firecrawl contact response is invalid");
  const record = raw as Record<string, unknown>;
  const metadata = safeMetadata(record.metadata);
  const finalValue = typeof metadata.url === "string" ? metadata.url : typeof metadata.sourceURL === "string" ? metadata.sourceURL : parsed.href;
  const finalUrl = new URL(finalValue, parsed).href;
  const final = new URL(finalUrl);
  if (final.protocol !== "https:" || final.username || final.password || final.port || final.hostname.toLowerCase() !== approvedHostname.toLowerCase()) {
    throw new FirecrawlAcquisitionError("unsafe-final-url", "Firecrawl redirected outside the approved developer hostname");
  }
  const content = (typeof record.markdown === "string" ? record.markdown : "").slice(0, MAX_CONTENT_BYTES).trim();
  if (!content) throw new FirecrawlAcquisitionError("empty-content", "Firecrawl returned empty developer contact content");
  return { content, finalUrl, contentHash: firecrawlContentHash(content), cacheReuse: metadata.cacheState === "hit" };
}

export const FIRECRAWL_INTEGRATION_LIMITS = Object.freeze({
  apiVersion: FIRECRAWL_API_VERSION,
  maxPages: 3,
  maxDepth: 1,
  maxConcurrency: MAX_CONCURRENCY,
  maxContentBytes: MAX_CONTENT_BYTES,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
  totalCrawlBudgetMs: CRAWL_TOTAL_BUDGET_MS,
});
