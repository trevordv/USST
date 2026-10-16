import assert from "node:assert/strict";
import test from "node:test";
import { LushaV3Client, companyMatches, pickLushaContactDetails, salesTitleScore } from "./lusha-v3.ts";
import { discoverNewProjectContacts } from "./new-project-contacts.ts";

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body);
    calls.push({ path, body, headers: init.headers });
    const handler = routes[path];
    if (!handler) return { ok: false, status: 404, json: async () => ({}) };
    const out = await handler(body, calls.filter((c) => c.path === path).length);
    if (out?.status) return { ok: false, status: out.status, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => out };
  };
  return { impl, calls };
}

test("v3 endpoints, api_key header and reveal of emails and phones", async () => {
  const { impl, calls } = fakeFetch({
    "/v3/contacts/search-and-enrich": () => ({
      results: [{ id: "1", firstName: "Jane", lastName: "Citizen", jobTitle: { title: "Project Director" }, company: { domain: "www.bnrg.com" },
        emails: [{ email: "Jane.Citizen@bnrg.com", type: "work", confidence: "A+" }], phones: [{ number: "+61 400 111 222", type: "mobile" }] }],
      billing: { creditsCharged: 2 },
    }),
  });
  const client = new LushaV3Client("key-123", impl);
  const result = await client.findNamedPerson({ firstName: "Jane", lastName: "Citizen", companyName: "BNRG Leeson" });
  assert.equal(calls[0].path, "/v3/contacts/search-and-enrich");
  assert.equal(calls[0].headers.api_key, "key-123");
  assert.deepEqual(calls[0].body.reveal, ["emails", "phones"]);
  assert.deepEqual(result, { name: "Jane Citizen", title: "Project Director", email: "jane.citizen@bnrg.com", phone: "+61 400 111 222", companyDomain: "bnrg.com", creditsCharged: 2 });
});

test("named lookup rejects a different person", async () => {
  const { impl } = fakeFetch({ "/v3/contacts/search-and-enrich": () => ({ results: [{ firstName: "John", lastName: "Other", emails: [{ email: "j@x.com", type: "work" }] }], billing: { creditsCharged: 1 } }) });
  const result = await new LushaV3Client("k", impl).findNamedPerson({ firstName: "Jane", lastName: "Citizen", companyName: "X" });
  assert.equal(result.email, null);
  assert.equal(result.phone, null);
});

test("company prospecting uses v3, prefers AU/NZ staff and the most sales-relevant title, reveals one person", async () => {
  const { impl, calls } = fakeFetch({
    "/v3/contacts/prospecting": () => ({
      results: [
        { id: "a", firstName: "Eng", lastName: "Ineer", jobTitle: { title: "Electrical Engineer" }, company: { name: "Acme Renewables", domain: "acme.com.au" } },
        { id: "b", firstName: "Bea", lastName: "Dee", jobTitle: { title: "Head of Business Development" }, company: { name: "Acme Renewables", domain: "acme.com.au" } },
        { id: "c", firstName: "Not", lastName: "Here", jobTitle: { title: "CEO" }, company: { name: "Acme Mining", domain: "acmemining.com" } },
      ],
      billing: { creditsCharged: 1 },
    }),
    "/v3/contacts/enrich": (body) => ({
      results: [{ id: body.ids[0], firstName: "Bea", lastName: "Dee", company: { domain: "acme.com.au" },
        emails: [], phones: [{ number: "+61 2 9000 0000", type: "direct" }, { number: "+61 4...", type: "mobile" }] }],
      billing: { creditsCharged: 1 },
    }),
  });
  const result = await new LushaV3Client("k", impl).findCompanyContact({ companyName: "Acme Renewables Pty Ltd" });
  assert.equal(calls[0].path, "/v3/contacts/prospecting");
  assert.deepEqual(calls[0].body.filters.contacts.include.countries, ["AU", "NZ"]);
  assert.deepEqual(calls[0].body.filters.companies.include, { names: ["Acme Renewables Pty Ltd"] });
  assert.deepEqual(calls[1].body, { ids: ["b"], reveal: ["emails", "phones"] });
  assert.equal(result.name, "Bea Dee");
  assert.equal(result.email, null);
  assert.equal(result.phone, "+61 2 9000 0000", "phone-only result is kept; masked numbers are not");
  assert.equal(result.creditsCharged, 2);
});

