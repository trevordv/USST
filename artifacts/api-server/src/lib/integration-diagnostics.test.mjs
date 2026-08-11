import assert from "node:assert/strict";
import test from "node:test";
import {
  getIntegrationConfiguration,
  REQUIRED_INTEGRATION_KEYS,
} from "./integration-diagnostics.ts";

test("reports configuration presence without exposing secret values", () => {
  const environment = {
    OPENAI_API_KEY: "super-secret-openai-value",
    ALTENERGY_USERNAME: "user@example.com",
    ALTENERGY_PASSWORD: "",
    LUVI_USERNAME: "luvi-user",
    LUVI_PASSWORD: "   ",
    APIFY_API_TOKEN: "apify-secret",
    LUSHA_API_KEY: "lusha-secret",
  };

  const result = getIntegrationConfiguration(environment);

  assert.deepEqual(Object.keys(result), [...REQUIRED_INTEGRATION_KEYS]);
  assert.equal(result.OPENAI_API_KEY, "configured");
  assert.equal(result.ALTENERGY_PASSWORD, "missing");
  assert.equal(result.LUVI_PASSWORD, "missing");
  assert.equal(result.LUSHA_API_KEY, "configured");
  assert.doesNotMatch(JSON.stringify(result), /super-secret|user@example|apify-secret|lusha-secret/);
});
