import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { isUnsafeAddress } from "./safe-public-text.ts";

test("private, reserved and IPv4-mapped addresses are rejected for both address families", () => {
  for (const value of ["127.0.0.1", "10.0.0.2", "172.16.0.1", "192.168.1.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1"]) {
    assert.equal(isUnsafeAddress(value), true, value);
  }
  assert.equal(isUnsafeAddress("8.8.8.8"), false);
  assert.equal(isUnsafeAddress("2606:4700:4700::1111"), false);
});

test("contact acquisition pins the connection to a validated DNS result and preserves TLS hostname", async () => {
  const source = await readFile(new URL("./safe-public-text.ts", import.meta.url), "utf8");
  assert.match(source, /addresses\.some\(\(\{ address \}\) => isUnsafeAddress\(address\)\)/);
  assert.match(source, /lookup: \(_hostname, _opts, callback\) => callback\(null, selected\.address, selected\.family\)/);
  assert.match(source, /servername: url\.hostname/);
  assert.match(source, /Host: url\.host/);
});

test("contact acquisition keeps hostname, protocol, redirect, timeout and body-size boundaries", async () => {
  const source = await readFile(new URL("./safe-public-text.ts", import.meta.url), "utf8");
  assert.match(source, /url\.hostname\.toLowerCase\(\) !== options\.allowedHostname\.toLowerCase\(\)/);
  assert.match(source, /DEFAULT_MAX_BYTES = 512 \* 1024/);
  assert.match(source, /DEFAULT_TIMEOUT_MS = 10_000/);
  assert.match(source, /DEFAULT_REDIRECTS = 3/);
  assert.match(source, /void visit\(next, redirects - 1\)/);
});
