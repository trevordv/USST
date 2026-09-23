import assert from "node:assert/strict";
import test from "node:test";
import { extractNamedProjectEvidence } from "./news-project-evidence.ts";
import {
  getProjectIneligibilityReason,
  summarizeScanLineage,
} from "./project-eligibility.ts";

const analyse = (title, text, country = "AU") =>
  extractNamedProjectEvidence({
    title,
    text,
    fallbackCountry: country,
    requireCountryEvidence: true,
  });

test("RUN-0115 stored lineage is 12 dated events plus 552 inventory observations, not 564 scan-period projects", () => {
  const lineage = [
    ...Array.from({ length: 3 }, (_, i) => ({
      projectId: i + 1,
      isNew: true,
      eventType: "new",
      effectiveDate: "2026-09-20",
    })),
    ...Array.from({ length: 9 }, (_, i) => ({
      projectId: i + 4,
      isNew: false,
      eventType: "updated",
      effectiveDate: "2026-09-21",
    })),
    ...Array.from({ length: 552 }, (_, i) => ({
      projectId: i + 13,
      isNew: false,
      eventType: "inventory_observed",
      effectiveDate: null,
      dateEvidence: "altenergy_inventory_observation",
    })),
  ];
  assert.deepEqual(summarizeScanLineage(lineage, { bounded: true }), {
    projectsFound: 12,
    newProjects: 3,
    updatedProjects: 9,
    inventoryObservedCount: 552,
  });
});

test("RUN-0115 false-positive articles do not resolve to projects", () => {
  const rejected = [
    [
      "Gokin Solar helps 'plant a sun' with parabolic trough CSP in Tibet",
      "The 400 MW photovoltaic and 50 MW CSP project is in Tibet, China.",
    ],
    [
      "Renewables share hits record high in NEM",
      "Market statistics show 12 GW of solar across Australia.",
    ],
    [
      "Solar anti-dumping inquiry gathers pace",
      "An industry article about tariffs and 8 GW of imports.",
    ],
    [
      "RSK acquires Cogency renewable energy consultancy",
      "The company advised the proposed 250 MW Weasel Solar Farm in NSW.",
    ],
    [
      "Storage project reaches financial close",
      "A named 200 MW battery and 800 MWh BESS in Queensland.",
    ],
    [
      "Community-owned 6.8 MW solar and 10.5 MWh battery mark project completion",
      "The Yiray Clean Energy Park in Victoria has been completed and is up and running.",
    ],
    [
      "CEO discusses the future of solar technology",
      "The interview mentions the proposed 82 MW Sybella Solar and Battery Project in Queensland.",
    ],
  ];
  for (const [title, text] of rejected)
    assert.deepEqual(analyse(title, text), [], title);
});

test("an Australian publication is not geographic evidence for an otherwise unspecified project", () => {
  assert.deepEqual(
    analyse(
      "Example Solar Farm receives approval",
      "The proposed 80 MW Example Solar Farm received planning approval.",
    ),
    [],
  );
});

test("RUN-0115 preserves specific supported AU/NZ projects and splits a two-project article", () => {
  const rows = [
    ...analyse(
      "West Mokoan Solar Farm receives planning approval",
      "The proposed 100 MW West Mokoan Solar Farm in Victoria received planning approval.",
    ),
    ...analyse(
      "Construction to begin on Sybella solar and battery project",
      "The proposed 82 MW Sybella Solar and Battery Project near Mount Isa, Queensland begins construction in late 2026.",
    ),
    ...analyse(
      "Trina advances Waroona Renewable Energy Project",
      "The proposed Waroona Renewable Energy Project in Western Australia includes an explicit 132 MW solar farm and an 81.5 MW BESS.",
    ),
    ...analyse(
      "Two New Zealand solar farm sites change hands",
      "The consented 110 MW Karioi Solar Farm in New Zealand and the consented 95 MW Ongaonga Solar Farm in Hawke’s Bay are construction-ready.",
      "NZ",
    ),
  ];
  assert.deepEqual(
    rows.map((row) => row.name).sort(),
    [
      "Karioi Solar Farm",
      "Ongaonga Solar Farm",
      "Sybella Solar and Battery Project",
      "Waroona Renewable Energy Project",
      "West Mokoan Solar Farm",
    ].sort(),
  );
  assert.deepEqual(
    rows.map((row) => row.capacityMw).sort((a, b) => a - b),
    [82, 95, 100, 110, 132],
  );
  assert.ok(
    rows.every(
      (row) =>
        getProjectIneligibilityReason({
          ...row,
          description: `${row.name} solar project`,
        }) == null,
    ),
  );
});

test("hybrid evidence uses explicit solar MW, never battery MW or MWh", () => {
  const [row] = analyse(
    "Sybella Solar and Battery Project approved",
    "The Sybella Solar and Battery Project in Queensland combines a 6 MW solar array with a 50 MW / 100 MWh BESS.",
  );
  assert.equal(row.capacityMw, 6);
  const [storageOnly] = analyse(
    "Alpha Solar and Battery Project proposed",
    "The Alpha Solar and Battery Project in NSW has a 50 MW / 100 MWh BESS; solar capacity was not stated.",
  );
  assert.equal(storageOnly.capacityMw, null);
});
