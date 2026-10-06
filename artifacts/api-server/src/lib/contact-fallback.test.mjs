import assert from "node:assert/strict";
import test from "node:test";
import { inferKnownDeveloperFromText, matchKnownContact } from "./contact-fallback.ts";
import { extractDeveloper } from "./source-heuristics.ts";

test("infers a unique known developer from article text", () => {
  const developer = inferKnownDeveloperFromText(
    "Squadron lands federal tick for Queensland solar and battery project.",
    ["Squadron Energy", "Lightsource bp"],
  );
  assert.equal(developer, "Squadron Energy");
});

test("does not guess when equally strong known organisations are both present", () => {
  const developer = inferKnownDeveloperFromText(
    "Acme and Bravo announce a joint solar project.",
    ["Acme Energy", "Bravo Energy"],
  );
  assert.equal(developer, null);
});

test("reuses the most complete exact-company known contact", () => {
  const contact = matchKnownContact("Squadron", [
    { organizationName: "Squadron Energy", name: "Contact One", email: "one@example.com", phone: null },
    { organizationName: "Squadron Energy", name: "Contact Two", email: "two@example.com", phone: "+61 2 0000 0000" },
  ]);
  assert.equal(contact?.name, "Contact Two");
});

test("developer extraction accepts company-led lands headlines", () => {
  assert.equal(
    extractDeveloper("Squadron lands federal tick for Queensland solar and battery project."),
    "Squadron",
  );
});
