import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTimestamp } from "./timestamp.ts";

test("normalizes a valid Date to an ISO string", () => {
  assert.equal(
    normalizeTimestamp(new Date("2026-08-14T03:04:05.678Z")),
    "2026-08-14T03:04:05.678Z",
  );
});

test("normalizes a valid PostgreSQL timestamp string to an ISO string", () => {
  assert.equal(
    normalizeTimestamp("2026-08-14T13:04:05.678+10:00"),
    "2026-08-14T03:04:05.678Z",
  );
});

test("returns null for absent timestamps", () => {
  assert.equal(normalizeTimestamp(null), null);
  assert.equal(normalizeTimestamp(undefined), null);
});

test("returns null for invalid or unsupported timestamp values", () => {
  assert.equal(normalizeTimestamp("not-a-timestamp"), null);
  assert.equal(normalizeTimestamp(new Date("invalid")), null);
  assert.equal(normalizeTimestamp(1_723_602_245_678), null);
  assert.equal(normalizeTimestamp({}), null);
});
