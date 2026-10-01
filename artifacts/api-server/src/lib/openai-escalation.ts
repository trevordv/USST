import { logger } from "./logger.ts";
import {
  runOpenAiCall, type OpenAiLedgerWriter, type OpenAiOperation, type OpenAiUsageContext,
} from "./openai-usage.ts";

export const OPENAI_ESCALATION_MODELS = [
  "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol",
] as const;
export type OpenAiEscalationModel = typeof OPENAI_ESCALATION_MODELS[number];
export type OpenAiEscalationReason =
  | "malformed_output" | "schema_invalid" | "provider_failure"
  | "internally_inconsistent" | "missing_critical_fields" | "deterministic_unresolved";

interface EscalationPolicy { maxAttempts: number; allowProviderRetry: boolean }

/** Sol is reserved for high-value official-source recovery and source repair. */
export const OPENAI_ESCALATION_POLICIES: Record<OpenAiOperation, EscalationPolicy> = {
  source_fallback: { maxAttempts: 3, allowProviderRetry: true },
  epbc_search: { maxAttempts: 3, allowProviderRetry: true },
  source_repair: { maxAttempts: 3, allowProviderRetry: true },
  watt_news_extract: { maxAttempts: 2, allowProviderRetry: true },
  contact_enrichment: { maxAttempts: 2, allowProviderRetry: true },
  learning_analysis: { maxAttempts: 2, allowProviderRetry: true },
};

export class OpenAiQualityError extends Error {
  readonly reason: Exclude<OpenAiEscalationReason, "provider_failure">;
  constructor(reason: Exclude<OpenAiEscalationReason, "provider_failure">, message: string) {
    super(message);
    this.name = "OpenAiQualityError";
    this.reason = reason;
  }
}

type EscalationLogger = (event: string, fields: Record<string, unknown>) => void;

function providerStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function isRetryableProviderFailure(error: unknown): boolean {
  const status = providerStatus(error);
  return status === null || status === 408 || status === 409 || status === 429 || status >= 500;
}

function assertCompletedResponse(response: unknown): void {
  if (!response || typeof response !== "object") return;
  const shape = response as { status?: unknown; error?: unknown };
  if (shape.error || shape.status === "failed") {
    throw new Error("OpenAI provider returned a failed response");
  }
  if (shape.status === "incomplete" || shape.status === "cancelled") {
    throw new OpenAiQualityError("internally_inconsistent", `OpenAI response status was ${shape.status}`);
  }
}

export interface OpenAiEscalationOptions<TResponse, TResult> {
  context: Omit<OpenAiUsageContext, "model">;
  request: (model: OpenAiEscalationModel, attempt: number) => Promise<TResponse>;
  validate: (response: TResponse, model: OpenAiEscalationModel) => TResult | Promise<TResult>;
  resultCount?: (result: TResult) => number | null;
  /** Can only reduce the operation policy; never permits more than three attempts. */
  maxAttempts?: number;
  log?: EscalationLogger;
  ledgerWriter?: OpenAiLedgerWriter;
}

/**
 * Run an extraction from Luna upward. Only thrown quality errors and retryable
 * provider failures advance the model. Valid results, including [], terminate.
 */
export async function runOpenAiEscalation<TResponse, TResult>(
  options: OpenAiEscalationOptions<TResponse, TResult>,
): Promise<TResult> {
  const policy = OPENAI_ESCALATION_POLICIES[options.context.operation];
  const maximum = Math.max(1, Math.min(
    OPENAI_ESCALATION_MODELS.length,
    policy.maxAttempts,
    options.maxAttempts ?? policy.maxAttempts,
  ));
  const log = options.log ?? ((event, fields) => logger.info({ event, ...fields }, "OpenAI model escalation"));
  log("openai_model_initial", {
    operation: options.context.operation, initialModel: OPENAI_ESCALATION_MODELS[0], maxAttempts: maximum,
  });

  let lastError: unknown;
  for (let index = 0; index < maximum; index++) {
    const model = OPENAI_ESCALATION_MODELS[index];
    try {
      const result = await runOpenAiCall({
        ...options.context, model,
        metadata: { ...options.context.metadata, escalationAttempt: index + 1, escalationMaxAttempts: maximum },
      }, () => options.request(model, index + 1), response => {
        assertCompletedResponse(response);
        return options.validate(response, model);
      },
      options.resultCount, options.ledgerWriter);
      log("openai_model_final", {
        operation: options.context.operation, finalModel: model, attempts: index + 1, success: true,
      });
      return result;
    } catch (error) {
      lastError = error;
      const reason: OpenAiEscalationReason = error instanceof OpenAiQualityError
        ? error.reason : "provider_failure";
      const retryAllowed = reason !== "provider_failure"
        || (policy.allowProviderRetry && isRetryableProviderFailure(error));
      const nextModel = index + 1 < maximum && retryAllowed
        ? OPENAI_ESCALATION_MODELS[index + 1] : null;
      if (!nextModel) {
        log("openai_model_final", {
          operation: options.context.operation, finalModel: model,
          attempts: index + 1, success: false, failureReason: reason,
        });
        throw error;
      }
      log("openai_model_escalated", {
        operation: options.context.operation, escalationReason: reason,
        fromModel: model, escalatedModel: nextModel, attempt: index + 2,
      });
    }
  }
  throw lastError;
}
