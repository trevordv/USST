import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTimestamp,
  sendEpbcMetaResponse,
  serializeEpbcMeta,
} from "./epbc-meta.ts";

test("normalizes a valid Date instance to an ISO timestamp", () => {
  const timestamp = new Date("2026-08-12T07:15:30.000Z");

  assert.equal(normalizeTimestamp(timestamp), "2026-08-12T07:15:30.000Z");
});

test("normalizes a PostgreSQL timestamp string to an ISO timestamp", () => {
  assert.equal(
    normalizeTimestamp("2026-08-12T17:15:30+10:00"),
    "2026-08-12T07:15:30.000Z",
  );
});

test("normalizes null and undefined timestamps to null", () => {
  assert.equal(normalizeTimestamp(null), null);
  assert.equal(normalizeTimestamp(undefined), null);
});

test("invalid timestamp values return null without breaking EPBC metadata", () => {
  assert.equal(normalizeTimestamp("not-a-timestamp"), null);
  assert.equal(normalizeTimestamp(new Date(Number.NaN)), null);

  let statusCode;
  let responseBody;
  const response = {
    status(code) {
      statusCode = code;
      return {
        json(body) {
          responseBody = body;
        },
      };
    },
  };

  assert.doesNotThrow(() =>
    sendEpbcMetaResponse(response, {
      lastScrapedAt: "not-a-timestamp",
      total: 211,
    }),
  );
  assert.equal(statusCode, 200);
  assert.deepEqual(responseBody, { lastScrapedAt: null, total: 211 });
});

test("preserves the EPBC metadata response shape for valid timestamps", () => {
  assert.deepEqual(
    serializeEpbcMeta({
      lastScrapedAt: "2026-08-12T07:15:30.000Z",
      total: "211",
    }),
    { lastScrapedAt: "2026-08-12T07:15:30.000Z", total: 211 },
  );
});
