import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeAltEnergyLoginPage } from "./altenergy-session.ts";

test("redirect to /login is an expired session", () => {
  assert.equal(looksLikeAltEnergyLoginPage("https://altenergy.com.au/login", 200, "<html></html>"), true);
});
test("401/403 are expired sessions", () => {
  assert.equal(looksLikeAltEnergyLoginPage("https://altenergy.com.au/watt_news", 403, ""), true);
});
test("a login form served at the article URL is detected", () => {
  const body = `<form method="POST" action="/login"><input type="password" name="password"></form>`;
  assert.equal(looksLikeAltEnergyLoginPage("https://altenergy.com.au/watt_news", 200, body), true);
});
test("normal member content is not flagged", () => {
  assert.equal(looksLikeAltEnergyLoginPage("https://altenergy.com.au/watt_news", 200, "<article><h2>Solar farm</h2></article>"), false);
});
