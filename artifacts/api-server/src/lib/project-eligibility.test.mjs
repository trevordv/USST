import assert from "node:assert/strict";
import test from "node:test";
import {
  filterEligibleScanProjects,
  getProjectIneligibilityReason,
  isEligibleScanProject,
  summarizeScanLineage,
} from "./project-eligibility.ts";

const baseProject = {
  description: "Proposed utility-scale solar farm in regional Australia",
  country: "AU",
};

test("rejects 1 MW solar and does not count it", () => {
  const project = {
    ...baseProject,
    name: "Rooftop Solar Expansion",
    capacityMw: 1,
  };

  assert.equal(
    getProjectIneligibilityReason(project),
    "below-minimum-capacity",
  );
  assert.deepEqual(filterEligibleScanProjects([project]), []);
  assert.deepEqual(summarizeScanLineage([]), {
    projectsFound: 0,
    newProjects: 0,
    updatedProjects: 0,
    inventoryObservedCount: 0,
  });
});

test("rejects 4.99 MW solar", () => {
  assert.equal(
    isEligibleScanProject({
      ...baseProject,
      name: "Small Solar Farm",
      capacityMw: 4.99,
    }),
    false,
  );
});

test("accepts solar at the 5 MW boundary", () => {
  assert.equal(
    isEligibleScanProject({
      ...baseProject,
      name: "Boundary Solar Farm",
      capacityMw: 5,
    }),
    true,
  );
});

test("accepts a greater-than-5 MW solar and BESS hybrid", () => {
  assert.equal(
    isEligibleScanProject({
      name: "Riverina Solar and BESS Project",
      description:
        "A proposed 120 MW solar farm with a co-located battery energy storage system",
      capacityMw: 120,
      country: "AU",
    }),
    true,
  );
});

test("rejects standalone BESS", () => {
  assert.equal(
    isEligibleScanProject({
      name: "Riverina Battery Energy Storage System",
      description: "A proposed 200 MW standalone BESS",
      capacityMw: 200,
      country: "AU",
    }),
    false,
  );
});

test("rejects wind-only projects", () => {
  assert.equal(
    isEligibleScanProject({
      name: "Southern Wind Farm",
      description: "A proposed 300 MW turbine development",
      capacityMw: 300,
      country: "AU",
    }),
    false,
  );
});

test("scan counters match unique eligible scan-detail results", () => {
  const projects = [
    {
      ...baseProject,
      id: 10,
      name: "New Solar Farm",
      capacityMw: 5,
      isNew: true,
    },
    {
      ...baseProject,
      id: 11,
      name: "Existing Solar Farm",
      capacityMw: "75.00",
      isNew: false,
    },
    {
      ...baseProject,
      id: 12,
      name: "Tiny Solar Farm",
      capacityMw: 1,
      isNew: true,
    },
  ];
  const scanDetailProjects = filterEligibleScanProjects(projects);
  const lineage = [
    ...scanDetailProjects.map((project) => ({
      projectId: project.id,
      isNew: project.isNew,
      eventType: project.isNew ? "new" : "updated",
      effectiveDate: "2026-08-10",
    })),
    { projectId: 11, isNew: false, eventType: "updated", effectiveDate: "2026-08-10" },
  ];

  assert.deepEqual(summarizeScanLineage(lineage), {
    projectsFound: scanDetailProjects.length,
    newProjects: scanDetailProjects.filter((project) => project.isNew).length,
    updatedProjects: 1,
    inventoryObservedCount: 0,
  });
});