test("helpers: company match, title scoring, DNC phones excluded, off-domain emails excluded", () => {
  assert.equal(companyMatches({ name: "Acme Renewables" }, "Acme Renewables Pty Ltd", null), true);
  assert.equal(companyMatches({ name: "Acme Mining" }, "Acme Renewables", null), false);
  assert.equal(companyMatches({ domain: "www.acme.com.au" }, "x", "acme.com.au"), true);
  assert.ok(salesTitleScore("Business Development Manager") > salesTitleScore("Engineer"));
  assert.deepEqual(pickLushaContactDetails({
    emails: [{ email: "x@other.com", type: "work", confidence: "A+" }, { email: "y@acme.com.au", type: "work" }],
    phones: [{ number: "+61 400 000 000", doNotCall: true }, { number: "+61 2 1111 1111", type: "direct" }],
  }, "acme.com.au"), { email: "y@acme.com.au", phone: "+61 2 1111 1111" });
});

test("new-project contacts: description first, one Lusha lookup per developer, budget respected", async () => {
  const updates = [];
  const lookups = [];
  const lusha = {
    async findNamedPerson(input) { lookups.push(["named", input]); return { name: "Jane Citizen", title: "Project Director", email: "jane@bnrg.com", phone: null, companyDomain: "bnrg.com", creditsCharged: 1 }; },
    async findCompanyContact(input) { lookups.push(["company", input]); return { name: "Bea Dee", title: "BD", email: null, phone: "+61 2 9000 0000", companyDomain: null, creditsCharged: 2 }; },
  };
  const rows = [
    { id: 1, name: "Corop Solar Farm", developer: "BNRG Leeson", description: "BNRG project director Jane Citizen said work starts in 2027.", contactName: null, contactEmail: null, contactPhone: null },
    { id: 2, name: "Leeson Solar 2", developer: "BNRG Leeson", description: "", contactName: null, contactEmail: null, contactPhone: null },
    { id: 3, name: "Acme Solar", developer: "Acme Renewables", description: "", contactName: null, contactEmail: null, contactPhone: null },
    { id: 4, name: "Phone Solar", developer: "Phone Co", description: "Call 0400 111 222 for details", contactName: null, contactEmail: null, contactPhone: null },
    { id: 5, name: "Budget Solar", developer: "Late Developer", description: "", contactName: null, contactEmail: null, contactPhone: null },
  ];
  const summary = await discoverNewProjectContacts(rows, {
    lusha, maxCredits: 3,
    update: async (id, fields) => { updates.push([id, fields]); },
  });
  // Text: name for #1, phone for #4 (no Lusha needed for #4).
  assert.deepEqual(updates.find(([id]) => id === 4)[1], { contactPhone: "0400 111 222" });
  // BNRG: one named lookup applied to both of its projects.
  assert.deepEqual(lookups[0], ["named", { firstName: "Jane", lastName: "Citizen", companyName: "BNRG Leeson" }]);
  assert.deepEqual(updates.filter(([id]) => id === 1 || id === 2).map(([, f]) => f.contactEmail).filter(Boolean), ["jane@bnrg.com", "jane@bnrg.com"]);
  // Acme: company prospecting, phone-only result kept.
  assert.deepEqual(updates.find(([id]) => id === 3)[1], { contactName: "Bea Dee", contactPhone: "+61 2 9000 0000" });
  // Budget (3 credits) exhausted before the last developer.
  assert.equal(lookups.length, 2);
  assert.equal(summary.stoppedReason, "budget");
  assert.equal(summary.lushaCreditsUsed, 3);
  assert.equal(updates.some(([id]) => id === 5), false);
});

test("new-project contacts: Lusha billing refusal stops further paid lookups; no Lusha key means text only", async () => {
  const lusha = {
    async findNamedPerson() { throw Object.assign(new Error("402"), { status: 402 }); },
    async findCompanyContact() { throw Object.assign(new Error("402"), { status: 402 }); },
  };
  const rows = [1, 2].map((id) => ({ id, name: `P${id}`, developer: `Dev ${id}`, description: "", contactName: null, contactEmail: null, contactPhone: null }));
  const refused = await discoverNewProjectContacts(rows, { lusha, maxCredits: 10, update: async () => {} });
  assert.equal(refused.stoppedReason, "provider-refused");
  assert.equal(refused.lushaLookups, 1);
  const disabled = await discoverNewProjectContacts(rows, { lusha: null, maxCredits: 10, update: async () => {} });
  assert.equal(disabled.stoppedReason, "disabled");
});

test("new-project contacts: a Lusha email from another company's domain is not applied", async () => {
  const updates = [];
  const lusha = {
    async findNamedPerson() { return null; },
    async findCompanyContact() { return { name: "X Y", title: null, email: "x@unrelated.com", phone: null, companyDomain: "acme.com.au", creditsCharged: 1 }; },
  };
  await discoverNewProjectContacts([{ id: 1, name: "A", developer: "Acme Renewables", description: "", contactName: null, contactEmail: null, contactPhone: null }],
    { lusha, maxCredits: 5, update: async (id, f) => { updates.push([id, f]); } });
  assert.deepEqual(updates, []);
});
