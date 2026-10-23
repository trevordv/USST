import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  extractOpenAiUsage, getOpenAiUsageSummary, recordOpenAiCacheHit,
  runOpenAiCall, sanitizeOpenAiMetadata,
} from "./openai-usage.ts";
import { estimateOpenAiCostUsd } from "./openai-pricing.ts";

const context = {
  operation: "source_fallback", sourceName: "Official source",
  sourceUrl: "https://official.example/projects", model: "gpt-5.6-luna",
};

test("successful OpenAI call records actual response usage and result count", async () => {
  const entries = [];
  const result = await runOpenAiCall(context, async () => ({
    id: "resp_123", model: "gpt-5.6-luna",
    usage: {
      input_tokens: 1000, input_tokens_details: { cached_tokens: 200 },
      output_tokens: 100, output_tokens_details: { reasoning_tokens: 25 },
    },
    output: [{ type: "web_search_call" }, { type: "message" }],
  }), () => ["one", "two"], rows => rows.length, async entry => entries.push(entry));
  assert.deepEqual(result, ["one", "two"]);
  assert.equal(entries.length, 1);
  assert.deepEqual({
    id: entries[0].responseId, input: entries[0].inputTokens,
    cached: entries[0].cachedInputTokens, output: entries[0].outputTokens,
    reasoning: entries[0].reasoningTokens, searches: entries[0].webSearchCalls,
    count: entries[0].resultCount, success: entries[0].success,
  }, { id: "resp_123", input: 1000, cached: 200, output: 100, reasoning: 25, searches: 1, count: 2, success: true });
  assert.ok(entries[0].estimatedCostUsd > 0.01);
});

test("failed OpenAI call is recorded safely and the original failure survives ledger failure", async () => {
  const entries = [];
  await assert.rejects(runOpenAiCall(context, async () => { throw new TypeError("provider failed"); }, undefined, undefined,
    async entry => entries.push(entry)), /provider failed/);
  assert.equal(entries[0].success, false);
  assert.equal(entries[0].metadata.failureType, "TypeError");

  const valid = await runOpenAiCall(context, async () => ({ output_text: "[]" }), undefined, undefined,
    async () => { throw new Error("database offline"); });
  assert.equal(valid.output_text, "[]");
});

test("cache hit is recorded without an API call", async () => {
  let apiCalls = 0;
  const entries = [];
  await recordOpenAiCacheHit(context, 0, async entry => entries.push(entry));
  assert.equal(apiCalls, 0);
  assert.equal(entries[0].cacheHit, true);
  assert.equal(entries[0].resultCount, 0);
  assert.equal(entries[0].estimatedCostUsd, 0);
});

test("missing usage fields do not crash and remain unknown", async () => {
  const entries = [];
  await runOpenAiCall(context, async () => ({ id: "resp_minimal" }), undefined, undefined,
    async entry => entries.push(entry));
  assert.equal(entries[0].inputTokens, null);
  assert.equal(entries[0].estimatedCostUsd, null);
  assert.deepEqual(extractOpenAiUsage(null), {
    responseId: null, model: null, inputTokens: null, cachedInputTokens: null,
    outputTokens: null, reasoningTokens: null, webSearchCalls: 0,
  });
});

test("sensitive metadata keys and complete prompt content are never written", async () => {
  const entries = [];
  await runOpenAiCall({ ...context, metadata: {
    apiKey: "sk-secret", password: "hunter2", cookie: "session=x",
    authorization: "Bearer x", prompt: "complete private prompt", contentHash: "abc", phase: "extract",
    nested: { sessionToken: "secret", status: "ok" },
  } }, async () => ({ usage: { input_tokens: 1, output_tokens: 1 } }), undefined, undefined,
  async entry => entries.push(entry));
  assert.deepEqual(entries[0].metadata, { contentHash: "abc", phase: "extract", nested: { status: "ok" } });
  assert.deepEqual(sanitizeOpenAiMetadata({ authHeader: "x", safe: "ok" }), { safe: "ok" });
});

test("cost calculator separates cached input and does not double-charge reasoning tokens", () => {
  assert.equal(estimateOpenAiCostUsd("gpt-5.6-luna", {
    inputTokens: 1_000_000, cachedInputTokens: 500_000, outputTokens: 1_000_000,
    webSearchCalls: 2,
  }), 1.33);
  assert.equal(estimateOpenAiCostUsd("unknown-model", { inputTokens: 1, outputTokens: 1 }), null);
});

test("summary helper returns today, 30-day, operation and model aggregates", async () => {
  let sql = "";
  const summary = await getOpenAiUsageSummary(async statement => {
    sql = statement;
    return { rows: [{ calls_today: 3, cost_today: "0.12", calls_30: 9, cost_30: "1.25",
      by_operation: [{ operation: "source_fallback", calls: 2, cost_usd: 0.1 }],
      by_model: [{ model: "gpt-5.6-luna", calls: 2, cost_usd: 0.1 }] }] };
  });
  assert.equal(summary.callsToday, 3);
  assert.equal(summary.costLast30DaysUsd, 1.25);
  assert.equal(summary.costByOperation[0].operation, "source_fallback");
  assert.match(sql, /cache_hit = false/);
  assert.match(sql, /interval '30 days'/);
});

test("every USST Responses API call site uses the central escalation layer and ledger wrapper", async () => {
  const sources = await Promise.all(["scraper.ts", "epbc-scraper.ts"].map(name =>
    readFile(new URL(`./${name}`, import.meta.url), "utf8")));
  assert.equal(sources.join("\n").match(/responses\.create\s*\(/g)?.length, 3);
  assert.equal(sources.join("\n").match(/runOpenAiEscalation\s*\(\{/g)?.length, 3);
  const escalation = await readFile(new URL("./openai-escalation.ts", import.meta.url), "utf8");
  assert.equal(escalation.match(/runOpenAiCall\s*\(\{/g)?.length, 1);
  for (const operation of ["source_fallback", "epbc_search", "watt_news_extract"]) {
    assert.match(sources.join("\n"), new RegExp(`operation: [\"']${operation}[\"']`));
  }
});
