import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireApprovedSourceWithFirecrawl,
  clearFirecrawlMemoryCacheForTests,
  firecrawlConfigured,
  firecrawlContentHash,
  firecrawlCrawlApprovedSource,
  firecrawlScrapeApprovedSource,
  FirecrawlAcquisitionError,
  FIRECRAWL_INTEGRATION_LIMITS,
} from "./firecrawl.ts";

const environment = { FIRECRAWL_API_KEY: "fc-test-secret" };
const nswUrl = "https://www.planningportal.nsw.gov.au/major-projects/projects";
const energyUrl = "https://www.energymagazine.com.au/?s=solar+project";

function scrapeResponse(overrides = {}) {
  return {
    success: true,
    data: {
      markdown: "# Solar projects\nA 50 MW solar farm is under assessment.",
      links: ["https://www.energymagazine.com.au/project/example"],
      metadata: {
        sourceURL: energyUrl,
        url: energyUrl,
        title: "Solar projects",
        statusCode: 200,
        cacheState: "miss",
      },
      ...overrides,
    },
  };
}

test.beforeEach(() => clearFirecrawlMemoryCacheForTests());

test("configuration and stable meaningful-content hashes are safe", () => {
  assert.equal(firecrawlConfigured(environment), true);
  assert.equal(firecrawlConfigured({}), false);
  assert.equal(firecrawlContentHash("a  b\r\n\r\n\r\nc"), firecrawlContentHash("a b\n\nc"));
  assert.notEqual(firecrawlContentHash("5 MW solar"), firecrawlContentHash("6 MW solar"));
});

test("v2 scrape is bounded, accepts JS-rendered content and preserves provenance", async () => {
  let calls = 0;
  const result = await firecrawlScrapeApprovedSource("Energy Magazine", energyUrl, {
    environment,
    fetcher: async (endpoint, options) => {
      calls++;
      assert.equal(endpoint, "https://api.firecrawl.dev/v2/scrape");
      assert.equal(options.headers.Authorization, "Bearer fc-test-secret");
      const body = JSON.parse(options.body);
      assert.deepEqual(body.formats, ["markdown", "links"]);
      assert.equal(body.onlyMainContent, true);
      assert.equal(body.timeout, 30000);
      assert.ok(body.maxAge > 0);
      return Response.json(scrapeResponse());
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.apiVersion, "v2");
  assert.equal(result.pagesFetched, 1);
  assert.equal(result.pages[0].finalUrl, energyUrl);
  assert.match(result.pages[0].content, /50 MW solar/);
  assert.match(result.pages[0].contentHash, /^[a-f0-9]{64}$/);
});

test("missing key, provider statuses, malformed JSON and empty content fail safely", async (t) => {
  await assert.rejects(
    firecrawlScrapeApprovedSource("Energy Magazine", energyUrl, { environment: {} }),
    (error) => error instanceof FirecrawlAcquisitionError && error.category === "missing-credentials",
  );
  for (const [status, category] of [[401, "auth-failed"], [403, "blocked"], [429, "rate-limited"], [500, "provider-error"]]) {
    await t.test(String(status), async () => {
      await assert.rejects(
        firecrawlScrapeApprovedSource("Energy Magazine", energyUrl, {
          environment, bypassMemoryCache: true,
          fetcher: async () => Response.json({ success: false, error: "secret must not be copied" }, { status }),
        }),
        (error) => error instanceof FirecrawlAcquisitionError && error.category === category && !error.message.includes("secret"),
      );
    });
  }
  await assert.rejects(
    firecrawlScrapeApprovedSource("Energy Magazine", energyUrl, {
      environment, bypassMemoryCache: true,
      fetcher: async () => new Response("not-json", { status: 200 }),
    }),
    (error) => error instanceof FirecrawlAcquisitionError && error.category === "malformed-response",
  );
  await assert.rejects(
    firecrawlScrapeApprovedSource("Energy Magazine", energyUrl, {
      environment, bypassMemoryCache: true,
      fetcher: async () => Response.json(scrapeResponse({ markdown: "", html: "" })),
    }),
    (error) => error instanceof FirecrawlAcquisitionError && error.category === "empty-content",
  );
});

test("transport timeout is classified without exposing the credential", async () => {
  const timeout = Object.assign(new Error("request with fc-test-secret timed out"), { name: "TimeoutError" });
  await assert.rejects(
    firecrawlScrapeApprovedSource("Energy Magazine", energyUrl, {
      environment,
      fetcher: async () => { throw timeout; },
    }),
    (error) => error instanceof FirecrawlAcquisitionError && error.category === "timeout" && !error.message.includes("fc-test-secret"),
  );
});

test("unapproved requested and final URLs are rejected", async () => {
  let calls = 0;
  await assert.rejects(
    firecrawlScrapeApprovedSource("Energy Magazine", "https://attacker.example/", {
      environment, fetcher: async () => { calls++; return Response.json(scrapeResponse()); },
    }), /approved source hostname/);
  assert.equal(calls, 0);
  await assert.rejects(
    firecrawlScrapeApprovedSource("Energy Magazine", energyUrl, {
      environment,
      fetcher: async () => Response.json(scrapeResponse({ metadata: { sourceURL: "https://attacker.example/", statusCode: 200 } })),
    }),
    (error) => error instanceof FirecrawlAcquisitionError && error.category === "unsafe-final-url",
  );
});

test("duplicate identical requests share one provider call, including cache reuse", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json(scrapeResponse()); };
  const [first, concurrent] = await Promise.all([
    acquireApprovedSourceWithFirecrawl("Energy Magazine", energyUrl, { environment, fetcher }),
    acquireApprovedSourceWithFirecrawl("Energy Magazine", energyUrl, { environment, fetcher }),
  ]);
  const cached = await acquireApprovedSourceWithFirecrawl("Energy Magazine", energyUrl, { environment, fetcher });
  assert.equal(calls, 1);
  assert.equal(first.cacheReuse, false);
  assert.equal(concurrent.cacheReuse, true);
  assert.equal(cached.cacheReuse, true);
});

