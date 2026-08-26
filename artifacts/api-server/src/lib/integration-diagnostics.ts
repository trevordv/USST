import { logger } from "./logger.ts";

export const REQUIRED_INTEGRATION_KEYS = [
  "OPENAI_API_KEY",
  "ALTENERGY_USERNAME",
  "ALTENERGY_PASSWORD",
  "LUVI_USERNAME",
  "LUVI_PASSWORD",
  "APIFY_API_TOKEN",
  "BRAVE_SEARCH_API_KEY",
  "LUSHA_API_KEY",
] as const;

export type RequiredIntegrationKey = (typeof REQUIRED_INTEGRATION_KEYS)[number];
export type IntegrationConfigurationStatus = "configured" | "missing";

export function getIntegrationConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): Record<RequiredIntegrationKey, IntegrationConfigurationStatus> {
  return Object.fromEntries(
    REQUIRED_INTEGRATION_KEYS.map((key) => [
      key,
      environment[key]?.trim() ? "configured" : "missing",
    ]),
  ) as Record<RequiredIntegrationKey, IntegrationConfigurationStatus>;
}

export function logIntegrationConfiguration(): void {
  logger.info(
    { integrations: getIntegrationConfiguration() },
    "Runtime integration configuration",
  );
}
