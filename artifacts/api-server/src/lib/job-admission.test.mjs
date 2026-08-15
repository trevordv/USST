import assert from "node:assert/strict";
import test from "node:test";
import { admitCostlyOperation, resetCostlyOperationAdmissionForTests } from "./job-admission.ts";

test("costly operations reject concurrent and cooldown starts", () => {
  resetCostlyOperationAdmissionForTests();
  const first = admitCostlyOperation("scan", 1, 1_000);
  assert.ok(first);
  assert.equal(admitCostlyOperation("scan", 2, 1_001), null);
  first.release();
  assert.equal(admitCostlyOperation("scan", 1, 2_000), null);
  assert.ok(admitCostlyOperation("scan", 1, 16_000));
});

test("release permits another administrator action after completion or failure", () => {
  resetCostlyOperationAdmissionForTests();
  const success = admitCostlyOperation("epbc-sync", 1, 20_000);
  success.release();
  const failure = admitCostlyOperation("epbc-sync", 2, 20_001);
  assert.ok(failure);
  failure.release();
  assert.ok(admitCostlyOperation("epbc-sync", 3, 20_002));
});

test("cooldown is per administrator and operation while concurrency is global per operation", () => {
  resetCostlyOperationAdmissionForTests();
  const scan = admitCostlyOperation("scan", 1, 30_000);
  assert.ok(scan);
  assert.ok(admitCostlyOperation("enrichment", 1, 30_001));
  assert.equal(admitCostlyOperation("scan", 2, 30_002), null);
  scan.release();
  assert.ok(admitCostlyOperation("scan", 2, 30_003));
});
