import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { logger as defaultLogger } from "./logger.ts";

const BRAVE_WEB_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_RESULT_COUNT = 5;
const MAX_RESULT_COUNT = 10;
const MAX_QUERY_LENGTH = 300;
const DEFAULT_TIMEOUT_MS = 7_500;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

export type BraveSearchPurpose =
  | "developer_website_discovery"
  | "project_corroboration"
  | "contact_research";

export interface BraveSearchProvenance {
  purpose: BraveSearchPurpose;
  queryHash: string;
  searchedAt: string;
}

export interface BraveSearchResult {
  title: string;
  url: string;
  description: string | null;
  source: string;
  age: string | null;
  provenance: BraveSearchProvenance;
}

export interface BraveWebSearchInput {
  query: string;
  country?: "AU" | "NZ";
  count?: number;
  purpose?: BraveSearchPurpose;
}

interface BraveSearchDependencies {
  environment?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  logger?: Pick<typeof defaultLogger, "info" | "warn">;
  now?: () => number;
  timeoutMs?: number;
}

interface CachedSearch {
  expiresAt: number;
  results: Array<Omit<BraveSearchResult, "provenance">>;
}

const cache = new Map<string, CachedSearch>();
const inFlight = new Map<string, Promise<Array<Omit<BraveSearchResult, "provenance">>>>();
let missingKeyLogged = false;

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

function safeQueryHash(normalizedQuery: string): string {
  return createHash("sha256").update(normalizedQuery.toLowerCase()).digest("hex").slice(0, 16);
}

function boundedCount(count: number | undefined): number {
  if (count == null || !Number.isFinite(count)) return DEFAULT_RESULT_COUNT;
  return Math.min(MAX_RESULT_COUNT, Math.max(1, Math.trunc(count)));
}

function isSafePublicResultUrl(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== "string") return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    if (parsed.username || parsed.password) return false;
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (hostname === "localhost" || hostname.endsWith(".local")) return false;
    const ipVersion = isIP(hostname);
    if (ipVersion === 4) {
      const octets = hostname.split(".").map(Number);
      if (
        octets[0] === 10 || octets[0] === 127 || octets[0] === 0 ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && (octets[1] === 0 || octets[1] === 168)) ||
        (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19 || octets[1] === 51)) ||
        (octets[0] === 203 && octets[1] === 0 && octets[2] === 113) ||
        octets[0] >= 224
      ) return false;
    }
    if (ipVersion === 6 && (
      hostname === "::" || hostname === "::1" || hostname.startsWith("fc") ||
      hostname.startsWith("fd") || /^fe[89ab]/.test(hostname) || hostname.startsWith("2001:db8")
    )) return false;
    return true;
  } catch {
    return false;
  }
}

function normalizeResponse(payload: unknown, count: number): Array<Omit<BraveSearchResult, "provenance">> {
  if (!payload || typeof payload !== "object") return [];
  const web = (payload as { web?: unknown }).web;
  if (!web || typeof web !== "object") return [];
  const rawResults = (web as { results?: unknown }).results;
  if (!Array.isArray(rawResults)) return [];

  const normalized: Array<Omit<BraveSearchResult, "provenance">> = [];
  for (const raw of rawResults) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (!isSafePublicResultUrl(item.url) || typeof item.title !== "string" || !item.title.trim()) continue;
    const parsedUrl = new URL(item.url);
    normalized.push({
      title: item.title.trim().slice(0, 300),
      url: parsedUrl.toString(),
      description: typeof item.description === "string" ? item.description.trim().slice(0, 1_000) || null : null,
      source: parsedUrl.hostname.replace(/^www\./, "").toLowerCase(),
      age: typeof item.age === "string" ? item.age.trim().slice(0, 100) || null : null,
    });
    if (normalized.length >= count) break;
  }
  return normalized;
}

