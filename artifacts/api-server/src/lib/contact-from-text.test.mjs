import assert from "node:assert/strict";
import test from "node:test";
import { extractContactFromText, extractAuNzPhone, extractNamedPerson, extractPersonalEmails, emailMatchesCompany } from "./contact-from-text.ts";

test("finds a titled spokesperson named in an announcement", () => {
  assert.deepEqual(extractNamedPerson("Neoen Australia managing director Louis de Sambucy said the project would create 300 jobs."),
    { name: "Louis de Sambucy", title: "Managing Director" });
  assert.deepEqual(extractNamedPerson("Jane Smith, project director at Acme Renewables, confirmed the timeline."),
    { name: "Jane Smith", title: "Project Director" });
  assert.equal(extractNamedPerson("For more information contact Tom O'Brien on 0400 123 456.")?.name, "Tom O'Brien");
});

test("does not mistake places, projects or agencies for people", () => {
  assert.equal(extractNamedPerson("The Corop Solar Farm in Northern Victoria was approved."), null);
  assert.equal(extractNamedPerson("Contact Energy Australia for details."), null);
  assert.equal(extractNamedPerson("Minister for Energy Chris Bowen announced funding."), null);
});

test("extracts AU and NZ phone numbers in common written forms", () => {
  assert.equal(extractAuNzPhone("call 0412 345 678 today"), "0412 345 678");
  assert.equal(extractAuNzPhone("phone (02) 9123 4567"), "02 9123 4567");
  assert.equal(extractAuNzPhone("ring +61 3 9123 4567"), "+61 3 9123 4567");
  assert.equal(extractAuNzPhone("free call 1800 123 456"), "1800 123 456");
  assert.equal(extractAuNzPhone("NZ office +64 9 123 4567"), "+64 9 123 4567");
  assert.equal(extractAuNzPhone("a 440 MW project worth $1,200,000,000 in 2026"), null);
});

test("keeps only personal developer emails, never generic, freemail or publisher addresses", () => {
  assert.deepEqual(extractPersonalEmails("info@acme.com.au jane.smith@acme.com.au editor@reneweconomy.com.au bob@gmail.com"), ["jane.smith@acme.com.au"]);
  assert.equal(emailMatchesCompany("jane.smith@acmerenewables.com.au", "Acme Renewables Pty Ltd"), true);
  assert.equal(emailMatchesCompany("jane.smith@other.com.au", "Acme Renewables"), false);
});

test("builds a complete contact from a project description", () => {
  const contact = extractContactFromText(
    "BNRG Leeson's 440 MW Corop Solar Farm. BNRG project director Jane Citizen said construction starts in 2027. Contact jane.citizen@bnrg.com or 0400 111 222.",
    "BNRG Leeson",
  );
  assert.deepEqual(contact, { name: "Jane Citizen", title: "Project Director", email: "jane.citizen@bnrg.com", phone: "0400 111 222" });
  assert.equal(extractContactFromText("Acme says jane@other.com.au", "Acme Renewables").email, null);
  assert.deepEqual(extractContactFromText("", "Acme"), { name: null, title: null, email: null, phone: null });
});
