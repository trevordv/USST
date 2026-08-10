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
    })),
    { projectId: 11, isNew: false },
  ];

  assert.deepEqual(summarizeScanLineage(lineage), {
    projectsFound: scanDetailProjects.length,
    newProjects: scanDetailProjects.filter((project) => project.isNew).length,
  });
});