test("bounded scan summary counts only new projects announced in the window, retaining other lineage separately", () => {
  const lineage = [
    { projectId: 1, isNew: true, eventType: "new", effectiveDate: "2026-09-20", dateEvidence: "source_reported" },
    { projectId: 2, isNew: false, eventType: "updated", effectiveDate: "2026-09-21", dateEvidence: "source_update" },
    { projectId: 2, isNew: false, eventType: "updated", effectiveDate: "2026-09-21", dateEvidence: "source_update" },
    { projectId: 3, isNew: false, eventType: "inventory_observed", effectiveDate: null, dateEvidence: "altenergy_inventory_observation" },
    { projectId: 4, isNew: false, eventType: "inventory_observed", effectiveDate: null, dateEvidence: "altenergy_inventory_observation" },
    { projectId: 5, isNew: false, eventType: "updated", effectiveDate: null },
    { projectId: 6, isNew: true, eventType: "new", effectiveDate: null, dateEvidence: "altenergy_inventory_observation" },
    // Stored by an earlier overlapping scan, announced inside this window.
    { projectId: 7, isNew: false, eventType: "inventory_observed", effectiveDate: "2026-09-22", dateEvidence: "persisted_announcement" },
  ];
  assert.deepEqual(summarizeScanLineage(lineage, { bounded: true }), {
    projectsFound: 2,
    newProjects: 1,
    updatedProjects: 1,
    inventoryObservedCount: 4,
  });
});

test("audit 2026-10-16: standalone storage is rejected even when solar is mentioned nearby", () => {
  for (const project of [
    { name: "Wallerawang Battery", description: "500 MW battery to be built next to the existing solar farm" },
    { name: "Supernode Stage 3 BESS", description: "pv magazine reports a 750 MW battery has been approved" },
    { name: "Western Downs Battery", description: "Battery next to the Western Downs solar farm" },
  ]) {
    assert.equal(getProjectIneligibilityReason({ ...project, capacityMw: 500, country: "AU" }), "no-solar-component", project.name);
  }
});

test("audit 2026-10-16: solar + storage hybrids named as batteries are still accepted", () => {
  for (const project of [
    { name: "Bungama Battery", description: "A 280 MW solar farm with a co-located battery" },
    { name: "Darling Downs BESS", description: "Hybrid project combining solar and battery storage" },
    { name: "Riverina Solar and BESS Project", description: "120 MW solar farm with BESS" },
  ]) {
    assert.equal(getProjectIneligibilityReason({ ...project, capacityMw: 120, country: "AU" }), null, project.name);
  }
});

test("audit 2026-10-16: solar farms mentioning nearby turbines are not treated as wind", () => {
  for (const description of [
    "Solar farm adjacent to the Tarong gas turbine station",
    "Solar farm near existing wind turbines",
  ]) {
    assert.equal(getProjectIneligibilityReason({ name: "Golden Plains Solar Farm", description, capacityMw: 200, country: "AU" }), null, description);
  }
});

test("audit 2026-10-16: wind and wind/solar hybrids remain excluded", () => {
  assert.equal(getProjectIneligibilityReason({ name: "Rye Park Wind & Solar Hybrid", description: "", capacityMw: 400, country: "AU" }), "wind-project");
  assert.equal(getProjectIneligibilityReason({ name: "Bulli Creek Solar", description: "Wind and solar hybrid with 2 GW of turbines", capacityMw: 400, country: "AU" }), "wind-project");
  assert.equal(getProjectIneligibilityReason({ name: "Golden Plains Energy Park", description: "A 1,300 MW wind farm with solar", capacityMw: 1300, country: "AU" }), "wind-project");
  assert.equal(getProjectIneligibilityReason({ name: "Windellama Solar Farm", description: "", capacityMw: 100, country: "AU" }), null);
});

test("audit 2026-10-16: scan rejection tally produces the stored summary shape", async () => {
  const { ScanRejectionTally } = await import("./project-eligibility.ts");
  const tally = new ScanRejectionTally();
  tally.record("missing-capacity", "Source A");
  tally.record("missing-capacity", "Source A");
  tally.record("missing-capacity", "Source B");
  tally.record("wind-project", "Source B");
  tally.record("noisy-name", "Source C");
  assert.deepEqual(tally.summary(), {
    totalRejected: 5, "noisy-name": 1, "outside-target-region": 0, "missing-capacity": 3,
    "below-minimum-capacity": 0, "wind-project": 1, "no-solar-component": 0,
    topMissingCapacitySources: [{ sourceName: "Source A", count: 2 }, { sourceName: "Source B", count: 1 }],
  });
  assert.equal(new ScanRejectionTally().summary().totalRejected, 0);
});
