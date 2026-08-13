import assert from "node:assert/strict";
import test from "node:test";
import {
  canKnowledgeOverrideHardRules,
  confidenceForEvidence,
  contactCacheDecision,
  memoryFingerprint,
  reliabilityScore,
  sanitizeLearningPayload,
} from "./learning-policy.ts";

test("confidence uses understandable evidence thresholds and conflicts win", () => {
  assert.equal(confidenceForEvidence({ independentObservations: 1 }), "low");
  assert.equal(confidenceForEvidence({ independentObservations: 3 }), "medium");
  assert.equal(confidenceForEvidence({ independentObservations: 5 }), "high");
  assert.equal(confidenceForEvidence({ independentObservations: 9, conflicting: true }), "low");
  assert.equal(confidenceForEvidence({ independentObservations: 1, humanConfirmed: true }), "high");
});

test("memory fingerprints deduplicate stable observations", () => {
  const first = memoryFingerprint({ memoryType: "project_alias", subjectType: "project", subjectId: "1", key: "alias", value: { a: 1, b: 2 }, source: "scan" });
  const second = memoryFingerprint({ memoryType: "project_alias", subjectType: "project", subjectId: "1", key: "alias", value: { b: 2, a: 1 }, source: "scan" });
  assert.equal(first, second);
});

test("secret exclusion recursively redacts credentials and tokens", () => {
  const clean = sanitizeLearningPayload({ password: "secret", nested: { apiKey: "key", note: "safe" }, token: "eyJabcdefghijklmnopqrstuvwxyz0123456789" });
  assert.deepEqual(clean, { password: "[redacted]", nested: { apiKey: "[redacted]", note: "safe" }, token: "[redacted]" });
  assert.doesNotMatch(JSON.stringify(clean), /secret|abcdefghijklmnopqrstuvwxyz/);
});

test("contact cache reuses fresh confirmations, pauses fresh failures, and retries expired entries", () => {
  const now = new Date("2026-08-13T00:00:00Z");
  assert.equal(contactCacheDecision({ outcome: "confirmed", observedAt: new Date("2026-07-01T00:00:00Z"), now }), "reuse");
  assert.equal(contactCacheDecision({ outcome: "failed", observedAt: new Date("2026-08-10T00:00:00Z"), now }), "skip-identical-query");
  assert.equal(contactCacheDecision({ outcome: "failed", observedAt: new Date("2026-07-01T00:00:00Z"), now }), "retry");
  assert.equal(contactCacheDecision({ outcome: "stale", observedAt: new Date("2026-08-12T00:00:00Z"), now }), "retry");
});

test("source reliability is bounded and understandable", () => {
  assert.equal(reliabilityScore({ successes: 0, failures: 0, parserSuccesses: 0, parserFailures: 0, fallbackSuccesses: 0 }), 50);
  assert.equal(reliabilityScore({ successes: 10, failures: 0, parserSuccesses: 10, parserFailures: 0, fallbackSuccesses: 0 }), 100);
  const mixed = reliabilityScore({ successes: 8, failures: 2, parserSuccesses: 7, parserFailures: 3, fallbackSuccesses: 2 });
  assert.ok(mixed > 50 && mixed < 100);
});

test("memory and knowledge can never override hard business rules", () => {
  assert.equal(canKnowledgeOverrideHardRules(), false);
});
