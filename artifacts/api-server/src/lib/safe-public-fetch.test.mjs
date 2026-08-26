import assert from "node:assert/strict";
import test from "node:test";
import { isPublicIpAddress, safeFetchPublicText } from "./safe-public-fetch.ts";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("rejects unsafe protocols, credentials, localhost and private IP literals before fetch", async () => {
  let calls = 0;
  const requestImpl = async () => { calls++; return new Response("unexpected"); };
  for (const url of [
    "file:///etc/passwd",
    "https://user:pass@example.com/",
    "http://localhost/admin",
    "http://127.0.0.1/admin",
    "http://192.168.1.2/admin",
    "http://[::1]/admin",
  ]) {
    await assert.rejects(safeFetchPublicText(url, { requestImpl, lookupImpl: publicLookup }));
  }
  assert.equal(calls, 0);
});

test("rejects public hostnames that resolve to private or reserved addresses", async () => {
  let calls = 0;
  await assert.rejects(safeFetchPublicText("https://example.com/contact", {
    requestImpl: async () => { calls++; return new Response("unexpected"); },
    lookupImpl: async () => [{ address: "10.0.0.5", family: 4 }],
  }));
  assert.equal(calls, 0);
});

test("validates every redirect target and blocks redirects to private networks", async () => {
  let calls = 0;
  await assert.rejects(safeFetchPublicText("https://example.com/contact", {
    lookupImpl: publicLookup,
    requestImpl: async () => {
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
    requestImpl: async () => {
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
    requestImpl: async () => new Response("01234567890", { status: 200 }),
  }), /exceeds limit/);
});

test("pins the connection to the validated public address despite a rebinding answer", async () => {
  let validationLookups = 0;
  let uncontrolledLookups = 0;
  const seen = [];
  const result = await safeFetchPublicText("https://research.example/contact", {
    lookupImpl: async () => {
      validationLookups++;
      return [{ address: "93.184.216.34", family: 4 }];
    },
    requestImpl: async ({ url, address }) => {
      seen.push({ hostname: url.hostname, address });
      // An uncontrolled connection-time lookup would now be rebound locally.
      const uncontrolledLookup = () => {
        uncontrolledLookups++;
        return { address: "127.0.0.1", family: 4 };
      };
      assert.notEqual(address.address, uncontrolledLookup().address);
      return new Response("ok");
    },
  });
  assert.equal(result.text, "ok");
  assert.equal(validationLookups, 1);
  assert.equal(uncontrolledLookups, 1);
  assert.deepEqual(seen, [{ hostname: "research.example", address: { address: "93.184.216.34", family: 4 } }]);
});

test("never substitutes an RFC1918 rebinding answer for the validated address", async () => {
  const connected = [];
  await safeFetchPublicText("http://research.example/contact", {
    lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    requestImpl: async ({ url, address }) => {
      connected.push({ hostname: url.hostname, address: address.address });
      assert.notEqual(address.address, "192.168.10.10");
      return new Response("ok");
    },
  });
  assert.deepEqual(connected, [{ hostname: "research.example", address: "93.184.216.34" }]);
});

test("redirect hosts receive their own validation and pinned address", async () => {
  const lookups = [];
  const requests = [];
  const answers = new Map([
    ["first.example", { address: "93.184.216.34", family: 4 }],
    ["second.example", { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }],
  ]);
  await safeFetchPublicText("https://first.example/start", {
    lookupImpl: async (hostname) => {
      lookups.push(hostname);
      return [answers.get(hostname)];
    },
    requestImpl: async ({ url, address }) => {
      requests.push({ hostname: url.hostname, address: address.address });
      if (url.hostname === "first.example") {
        return new Response(null, { status: 302, headers: { location: "https://second.example/contact" } });
      }
      return new Response("ok");
    },
  });
  assert.deepEqual(lookups, ["first.example", "second.example"]);
  assert.deepEqual(requests, [
    { hostname: "first.example", address: "93.184.216.34" },
    { hostname: "second.example", address: "2606:2800:220:1:248:1893:25c8:1946" },
  ]);
});

test("rejects mixed public and private DNS answers without making a request", async () => {
  let calls = 0;
  await assert.rejects(safeFetchPublicText("https://mixed.example/", {
    lookupImpl: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "fd00::1", family: 6 },
    ],
    requestImpl: async () => { calls++; return new Response("unexpected"); },
  }), /private or reserved/);
  assert.equal(calls, 0);
});

test("HTTPS pinning preserves the original hostname for Host and TLS SNI semantics", async () => {
  await safeFetchPublicText("https://tls.example/contact", {
    lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    requestImpl: async ({ url, address }) => {
      assert.equal(url.protocol, "https:");
      assert.equal(url.hostname, "tls.example");
      assert.equal(url.host, "tls.example");
      assert.equal(address.address, "93.184.216.34");
      return new Response("ok");
    },
  });
});

test("public IP classification rejects representative private and reserved ranges", () => {
  assert.equal(isPublicIpAddress("93.184.216.34"), true);
  for (const address of ["10.0.0.1", "100.64.0.1", "169.254.1.1", "172.16.0.1", "192.168.1.1", "127.0.0.1", "::1", "fd00::1"] ) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
});
