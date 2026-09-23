import { logger } from "./logger.ts";
import { estimateOpenAiCostUsd, OPENAI_PRICING_EFFECTIVE_DATE } from "./openai-pricing.ts";

const SENSITIVE_KEY = /(?:api.?key|authorization|auth.?header|cookie|credential|password|prompt|secret|session|token)/i;

export type OpenAiOperation =
  | "source_fallback" | "epbc_search" | "watt_news_extract"
  | "contact_enrichment" | "source_repair" | "learning_analysis";

export interface OpenAiUsageContext {
  operation: OpenAiOperation;
  sourceName?: string | null;
  sourceUrl?: string | null;
  sourceIdentifier?: string | null;
  projectId?: number | null;
  model: string;
  metadata?: Record<string, unknown>;
}

export interface OpenAiLedgerEntry extends OpenAiUsageContext {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  webSearchCalls: number | null;
  responseId: string | null;
  resultCount: number | null;
  cacheHit: boolean;
  success: boolean;
  estimatedCostUsd: number | null;
  latencyMs: number;
}

interface ResponsesUsageShape {
  id?: unknown;
  model?: unknown;
  output?: unknown;
  usage?: {
    input_tokens?: unknown;
    input_tokens_details?: { cached_tokens?: unknown };
    output_tokens?: unknown;
    output_tokens_details?: { reasoning_tokens?: unknown };
  } | null;
}

export type OpenAiLedgerWriter = (entry: OpenAiLedgerEntry) => Promise<void>;
type QueryRunner = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sanitizeMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMetadataValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .map(([key, child]) => [key, sanitizeMetadataValue(child)]));
  }
  return typeof value === "string" && value.length > 500 ? `${value.slice(0, 500)}…` : value;
}

export function sanitizeOpenAiMetadata(value: Record<string, unknown> | undefined): Record<string, unknown> {
  return (sanitizeMetadataValue(value ?? {}) ?? {}) as Record<string, unknown>;
}

export function extractOpenAiUsage(response: unknown) {
  const shape = (response && typeof response === "object" ? response : {}) as ResponsesUsageShape;
  const usage = shape.usage;
  const output = Array.isArray(shape.output) ? shape.output : [];
  return {
    responseId: typeof shape.id === "string" ? shape.id : null,
    model: typeof shape.model === "string" ? shape.model : null,
    inputTokens: nonNegativeInteger(usage?.input_tokens),
    cachedInputTokens: nonNegativeInteger(usage?.input_tokens_details?.cached_tokens),
    outputTokens: nonNegativeInteger(usage?.output_tokens),
    reasoningTokens: nonNegativeInteger(usage?.output_tokens_details?.reasoning_tokens),
    webSearchCalls: output.filter(item => item && typeof item === "object"
      && (item as { type?: unknown }).type === "web_search_call").length,
  };
}

export async function writeOpenAiUsage(entry: OpenAiLedgerEntry): Promise<void> {
  const { pool } = await import("@workspace/db");
  await pool.query(`INSERT INTO public.openai_usage_ledger
    (operation, source_name, source_url, source_identifier, project_id, model,
     input_tokens, cached_input_tokens, output_tokens, reasoning_tokens,
     web_search_calls, response_id, result_count, cache_hit, success,
     estimated_cost_usd, latency_ms, metadata)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)`, [
    entry.operation, entry.sourceName ?? null, entry.sourceUrl ?? null,
    entry.sourceIdentifier ?? null, entry.projectId ?? null, entry.model,
    entry.inputTokens, entry.cachedInputTokens, entry.outputTokens,
    entry.reasoningTokens, entry.webSearchCalls, entry.responseId,
    entry.resultCount, entry.cacheHit, entry.success, entry.estimatedCostUsd,
    entry.latencyMs, JSON.stringify(sanitizeOpenAiMetadata(entry.metadata)),
  ]);
}

async function safelyWrite(entry: OpenAiLedgerEntry, writer: OpenAiLedgerWriter): Promise<void> {
  try { await writer(entry); }
  catch (err) { logger.warn({ err, operation: entry.operation }, "OpenAI usage ledger write failed"); }
}

