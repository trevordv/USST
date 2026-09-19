import assert from "node:assert/strict";
import test from "node:test";
import {
  brightDataConfigured,
  fetchApprovedBrightData,
  planBrightDataTargets,
} from "./bright-data.ts";
import { getSourceRepairStrategy } from "./source-repair-strategies.ts";

const environment = { BRIGHT_DATA_API_KEY: "test-secret", BRIGHT_DATA_ZONE: "web_unlocker" };
const networkFailure = (url) => [{ method: "html", url, outcome: "fetch-failed", failureCategory: "network" }];

test("only failed approved public URLs are eligible for Bright Data", () => {
  const energy = getSourceRepairStrategy("Energy Magazine");
  const target = energy.officialUrls[1];
  assert.deepEqual(planBrightDataTargets(energy, networkFailure(target)), [{ url: target, format: "html" }]);
  assert.deepEqual(planBrightDataTargets(energy, [{ method: "html", url: target, outcome: "success-zero-results" }]), []);
  assert.deepEqual(planBrightDataTargets(energy, [{ method: "html", url: target, outcome: "fetch-failed", failureCategory: "blocked" }]), []);
  assert.deepEqual(planBrightDataTargets(energy, [{ method: "html", url: target, outcome: "fetch-failed", failureCategory: "public-access-block" }]), [{ url: target, format: "html" }]);
  assert.deepEqual(planBrightDataTargets(energy, [{ method: "html", url: target, outcome: "fetch-failed", failureCategory: "http-error" }]), []);
  assert.deepEqual(planBrightDataTargets(energy, networkFailure("https://attacker.example/private")), []);
  assert.deepEqual(planBrightDataTargets(getSourceRepairStrategy("AltEnergy Australia"), networkFailure("https://altenergy.com.au/login")), []);
  assert.deepEqual(planBrightDataTargets(getSourceRepairStrategy("EPBC Act Referrals"), networkFailure("https://epbcpublicportal.environment.gov.au/all-referrals/")), []);
  assert.deepEqual(planBrightDataTargets(getSourceRepairStrategy("Renew Economy"), [{ method: "html", url: "https://reneweconomy.com.au/", outcome: "fetch-failed", failureCategory: "public-access-block" }]), []);
  assert.deepEqual(planBrightDataTargets(energy, [
    { method: "html", url: target, outcome: "fetch-failed", failureCategory: "public-access-block" },
    { method: "html", url: target, outcome: "success-zero-results" },
  ]), []);
});

test("JavaScript-only public pages can use Bright Data, but access-controlled paths cannot", () => {
  const renewMap = getSourceRepairStrategy("RenewMap");
  assert.deepEqual(planBrightDataTargets(renewMap, [{ method: "direct-structured-html", url: renewMap.officialUrls[0], outcome: "requires-js-or-ai-repair", failureCategory: "parser" }]), [
    { url: renewMap.officialUrls[0], format: "structured-html" },
  ]);
  const nz = getSourceRepairStrategy("NZ Fast-track");
  assert.deepEqual(planBrightDataTargets(nz, networkFailure(nz.officialUrls[0])), []);
  const aemo = getSourceRepairStrategy("AEMO");
  assert.deepEqual(planBrightDataTargets(aemo, networkFailure(aemo.officialUrls[1])), []);
  const ministry = getSourceRepairStrategy("NZ Ministry for the Environment");
  assert.deepEqual(planBrightDataTargets(ministry, [{ method: "html", url: ministry.officialUrls[0], outcome: "parse-failed", failureCategory: "parser" }]), [{ url: ministry.officialUrls[0], format: "html" }]);
});

test("Web Unlocker request is fixed-endpoint, bounded and does not log credentials", async () => {
  const url = getSourceRepairStrategy("Energy Magazine").officialUrls[1];
  let called = 0;
  const body = await fetchApprovedBrightData("Energy Magazine", { url, format: "html" }, {
    environment,
    fetcher: async (endpoint, options) => {
      called++;
      assert.equal(endpoint, "https://api.brightdata.com/request");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer test-secret");
      assert.deepEqual(JSON.parse(options.body), { zone: "web_unlocker", url, format: "raw", method: "GET" });
      assert.ok(options.signal);
      return new Response('<article class="post">A 50 MW solar project</article>', { status: 200, headers: { "content-type": "text/html" } });
    },
  });
  assert.equal(called, 1);
  assert.match(body.toString("utf8"), /50 MW solar/);
});

test("missing zone, unapproved URLs, blocked pages and provider errors fail safely", async () => {
  const url = getSourceRepairStrategy("Energy Magazine").officialUrls[1];
  assert.equal(brightDataConfigured({ BRIGHT_DATA_API_KEY: "key" }), false);
  let calls = 0;
  const fetcher = async () => { calls++; return new Response("blocked", { status: 403 }); };
  await assert.rejects(fetchApprovedBrightData("Energy Magazine", { url, format: "html" }, { environment: { BRIGHT_DATA_API_KEY: "key" }, fetcher }), /key and zone/);
  await assert.rejects(fetchApprovedBrightData("Energy Magazine", { url: "https://example.com/private", format: "html" }, { environment, fetcher }), /not an approved/);
  await assert.rejects(fetchApprovedBrightData("AltEnergy Australia", { url: "https://altenergy.com.au/login", format: "html" }, { environment, fetcher }), /not an approved/);
  assert.equal(calls, 0);
  await assert.rejects(fetchApprovedBrightData("Energy Magazine", { url, format: "html" }, { environment, fetcher }), /HTTP 403/);
  await assert.rejects(fetchApprovedBrightData("Energy Magazine", { url, format: "html" }, {
    environment,
    fetcher: async () => new Response("Just a moment...", { status: 200, headers: { "content-type": "text/html" } }),
  }), /unusable source content/);
});

test("large responses are rejected before parsing", async () => {
  const url = getSourceRepairStrategy("Energy Magazine").officialUrls[1];
  await assert.rejects(fetchApprovedBrightData("Energy Magazine", { url, format: "html" }, {
    environment,
    fetcher: async () => new Response("x".repeat(2 * 1024 * 1024 + 1), { status: 200 }),
  }), /size limit/);
});