test("crawl enforces max pages/depth and polls the current v2 endpoint", async () => {
  const requests = [];
  let clock = 0;
  const result = await firecrawlCrawlApprovedSource("NSW Planning Portal", nswUrl, {
    environment,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    fetcher: async (endpoint, options) => {
      requests.push({ endpoint, options });
      if (endpoint.endsWith("/v2/crawl")) return Response.json({ success: true, id: "job_123" });
      return Response.json({ status: "completed", data: [
        { markdown: "# Project list\n50 MW solar farm", metadata: { sourceURL: nswUrl, statusCode: 200 } },
        { markdown: "# Detail\nProject is under assessment", metadata: { sourceURL: `${nswUrl}/solar-detail`, statusCode: 200 } },
      ] });
    },
  });
  const submitted = JSON.parse(requests[0].options.body);
  assert.equal(submitted.limit, 3);
  assert.equal(submitted.maxDiscoveryDepth, 1);
  assert.equal(submitted.allowExternalLinks, false);
  assert.equal(submitted.maxConcurrency, 1);
  assert.equal(result.pagesFetched, 2);
  assert.match(requests[1].endpoint, /\/v2\/crawl\/job_123$/);
  assert.deepEqual(FIRECRAWL_INTEGRATION_LIMITS.maxPages, 3);
});

test("crawl total budget terminates polling", async () => {
  let clock = 0;
  await assert.rejects(
    firecrawlCrawlApprovedSource("NSW Planning Portal", nswUrl, {
      environment,
      now: () => clock,
      sleep: async () => { clock += 60000; },
      fetcher: async (endpoint) => endpoint.endsWith("/v2/crawl")
        ? Response.json({ success: true, id: "job_123" })
        : Response.json({ status: "scraping", data: [] }),
    }),
    (error) => error instanceof FirecrawlAcquisitionError && error.category === "timeout",
  );
});

test("source HTTP status embedded in a 200 Firecrawl response is classified", async () => {
  await assert.rejects(
    firecrawlScrapeApprovedSource("Energy Magazine", energyUrl, {
      environment,
      fetcher: async () => Response.json(scrapeResponse({ metadata: { sourceURL: energyUrl, statusCode: 403, error: "Forbidden" } })),
    }),
    (error) => error instanceof FirecrawlAcquisitionError && error.category === "blocked",
  );
});
