import assert from "node:assert/strict";
import test from "node:test";
import { sourceAcquisitionOutcome, parseSourceFallbackArray } from "./source-access-outcome.ts";

test("successful empty fallback is empty, not a network/extraction failure", () => {
  assert.deepEqual(parseSourceFallbackArray("```json\n[]\n```"), []);
  assert.equal(sourceAcquisitionOutcome({ projectCount: 0, directSucceeded: false, fallbackSucceeded: true, failureOutcome: "blocked" }), "empty");
});
test("failed fallback cannot masquerade as a successful empty extraction", () => {
  for (const text of ["", "upstream unavailable", "[invalid]", "[null]", "[4]"]) {
    assert.throws(() => parseSourceFallbackArray(text));
  }
  for (const failureOutcome of ["blocked", "timeout", "extraction-failed"]) {
    assert.equal(sourceAcquisitionOutcome({ projectCount: 0, directSucceeded: false, fallbackSucceeded: false, failureOutcome }), failureOutcome);
  }
});
test("successful direct reads and extracted project counts keep their existing outcomes", () => {
  assert.equal(sourceAcquisitionOutcome({ projectCount: 0, directSucceeded: true, fallbackSucceeded: false, failureOutcome: "extraction-failed" }), "empty");
  assert.equal(sourceAcquisitionOutcome({ projectCount: 2, directSucceeded: false, fallbackSucceeded: true, failureOutcome: "blocked" }), "success");
  assert.deepEqual(parseSourceFallbackArray('[{"name":"River Solar Farm"}]'), [{ name: "River Solar Farm" }]);
});
