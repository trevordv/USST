import { createHash } from "node:crypto";

// Bumped when the source fingerprint changed from raw bytes to meaningful content.
export const AI_SOURCE_CACHE_VERSION = 2;
export function hashSourceContent(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const SENSITIVE_JSON_KEY = /(?:authorization|auth|cookie|credential|csrf|nonce|password|secret|session|signature|token)/i;

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !SENSITIVE_JSON_KEY.test(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonicalJson(child)]));
}

function decodeTextEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (_, name: string) => ({
      nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    })[name.toLowerCase()] ?? " ");
}

function normaliseLink(raw: string): string | undefined {
  const decoded = decodeTextEntities(raw).trim();
  if (!decoded || /^(?:data|javascript|mailto|tel):/i.test(decoded)) return undefined;
  try {
    const url = new URL(decoded, "https://source.invalid/");
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_JSON_KEY.test(key) || /^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.origin === "https://source.invalid" ? `${url.pathname}${url.search}` : url.href;
  } catch {
    return decoded.replace(/\s+/g, " ");
  }
}

/**
 * Produce a deliberately small source fingerprint surface: canonical JSON, or
 * visible document text plus meaningful links and JSON-LD. Formatting, comments,
 * styles, executable scripts and tracking parameters cannot cause paid rework.
 * Authentication headers/cookies are never inputs, and common secret-bearing
 * JSON keys and HTML metadata/form controls are discarded defensively.
 */
export function normaliseSourceContent(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[\[{]/.test(trimmed)) {
    try { return JSON.stringify(canonicalJson(JSON.parse(trimmed))); } catch { /* document text */ }
  }

  const jsonLd: string[] = [];
  let document = trimmed.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
    (_tag, attributes: string, body: string) => {
      if (/\btype\s*=\s*["']application\/ld\+json["']/i.test(attributes)) {
        try { jsonLd.push(JSON.stringify(canonicalJson(JSON.parse(body)))); } catch { /* ignore malformed metadata */ }
      }
      return " ";
    });
  const links = [...document.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)]
    .map(match => normaliseLink(match[1])).filter((link): link is string => Boolean(link));
  document = document
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/(?:style|noscript|template|svg)\s*>/gi, " ")
    .replace(/<(?:meta|input)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const visible = decodeTextEntities(document).normalize("NFKC").replace(/\s+/g, " ").trim();
  return JSON.stringify({ text: visible, links, jsonLd });
}

export function hashMeaningfulSourceContent(value: string): string {
  return hashSourceContent(normaliseSourceContent(value));
}

export interface AiSourceCacheIdentity {
  sourceName: string;
  sourceUrl: string;
  contentHash: string;
  startDate?: string;
  endDate?: string;
  model: string;
  promptHash: string;
  /** False when acquisition failed before any source body could be observed. */
  contentObserved?: boolean;
  version?: number;
}

export function aiSourceCacheKey(input: AiSourceCacheIdentity): string {
  return hashSourceContent(JSON.stringify([
    input.version ?? AI_SOURCE_CACHE_VERSION, input.sourceName, input.sourceUrl,
    input.contentHash, input.startDate ?? null, input.endDate ?? null,
    input.model, input.promptHash,
  ]));
}

export interface CacheClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(error?: Error | boolean): void;
}
export interface CachePool { connect(): Promise<CacheClient> }
type CacheLogger = (event: string, fields: Record<string, unknown>) => void;

/** Cache raw AI arrays, including [], and revalidate them on every read.
 * Transaction locks work with Supabase transaction pooling and serialize callers
 * across API processes. No failure is saved as a successful empty extraction.
 */
export async function cachedSourceFallback<T>(
  pool: CachePool,
  identity: AiSourceCacheIdentity,
  load: () => Promise<T[]>,
  validate: (value: unknown) => T[],
  log: CacheLogger,
): Promise<T[]> {
  const cacheKey = aiSourceCacheKey(identity);
  const fields = { cacheKey, source: identity.sourceName, model: identity.model };
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '120s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [cacheKey]);
    const hit = await client.query(
      "SELECT result_json FROM public.ai_source_fallback_cache WHERE cache_key = $1 AND expires_at > clock_timestamp()",
      [cacheKey],
    );
    if (hit.rows.length) {
      const results = validate(hit.rows[0].result_json);
      await client.query("UPDATE public.ai_source_fallback_cache SET last_used_at = clock_timestamp() WHERE cache_key = $1", [cacheKey]);
      await client.query("COMMIT");
      log("ai_source_cache_hit", { ...fields, resultCount: results.length });
      if (results.length === 0) log("ai_source_cache_empty_result", { ...fields, cached: true, resultCount: 0 });
      return results;
    }
    log("ai_source_cache_miss", fields);
    const results = validate(await load());
    await client.query(`INSERT INTO public.ai_source_fallback_cache
      (cache_key, source_name, source_url, content_hash, start_date, end_date, model,
       prompt_hash, cache_version, result_json, result_count, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,
        CASE WHEN $12 THEN 'infinity'::timestamptz ELSE clock_timestamp() + interval '6 hours' END)
      ON CONFLICT (cache_key) DO UPDATE SET result_json = EXCLUDED.result_json,
        result_count = EXCLUDED.result_count, created_at = clock_timestamp(),
        last_used_at = clock_timestamp(), expires_at = EXCLUDED.expires_at`,
    [cacheKey, identity.sourceName, identity.sourceUrl, identity.contentHash,
      identity.startDate ?? null, identity.endDate ?? null, identity.model,
      identity.promptHash, identity.version ?? AI_SOURCE_CACHE_VERSION,
      JSON.stringify(results), results.length, identity.contentObserved === true]);
    await client.query("COMMIT");
    log("ai_source_cache_write", { ...fields, resultCount: results.length });
    if (results.length === 0) log("ai_source_cache_empty_result", { ...fields, cached: false, resultCount: 0 });
    return results;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { discard = true; }
    log("ai_source_cache_error", fields);
    // Fail closed: an unavailable cache must not silently create repeated spend.
    throw error;
  } finally {
    client.release(discard);
  }
}
