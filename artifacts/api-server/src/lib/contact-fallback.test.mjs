import assert from "node:assert/strict";
import test from "node:test";
import { inferKnownDeveloperFromText, matchKnownContact, planMissingContactFieldUpdates } from "./contact-fallback.ts";
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

test("infers a unique short registered developer identifier, but not a short alphabetic name", () => {
  assert.equal(
    inferKnownDeveloperFromText(
      "e-Storage will supply the battery system for OX2 at the Muswellbrook hybrid solar farm.",
      ["OX2", "AGL"],
    ),
    "OX2",
  );
  assert.equal(
    inferKnownDeveloperFromText("AGL partners on an unrelated project.", ["AGL"]),
    null,
  );
});

test("reuses the most complete exact-company known contact", () => {
  const contact = matchKnownContact("Squadron", [
    { organizationName: "Squadron Energy", name: "Contact One", email: "one@example.com", phone: null },
    { organizationName: "Squadron Energy", name: "Contact Two", email: "two@example.com", phone: "+61 2 0000 0000" },
  ]);
  assert.equal(contact?.name, "Contact Two");
});

test("fills missing developer/contact fields from exact company evidence without replacing existing values", () => {
  const fallback = { organizationName: "OX2", name: "Test Contact", email: "contact@example.test", phone: null };
  assert.deepEqual(
    planMissingContactFieldUpdates(
      { developer: null, contactName: null, contactEmail: "", contactPhone: null },
      "OX2",
      fallback,
    ),
    { developer: "OX2", contactName: "Test Contact", contactEmail: "contact@example.test" },
  );
  assert.deepEqual(
    planMissingContactFieldUpdates(
      { developer: "OX2", contactName: "Verified Contact", contactEmail: "verified@example.test", contactPhone: "+61 2 0000 0000" },
      "Different developer",
      fallback,
    ),
    {},
  );
});

test("developer extraction accepts company-led lands headlines", () => {
  assert.equal(
    extractDeveloper("Squadron lands federal tick for Queensland solar and battery project."),
    "Squadron",
  );
});

test("PVH fallback matches only the exact normalised company, never a substring", async () => {
  const { matchPvhFallbackContact } = await import("./contact-fallback.ts");
  const contacts = [
    { organizationName: "Ark Energy", firstName: "A", lastName: "K", email1: "a@arkenergy.example" },
    { organizationName: "EDF Renewables Australia", firstName: "E", lastName: "D", email1: "e@edf.example" },
    { organizationName: "BP Australia", firstName: "B", lastName: "P", email1: "b@bp.example" },
    { organizationName: "AGL Energy", firstName: null, lastName: null, email1: "g@agl.example" },
    { organizationName: "Neoen Australia", firstName: "N", lastName: "N", email1: "n@neoen.example" },
  ];
  for (const developer of ["Spark Renewables", "Clarke Energy", "Parkes Solar Farm Pty Ltd", "Markham Energy",
    "Redfern Energy", "Lightsource bp", "Fagle Renewables", "Sagl Power"]) {
    assert.equal(matchPvhFallbackContact(developer, contacts), null, developer);
  }
  assert.deepEqual(matchPvhFallbackContact("Neoen", contacts), { name: "N N", email: "n@neoen.example" });
  assert.deepEqual(matchPvhFallbackContact("Ark Energy Pty Ltd", contacts), { name: "A K", email: "a@arkenergy.example" });
  assert.deepEqual(matchPvhFallbackContact("AGL", contacts), { name: "AGL Energy", email: "g@agl.example" });
  assert.equal(matchPvhFallbackContact(null, contacts), null);
});
