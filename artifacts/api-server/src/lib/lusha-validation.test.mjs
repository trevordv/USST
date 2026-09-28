import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { isExactPersonMatch, isProfessionalCompanyEmail, normalizeLushaRunOptions } from "./lusha-validation.ts";

test("Lusha requires explicit approval and a strict per-run credit budget", () => {
  assert.deepEqual(normalizeLushaRunOptions({ maxLushaCredits: 10 }), { approvedPaidProspecting: false, maxLushaCredits: 0, dryRun: false });
  assert.equal(normalizeLushaRunOptions({ approvedPaidProspecting: true, maxLushaCredits: 10 }).maxLushaCredits, 10);
  assert.equal(normalizeLushaRunOptions({ approvedPaidProspecting: true, maxLushaCredits: 101 }).maxLushaCredits, 0);
});

test("Lusha correlation requires the complete requested person identity", () => {
  assert.equal(isExactPersonMatch("Alice Nguyen", "Alice", "Nguyen"), true);
  assert.equal(isExactPersonMatch("Alice Nguyen", "Alice", "Smith"), false);
  assert.equal(isExactPersonMatch("Alice Nguyen", "Alice", undefined), false);
});

test("Lusha email must be professional and match a known developer domain", () => {
  assert.equal(isProfessionalCompanyEmail("alice@developer.com.au", "developer.com.au"), true);
  assert.equal(isProfessionalCompanyEmail("alice@gmail.com", "developer.com.au"), false);
  assert.equal(isProfessionalCompanyEmail("", "developer.com.au"), false);
});

test("dry run cannot reach paid Lusha, Apify, or LinkedIn paths", async () => {
  const source = await readFile(new URL("./scraper.ts", import.meta.url), "utf8");
  assert.match(source, /const lushaCreditBudget = lushaOptions\.dryRun \? 0/);
  assert.match(source, /phaseTwo\.length > 0 && token && !lushaOptions\.dryRun/);
  assert.match(source, /phaseThree\.length > 0 && token && !lushaOptions\.dryRun/);
  assert.match(source, /const co = companies\.find/);
  assert.match(source, /isExactPersonMatch\(`\$\{best\.firstName\} \$\{best\.lastName\}`/);
});
