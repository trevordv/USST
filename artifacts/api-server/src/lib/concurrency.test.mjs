import assert from "node:assert/strict";
import test from "node:test";
import { mapWithConcurrency } from "./concurrency.ts";

test("mapWithConcurrency preserves input order and respects its worker cap", async () => {
  let active = 0;
  let maxActive = 0;

  const results = await mapWithConcurrency([30, 5, 20, 10, 1], 2, async (delay, index) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, delay));
    active--;
    return `result-${index}`;
  });

  assert.deepEqual(results, ["result-0", "result-1", "result-2", "result-3", "result-4"]);
  assert.equal(maxActive, 2);
});

test("mapWithConcurrency rejects invalid worker counts", async () => {
  await assert.rejects(() => mapWithConcurrency([1], 0, async (value) => value), RangeError);
});
