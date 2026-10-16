/**
 * OpenAI standard-processing list prices in USD, effective 2026-09-05.
 * USST prompts are below the 272K long-context pricing boundary.
 * Update this single table when pricing changes. Reasoning tokens are already
 * included in output_tokens and therefore are not billed a second time.
 */
export const OPENAI_PRICING_EFFECTIVE_DATE = "2026-09-05";

interface ModelPrice {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
}

const MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-5.4": { inputPerMillion: 2.5, cachedInputPerMillion: 0.25, outputPerMillion: 15 },
  "gpt-5.6-luna": { inputPerMillion: 0.2, cachedInputPerMillion: 0.02, outputPerMillion: 1.2 },
  "gpt-5.6-terra": { inputPerMillion: 2, cachedInputPerMillion: 0.2, outputPerMillion: 12 },
  "gpt-5.6-sol": { inputPerMillion: 4, cachedInputPerMillion: 0.4, outputPerMillion: 20 },
};

// Responses API web search is $10 per 1,000 calls as of the effective date.
const WEB_SEARCH_PER_CALL_USD = 0.01;

export interface OpenAiBillableUsage {
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  webSearchCalls?: number | null;
}

export function estimateOpenAiCostUsd(model: string, usage: OpenAiBillableUsage): number | null {
  const price = MODEL_PRICES[model.replace(/-\d{4}-\d{2}-\d{2}$/, "")];
  if (!price) return null;
  const input = usage.inputTokens;
  const output = usage.outputTokens;
  if (input == null || output == null) return null;
  const cached = Math.min(Math.max(usage.cachedInputTokens ?? 0, 0), Math.max(input, 0));
  const uncached = Math.max(input - cached, 0);
  return (uncached * price.inputPerMillion
    + cached * price.cachedInputPerMillion
    + Math.max(output, 0) * price.outputPerMillion) / 1_000_000
    + Math.max(usage.webSearchCalls ?? 0, 0) * WEB_SEARCH_PER_CALL_USD;
}
