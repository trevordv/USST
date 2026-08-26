import assert from "node:assert/strict";
import test from "node:test";
import { researchDeveloperWithBrave, researchProjectWithBrave } from "./brave-research.ts";

test("project research makes one bounded call and returns normalized evidence only", async () => {
  const calls = [];
  const evidence = await researchProjectWithBrave({
    projectName: "Riverina Solar Farm",
    developer: "Example Energy",
    location: "Wagga Wagga, NSW",
    capacityMw: "120.00",
    country: "AU",
  }, {
    search: async (input) => {
      calls.push(input);
      return [{
        title: "Riverina project update",
        url: "https://example.com/projects/riverina",
        source: "example.com",
        description: "Supporting public information",
        age: null,
        provenance: {
          purpose: "project_corroboration",
          queryHash: "0123456789abcdef",
          searchedAt: "2026-08-26T10:00:00.000Z",
        },
      }];
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].country, "AU");
  assert.equal(calls[0].count, 5);
  assert.equal(calls[0].purpose, "project_corroboration");
  assert.match(calls[0].query, /Riverina Solar Farm/);
  assert.match(calls[0].query, /120\.00 MW/);
  assert.deepEqual(evidence, [{
    title: "Riverina project update",
    url: "https://example.com/projects/riverina",
    source: "example.com",
    description: "Supporting public information",
    searchedAt: "2026-08-26T10:00:00.000Z",
    queryHash: "0123456789abcdef",
    purpose: "project_corroboration",
  }]);
  assert.equal("eligible" in evidence[0], false);
  assert.equal("project" in evidence[0], false);
});

test("developer and contact research use explicit supported purposes", async () => {
  const purposes = [];
  const search = async (input) => { purposes.push(input.purpose); return []; };
  await researchDeveloperWithBrave("Example Energy", "NZ", "developer_website_discovery", { search });
  await researchDeveloperWithBrave("Example Energy", "NZ", "contact_research", { search });
  assert.deepEqual(purposes, ["developer_website_discovery", "contact_research"]);
});

test("missing project identity returns no evidence without a Brave call", async () => {
  let calls = 0;
  const result = await researchProjectWithBrave({ country: "AU" }, {
    search: async () => { calls++; return []; },
  });
  assert.deepEqual(result, []);
  assert.equal(calls, 0);
});
