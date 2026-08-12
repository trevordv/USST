import assert from "node:assert/strict";
import test from "node:test";
import { LAST_SEEN_WRITE_INTERVAL_MS, shouldRefreshLastSeen } from "../lib/auth-timing.ts";

test("last-seen writes are throttled within the configured interval", () => {
  const now = new Date("2026-08-12T00:10:00.000Z");

  assert.equal(shouldRefreshLastSeen(null, now), true);
  assert.equal(
    shouldRefreshLastSeen(new Date(now.getTime() - LAST_SEEN_WRITE_INTERVAL_MS + 1), now),
    false,
  );
  assert.equal(
    shouldRefreshLastSeen(new Date(now.getTime() - LAST_SEEN_WRITE_INTERVAL_MS), now),
    true,
  );
});
