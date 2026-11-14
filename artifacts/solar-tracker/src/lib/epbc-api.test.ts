import assert from "node:assert/strict";
import test from "node:test";
import { createEpbcApiFetch, EPBC_AUTH_ERROR } from "./epbc-api.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("adds bearer auth and JSON content type to EPBC JSON requests", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const fetchImplementation = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    requestUrl = String(input);
    requestInit = init;
    return jsonResponse({ ok: true });
  }) as typeof fetch;

  const apiFetch = createEpbcApiFetch(
    "test-token",
    "/base",
    fetchImplementation,
  );
  await apiFetch("/api/epbc/projects/1", {
    method: "PATCH",
    body: JSON.stringify({ relevanceStatus: "solar" }),
  });

  const headers = new Headers(requestInit?.headers);
  assert.equal(requestUrl, "/base/api/epbc/projects/1");
  assert.equal(headers.get("Authorization"), "Bearer test-token");
  assert.equal(headers.get("Content-Type"), "application/json");
});

test("adds only bearer auth to multipart EPBC uploads", async () => {
  let requestInit: RequestInit | undefined;
  const fetchImplementation = (async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    requestInit = init;
    return jsonResponse({ total: 70 });
  }) as typeof fetch;

  const formData = new FormData();
  formData.append("file", new Blob(["xlsx"]), "epbc.xlsx");

  const apiFetch = createEpbcApiFetch("upload-token", "", fetchImplementation);
  await apiFetch("/api/epbc/upload", { method: "POST", body: formData });

  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get("Authorization"), "Bearer upload-token");
  assert.equal(headers.get("Content-Type"), null);
});

test("surfaces missing and expired sessions clearly", async () => {
  const neverFetch = (async () => {
    assert.fail("fetch should not run without a token");
  }) as typeof fetch;
  const withoutToken = createEpbcApiFetch(null, "", neverFetch);

  await assert.rejects(withoutToken("/api/epbc/projects"), {
    message: EPBC_AUTH_ERROR,
  });

  const unauthorizedFetch = (async () =>
    jsonResponse({ error: "Unauthorized" }, 401)) as typeof fetch;
  const expiredSession = createEpbcApiFetch(
    "expired-token",
    "",
    unauthorizedFetch,
  );

  await assert.rejects(expiredSession("/api/epbc/meta"), {
    message: EPBC_AUTH_ERROR,
  });
});
