import assert from "node:assert/strict";
import test from "node:test";
import { isPublicIpAddress, safeFetchPublicText } from "./safe-public-fetch.ts";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("rejects unsafe protocols, credentials, localhost and private IP literals before fetch", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response("unexpected"); };
  for (const url of [
    "file:///etc/passwd",
    "https://user:pass@example.com/",
    "http://localhost/admin",
    "http://127.0.0.1/admin",
    "http://192.168.1.2/admin",
    "http://[::1]/admin",
  ]) {
    await assert.rejects(safeFetchPublicText(url, { fetchImpl, lookupImpl: publicLookup }));
  }
  assert.equal(calls, 0);
});

test("rejects public hostnames that resolve to private or reserved addresses", async () => {
  let calls = 0;
  await assert.rejects(safeFetchPublicText("https://example.com/contact", {
    fetchImpl: async () => { calls++; return new Response("unexpected"); },
    lookupImpl: async () => [{ address: "10.0.0.5", family: 4 }],
  }));
  assert.equal(calls, 0);
});

test("validates every redirect target and blocks redirects to private networks", async () => {
  let calls = 0;
  await assert.rejects(safeFetchPublicText("https://example.com/contact", {
    lookupImpl: publicLookup,
    fetchImpl: async () => {
      calls++;
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
    },
  }));
  assert.equal(calls, 1);
});

test("follows a bounded public redirect and returns a bounded text response", async () => {
  let calls = 0;
  const result = await safeFetchPublicText("https://example.com/start", {
    lookupImpl: publicLookup,
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return new Response(null, { status: 302, headers: { location: "/contact" } });
      return new Response("contact page", { status: 200 });
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.text, "contact page");
  assert.equal(result.finalUrl, "https://example.com/contact");
});

test("enforces maximum body size", async () => {
  await assert.rejects(safeFetchPublicText("https://example.com/large", {
    lookupImpl: publicLookup,
    maxBytes: 10,
    fetchImpl: async () => new Response("01234567890", { status: 200 }),
  }), /exceeds limit/);
});

test("public IP classification rejects representative private and reserved ranges", () => {
  assert.equal(isPublicIpAddress("93.184.216.34"), true);
  for (const address of ["10.0.0.1", "100.64.0.1", "169.254.1.1", "172.16.0.1", "192.168.1.1", "127.0.0.1", "::1", "fd00::1"] ) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
});