export async function runOpenAiCall<TResponse, TResult = TResponse>(
  context: OpenAiUsageContext,
  call: () => Promise<TResponse>,
  transform?: (response: TResponse) => TResult | Promise<TResult>,
  resultCount?: (result: TResult) => number | null,
  writer: OpenAiLedgerWriter = writeOpenAiUsage,
): Promise<TResult> {
  const started = Date.now();
  let response: TResponse | undefined;
  try {
    response = await call();
    const result = transform ? await transform(response) : response as unknown as TResult;
    const actual = extractOpenAiUsage(response);
    const model = actual.model ?? context.model;
    const usage = { ...context, ...actual, model };
    await safelyWrite({
      ...usage, metadata: sanitizeOpenAiMetadata(context.metadata),
      resultCount: resultCount?.(result) ?? null, cacheHit: false, success: true,
      estimatedCostUsd: estimateOpenAiCostUsd(model, actual), latencyMs: Date.now() - started,
    }, writer);
    return result;
  } catch (error) {
    const actual = extractOpenAiUsage(response);
    const model = actual.model ?? context.model;
    await safelyWrite({
      ...context, ...actual, model, metadata: sanitizeOpenAiMetadata({
        ...context.metadata, failureType: error instanceof Error ? error.name : "UnknownError",
      }), resultCount: null, cacheHit: false, success: false,
      estimatedCostUsd: estimateOpenAiCostUsd(model, actual), latencyMs: Date.now() - started,
    }, writer);
    throw error;
  }
}

export async function recordOpenAiCacheHit(
  context: OpenAiUsageContext,
  resultCount: number,
  writer: OpenAiLedgerWriter = writeOpenAiUsage,
): Promise<void> {
  await safelyWrite({
    ...context, metadata: sanitizeOpenAiMetadata(context.metadata),
    inputTokens: null, cachedInputTokens: null, outputTokens: null,
    reasoningTokens: null, webSearchCalls: 0, responseId: null,
    resultCount, cacheHit: true, success: true, estimatedCostUsd: 0, latencyMs: 0,
  }, writer);
}

export interface OpenAiUsageSummary {
  callsToday: number;
  costTodayUsd: number;
  callsLast30Days: number;
  costLast30DaysUsd: number;
  costByOperation: Array<{ operation: string; calls: number; costUsd: number }>;
  costByModel: Array<{ model: string; calls: number; costUsd: number }>;
  pricingEffectiveDate: string;
}

export async function getOpenAiUsageSummary(query?: QueryRunner): Promise<OpenAiUsageSummary> {
  const dbPool = query ? null : (await import("@workspace/db")).pool;
  const runner = query ?? dbPool!.query.bind(dbPool);
  const { rows } = await runner(`WITH billable AS (
      SELECT * FROM public.openai_usage_ledger WHERE cache_hit = false
    ) SELECT
      count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS calls_today,
      coalesce(sum(estimated_cost_usd) FILTER (WHERE created_at >= date_trunc('day', now())), 0)::text AS cost_today,
      count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS calls_30,
      coalesce(sum(estimated_cost_usd) FILTER (WHERE created_at >= now() - interval '30 days'), 0)::text AS cost_30,
      (SELECT coalesce(jsonb_agg(x ORDER BY x.cost_usd DESC), '[]'::jsonb) FROM (
        SELECT operation, count(*)::int calls, coalesce(sum(estimated_cost_usd),0)::float8 cost_usd
        FROM billable WHERE created_at >= now() - interval '30 days' GROUP BY operation) x) AS by_operation,
      (SELECT coalesce(jsonb_agg(x ORDER BY x.cost_usd DESC), '[]'::jsonb) FROM (
        SELECT model, count(*)::int calls, coalesce(sum(estimated_cost_usd),0)::float8 cost_usd
        FROM billable WHERE created_at >= now() - interval '30 days' GROUP BY model) x) AS by_model
    FROM billable`);
  const row = rows[0] ?? {};
  return {
    callsToday: Number(row.calls_today ?? 0), costTodayUsd: Number(row.cost_today ?? 0),
    callsLast30Days: Number(row.calls_30 ?? 0), costLast30DaysUsd: Number(row.cost_30 ?? 0),
    costByOperation: ((row.by_operation as Array<Record<string, unknown>>) ?? []).map(value => ({
      operation: String(value.operation), calls: Number(value.calls), costUsd: Number(value.cost_usd),
    })),
    costByModel: ((row.by_model as Array<Record<string, unknown>>) ?? []).map(value => ({
      model: String(value.model), calls: Number(value.calls), costUsd: Number(value.cost_usd),
    })),
    pricingEffectiveDate: OPENAI_PRICING_EFFECTIVE_DATE,
  };
}