function pruneCache(now: number): void {
  for (const [key, value] of cache) {
    if (value.expiresAt <= now) cache.delete(key);
  }
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

export async function braveWebSearch(
  input: BraveWebSearchInput,
  dependencies: BraveSearchDependencies = {},
): Promise<BraveSearchResult[]> {
  const environment = dependencies.environment ?? process.env;
  const log = dependencies.logger ?? defaultLogger;
  const now = dependencies.now ?? Date.now;
  const normalizedQuery = normalizeQuery(input.query);
  const country = input.country ?? "AU";
  const count = boundedCount(input.count);
  const purpose = input.purpose ?? "project_corroboration";
  const queryHash = safeQueryHash(normalizedQuery);

  if (!normalizedQuery || normalizedQuery.length > MAX_QUERY_LENGTH) {
    log.warn({ purpose, country, queryHash, outcome: "invalid-query" }, "Brave Search integration outcome");
    return [];
  }

  const apiKey = environment.BRAVE_SEARCH_API_KEY?.trim();
  if (!apiKey) {
    if (!missingKeyLogged) {
      log.warn({ outcome: "skipped-missing-credentials", missing: ["BRAVE_SEARCH_API_KEY"] }, "Brave Search integration unavailable");
      missingKeyLogged = true;
    }
    return [];
  }

  const cacheKey = `${country}:${count}:${normalizedQuery.toLowerCase()}`;
  const timestamp = now();
  pruneCache(timestamp);
  const cached = cache.get(cacheKey);
  const provenance = (): BraveSearchProvenance => ({
    purpose,
    queryHash,
    searchedAt: new Date(now()).toISOString(),
  });
  if (cached && cached.expiresAt > timestamp) {
    log.info({ purpose, country, queryHash, resultCount: cached.results.length, cacheHit: true }, "Brave Search usage");
    return cached.results.map((result) => ({ ...result, provenance: provenance() }));
  }

  let request = inFlight.get(cacheKey);
  const duplicateSuppressed = Boolean(request);
  if (!request) {
    request = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const startedAt = now();
      try {
        const url = new URL(BRAVE_WEB_SEARCH_URL);
        url.searchParams.set("q", normalizedQuery);
        url.searchParams.set("country", country);
        url.searchParams.set("search_lang", "en");
        url.searchParams.set("count", String(count));
        const response = await (dependencies.fetchImpl ?? fetch)(url, {
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": apiKey,
          },
        });
        if (!response.ok) {
          const outcome = response.status === 401 || response.status === 403
            ? "invalid-credentials"
            : response.status === 429
              ? "rate-limited"
              : response.status >= 500 ? "upstream-error" : "http-error";
          log.warn({ purpose, country, queryHash, status: response.status, outcome }, "Brave Search integration outcome");
          return [];
        }
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          log.warn({ purpose, country, queryHash, outcome: "malformed-response" }, "Brave Search integration outcome");
          return [];
        }
        const webResults = payload && typeof payload === "object"
          ? (payload as { web?: { results?: unknown } }).web?.results
          : null;
        if (!Array.isArray(webResults)) {
          log.warn({ purpose, country, queryHash, outcome: "malformed-response" }, "Brave Search integration outcome");
          return [];
        }
        const results = normalizeResponse(payload, count);
        cache.set(cacheKey, { expiresAt: now() + CACHE_TTL_MS, results });
        log.info({
          purpose,
          country,
          queryHash,
          requestedCount: count,
          resultCount: results.length,
          durationMs: Math.max(0, now() - startedAt),
          cacheHit: false,
        }, "Brave Search usage");
        return results;
      } catch (error) {
        const outcome = error instanceof Error && error.name === "AbortError" ? "timeout" : "network-error";
        log.warn({ purpose, country, queryHash, outcome }, "Brave Search integration outcome");
        return [];
      } finally {
        clearTimeout(timer);
      }
    })();
    inFlight.set(cacheKey, request);
  }

  try {
    const results = await request;
    if (duplicateSuppressed) {
      log.info({ purpose, country, queryHash, resultCount: results.length, duplicateSuppressed: true }, "Brave Search usage");
    }
    return results.map((result) => ({ ...result, provenance: provenance() }));
  } finally {
    if (inFlight.get(cacheKey) === request) inFlight.delete(cacheKey);
  }
}

export function resetBraveSearchStateForTests(): void {
  cache.clear();
  inFlight.clear();
  missingKeyLogged = false;
}
