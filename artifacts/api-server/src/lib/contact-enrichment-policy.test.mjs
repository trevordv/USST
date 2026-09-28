import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeEnrichmentOptions,
  selectResumableBatch,
  validateProviderCandidate,
} from "./contact-enrichment-policy.ts";

const base = {
  developer: "Example Solar Pty Ltd",
  developerDomain: "example-solar.com.au",
  expectedName: "Alice Nguyen",
  candidate: {
    firstName: "Alice", lastName: "Nguyen", email: "alice.nguyen@example-solar.com.au",
    currentCompany: "Example Solar", companyDomain: "example-solar.com.au",
    jobTitle: "Head of Project Development", providerPersonId: "person-1", providerCompanyId: "company-1",
  },
};

test("RUN-0038/0039: accepts only a complete correlated professional contact", () => {
  const result = validateProviderCandidate(base);
  assert.equal(result.accepted, true);
  if (result.accepted) assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});

test("RUN-0038: same first name but different person is rejected", () => {
  assert.deepEqual(validateProviderCandidate({ ...base, candidate: { ...base.candidate, lastName: "Smith" } }),
    { accepted: false, reason: "person-identity-mismatch" });
});

test("RUN-0038: unrelated current employer is rejected", () => {
  assert.deepEqual(validateProviderCandidate({ ...base, candidate: { ...base.candidate, currentCompany: "Unrelated Wind Ltd" } }),
    { accepted: false, reason: "current-employer-mismatch" });
});

test("RUN-0039: blank, personal-domain and unsupported role candidates are rejected", () => {
  assert.equal(validateProviderCandidate({ ...base, candidate: { ...base.candidate, email: "" } }).accepted, false);
  assert.equal(validateProviderCandidate({ ...base, candidate: { ...base.candidate, email: "alice@gmail.com" } }).accepted, false);
  assert.equal(validateProviderCandidate({ ...base, candidate: { ...base.candidate, jobTitle: "Former consultant" } }).accepted, false);
});

test("paid prospecting requires explicit approval and strict bounded integer budgets", () => {
  assert.equal(normalizeEnrichmentOptions({ approvedPaidProspecting: false, maxLushaCredits: 50 }).maxLushaCredits, 0);
  assert.equal(normalizeEnrichmentOptions({ approvedPaidProspecting: true, maxLushaCredits: Number.NaN }).maxLushaCredits, 0);
  assert.equal(normalizeEnrichmentOptions({ approvedPaidProspecting: true, maxLushaCredits: 101 }).maxLushaCredits, 0);
  assert.equal(normalizeEnrichmentOptions({ approvedPaidProspecting: true, maxLushaCredits: 8, maxLinkedInQueries: 0 }).maxLinkedInQueries, 0);
});

test("resumable batching skips cooldown entries and rotates oldest attempts first", () => {
  const now = new Date("2026-09-28T00:00:00Z");
  const selected = selectResumableBatch([
    { key: "first-25-repeat", lastAttemptAt: new Date("2026-09-27T00:00:00Z") },
    { key: "never-tried" },
    { key: "cooldown", nextEligibleAt: new Date("2026-10-01T00:00:00Z") },
  ], 1, now);
  assert.deepEqual(selected.map(({ key }) => key), ["never-tried"]);
});

test("source retains typed acceptance gate before successful enrichment bookkeeping", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./scraper.ts", import.meta.url), "utf8"));
  assert.match(source, /type ApplyOutcome = \{ accepted: boolean/);
  assert.match(source, /if \(outcome\.accepted\) \{\s*enrichedKeys\.add/);
  assert.doesNotMatch(source, /logger\.warn\(\{ status: resp\.status, body \}/);
  assert.doesNotMatch(source, /logger\.(?:warn|error)\(\{ err, devKey \}/);
});
