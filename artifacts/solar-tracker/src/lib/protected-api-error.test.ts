import assert from "node:assert/strict";
import test from "node:test";
import { formatProtectedApiError } from "./protected-api-error.ts";

test("surfaces protected endpoint authentication failures clearly", () => {
  assert.match(
    formatProtectedApiError({ status: 401 }, "start contact enrichment"),
    /session is missing or has expired/i,
  );
  assert.match(
    formatProtectedApiError({ status: 403 }, "export projects"),
    /not authorized/i,
  );
});

test("surfaces backend failure details and safe generic 500 errors", () => {
  assert.equal(
    formatProtectedApiError(
      { status: 500, data: { error: "Contact enrichment failed to start" } },
      "start contact enrichment",
    ),
    "Start contact enrichment failed: Contact enrichment failed to start",
  );
  assert.match(
    formatProtectedApiError({ status: 502 }, "export projects"),
    /server returned an error/i,
  );
});
