import assert from "node:assert/strict";
import test from "node:test";
import { braveWebSearch, resetBraveSearchStateForTests } from "./brave-search.ts";

function captureLogger() {
  const entries = [];
  return {
    entries,
    logger: {
      info(context, message) { entries.push({ level: "info", context, message }); },
      warn(context, message) { entries.push({ level: "warn", context, message }); },
    },
  };
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

test.beforeEach(() => resetBraveSearchStateForTests());

test("normalizes a successful Brave response with bounded provenance", async () => {
  let requestedUrl;
  let requestedHeaders;
  const results = await braveWebSearch({
    query: "  Example   Energy official website  ",
    country: "NZ",
    count: 5,
    purpose: "developer_website_discovery",
  }, {
    environment: { BRAVE_SEARCH_API_KEY: "test-secret-key" },
    now: () => Date.parse("2026-08-26T01:02:03Z"),
    fetchImpl: async (url, options) => {
      requestedUrl = new URL(url);
      requestedHeaders = options.headers;
      return jsonResponse(200, { web: { results: [
        { title: " Example Energy ", url: "https://www.example.co.nz/about", description: " Official developer ", age: "2 days ago" },
        { title: "Unsafe", url: "http://127.0.0.1/private", description: "ignored" },
      ] } });
    },
  });

  assert.equal(requestedUrl.searchParams.get("q"), "Example Energy official website");
  assert.equal(requestedUrl.searchParams.get("country"), "NZ");
  assert.equal(requestedUrl.searchParams.get("search_lang"), "en");
  assert.equal(requestedUrl.searchParams.get("count"), "5");
  assert.equal(requestedHeaders["X-Subscription-Token"], "test-secret-key");
  assert.deepEqual(results, [{
    title: "Example Energy",
    url: "https://www.example.co.nz/about",
    description: "Official developer",
    source: "example.co.nz",
    age: "2 days ago",
    provenance: {
      purpose: "developer_website_discovery",
      queryHash: results[0].provenance.queryHash,
      searchedAt: "2026-08-26T01:02:03.000Z",
    },
  }]);
  assert.match(results[0].provenance.queryHash, /^[a-f0-9]{16}$/);
});

test("missing API key returns no results and logs only safe availability metadata", async () => {
  const captured = captureLogger();
  let calls = 0;
  const dependencies = {
    environment: {},
    logger: captured.logger,
    fetchImpl: async () => { calls++; throw new Error("must not fetch"); },
  };
  assert.deepEqual(await braveWebSearch({ query: "Example Energy" }, dependencies), []);
  assert.deepEqual(await braveWebSearch({ query: "Another Energy" }, dependencies), []);
  assert.equal(calls, 0);
  assert.equal(captured.entries.length, 1);
  assert.equal(captured.entries[0].context.outcome, "skipped-missing-credentials");
});

test("401, 403, 429 and 5xx failures return no results safely", async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    resetBraveSearchStateForTests();
    const captured = captureLogger();
    const results = await braveWebSearch({ query: `status ${status}` }, {
      environment: { BRAVE_SEARCH_API_KEY: "secret" },
      logger: captured.logger,
      fetchImpl: async () => jsonResponse(status, { secret: "upstream body is never logged" }),
    });
    assert.deepEqual(results, []);
    assert.equal(captured.entries[0].context.status, status);
    assert.equal("secret" in captured.entries[0].context, false);
  }
});

test("timeout aborts cleanly", async () => {
  const captured = captureLogger();
  const results = await braveWebSearch({ query: "slow query" }, {
    environment: { BRAVE_SEARCH_API_KEY: "secret" },
    logger: captured.logger,
    timeoutMs: 5,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
  });
  assert.deepEqual(results, []);
  assert.equal(captured.entries.at(-1).context.outcome, "timeout");
});

test("malformed JSON and malformed response shapes fail gracefully", async () => {
  const malformedJson = await braveWebSearch({ query: "bad json" }, {
    environment: { BRAVE_SEARCH_API_KEY: "secret" },
    fetchImpl: async () => ({ ok: true, status: 200, async json() { throw new SyntaxError("bad json"); } }),
    logger: captureLogger().logger,
  });
  assert.deepEqual(malformedJson, []);

  resetBraveSearchStateForTests();
  const malformedShape = await braveWebSearch({ query: "bad shape" }, {
    environment: { BRAVE_SEARCH_API_KEY: "secret" },
    fetchImpl: async () => jsonResponse(200, { results: [] }),
    logger: captureLogger().logger,
  });
  assert.deepEqual(malformedShape, []);
});

test("query length and result count are bounded", async () => {
  let calls = 0;
  const dependencies = {
    environment: { BRAVE_SEARCH_API_KEY: "secret" },
    logger: captureLogger().logger,
    fetchImpl: async (url) => {
      calls++;
      assert.equal(new URL(url).searchParams.get("count"), "10");
      return jsonResponse(200, { web: { results: [] } });
    },
  };
  assert.deepEqual(await braveWebSearch({ query: "x".repeat(301), count: 100 }, dependencies), []);
  assert.equal(calls, 0);
  await braveWebSearch({ query: "bounded count", count: 100 }, dependencies);
  assert.equal(calls, 1);
});

test("cache reuses normalized identical queries", async () => {
  let calls = 0;
  const dependencies = {
    environment: { BRAVE_SEARCH_API_KEY: "secret" },
    logger: captureLogger().logger,
    fetchImpl: async () => {
      calls++;
      return jsonResponse(200, { web: { results: [{ title: "Example", url: "https://example.com" }] } });
    },
  };
  await braveWebSearch({ query: "Example   Energy" }, dependencies);
  await braveWebSearch({ query: " example energy " }, dependencies);
  assert.equal(calls, 1);
});

test("concurrent duplicate searches share one request", async () => {
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const dependencies = {
    environment: { BRAVE_SEARCH_API_KEY: "secret" },
    logger: captureLogger().logger,
    fetchImpl: async () => {
      calls++;
      await pending;
      return jsonResponse(200, { web: { results: [{ title: "Example", url: "https://example.com" }] } });
    },
  };
  const first = braveWebSearch({ query: "same query" }, dependencies);
  const second = braveWebSearch({ query: "same query" }, dependencies);
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test("API key is never returned or logged", async () => {
  const secret = "never-expose-this-brave-key";
  const captured = captureLogger();
  const results = await braveWebSearch({ query: "safe query" }, {
    environment: { BRAVE_SEARCH_API_KEY: secret },
    logger: captured.logger,
    fetchImpl: async () => jsonResponse(500, {}),
  });
  assert.doesNotMatch(JSON.stringify({ results, logs: captured.entries }), new RegExp(secret));
});
