import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyAltEnergyProjectDbRecord,
  createAltEnergyProjectDbDiagnostics,
  normalizeAltEnergyCountry,
  parseAltEnergyCapacityMw,
} from "./altenergy-project-db.ts";

const eligibleSolar = {
  id: 9001,
  energy_id: 1,
  type: "In Development",
  project_name: "Fixture Solar Farm",
  country: "Australia",
  capacity: "100 MW",
  description: "Proposed utility-scale solar farm",
  status: "Approved",
  updated_at: "2026-08-14 12:30:00",
};

test("accepts live Bourke from explicit 5 MW AC evidence without rounding its 4.99 field", () => {
  const decision = classifyAltEnergyProjectDbRecord({
    ...eligibleSolar,
    id: 1444,
    energy_id: 1,
    project_name: "Bourke 2B Solar Farm",
    capacity: "4.99",
    country: "AUS",
    description: "Located 3km north-east of Bourke town centre, the 5 MW AC Bourke 2B Solar Farm will occupy 11.54 hectares.",
    state: "NSW",
    status: "Proposed",
    updated_at: "2026-01-09 01:25:40",
  });

  assert.deepEqual(decision, {
    outcome: "accepted",
    capacityMw: 5,
    rawStructuredCapacityMw: 4.99,
    capacityEvidence: "explicit_ac_capacity",
    capacityEvidenceText: "5 MW AC",
    country: "AU",
    sourceUpdatedDate: "2026-01-09",
  });
});

test("rejects generic structured 4.99 without explicit qualifying evidence", () => {
  const decision = classifyAltEnergyProjectDbRecord({
    ...eligibleSolar,
    capacity: "4.99",
    description: "Proposed utility-scale solar farm",
  });
  assert.equal(decision.outcome, "skipped_capacity");
  assert.equal(decision.capacityMw, 4.99);
  assert.equal(decision.rawStructuredCapacityMw, 4.99);
  assert.equal(decision.capacityEvidence, "none");
});

test("rejects explicit 4.99 MW project evidence", () => {
  const decision = classifyAltEnergyProjectDbRecord({
    ...eligibleSolar,
    capacity: "4.99",
    description: "The project has an AC output of 4.99 MW.",
  });
  assert.equal(decision.outcome, "skipped_capacity");
  assert.equal(decision.capacityMw, 4.99);
  assert.equal(decision.capacityEvidence, "none");
});

test("does not use a larger DC figure when AC capacity remains 4.99 MW", () => {
  const decision = classifyAltEnergyProjectDbRecord({
    ...eligibleSolar,
    capacity: "4.99",
    description: "The 6.4 MW DC solar farm has an AC output of 4.99 MW.",
  });
  assert.equal(decision.outcome, "skipped_capacity");
  assert.equal(decision.capacityMw, 4.99);
  assert.equal(decision.capacityEvidence, "none");
});

test("ordinary structured capacities at or above 5 MW remain unchanged", () => {
  const decision = classifyAltEnergyProjectDbRecord({
    ...eligibleSolar,
    capacity: "27 MW",
    description: "Approved solar farm",
  });
  assert.equal(decision.outcome, "accepted");
  assert.equal(decision.capacityMw, 27);
  assert.equal(decision.rawStructuredCapacityMw, 27);
  assert.equal(decision.capacityEvidence, "structured_capacity");
  assert.equal(decision.capacityEvidenceText, null);
});

test("accepts generic explicit project-capacity wording without a name exception", () => {
  const decision = classifyAltEnergyProjectDbRecord({
    ...eligibleSolar,
    project_name: "Regional Renewable Precinct",
    capacity: "4.99",
    description: "Development of a 5 MW solar farm with associated grid connection works.",
  });
  assert.equal(decision.outcome, "accepted");
  assert.equal(decision.capacityMw, 5);
  assert.equal(decision.rawStructuredCapacityMw, 4.99);
  assert.equal(decision.capacityEvidence, "explicit_project_capacity");
  assert.equal(decision.capacityEvidenceText, "5 MW solar farm");
});

test("does not infer an unknown AltEnergy energy id from free text", () => {
  assert.equal(classifyAltEnergyProjectDbRecord({
    ...eligibleSolar,
    energy_id: 99,
    project_name: "New Technology Solar and BESS Project",
  }).outcome, "skipped_energy_type");
});

test("rejects the live generating Gunnedah 2 record by status", () => {
  assert.equal(classifyAltEnergyProjectDbRecord({
    ...eligibleSolar,
    id: 522,
    project_name: "Gunnedah 2 Solar Farm",
    capacity: "144",
    country: "AUS",
    type: "Generating",
    status: "Generating",
    updated_at: "2026-01-06 23:10:51",
  }).outcome, "skipped_status");
});

test("the live eligible Gunnedah development is accepted regardless of its January update", () => {
  const liveGunnedah = {
    ...eligibleSolar,
    id: 346,
    project_name: "Gunnedah Solar Farm",
    capacity: "27",
    country: "AUS",
    type: "In Development",
    status: "Approved",
    updated_at: "2026-01-06 05:48:28",
  };
  const decision = classifyAltEnergyProjectDbRecord(liveGunnedah);
  assert.equal(decision.outcome, "accepted");
  assert.equal(decision.sourceUpdatedDate, "2026-01-06");
});

test("hard project rules remain unchanged", () => {
  const outcomes = [
    classifyAltEnergyProjectDbRecord({ ...eligibleSolar, country: "United States" }).outcome,
    classifyAltEnergyProjectDbRecord({ ...eligibleSolar, capacity: "4.99 MW" }).outcome,
    classifyAltEnergyProjectDbRecord({ ...eligibleSolar, energy_id: 5, project_name: "Standalone BESS", description: "Battery storage" }).outcome,
    classifyAltEnergyProjectDbRecord({ ...eligibleSolar, energy_id: 2, project_name: "Wind Farm", description: "Wind turbines" }).outcome,
    classifyAltEnergyProjectDbRecord({ ...eligibleSolar, status: "Cancelled" }).outcome,
  ];
  assert.deepEqual(outcomes, [
    "skipped_country",
    "skipped_capacity",
    "skipped_energy_type",
    "skipped_energy_type",
    "skipped_status",
  ]);
});

test("normalizes supported countries and parses formatted capacities", () => {
  assert.equal(normalizeAltEnergyCountry("New Zealand"), "NZ");
  assert.equal(normalizeAltEnergyCountry("Australia"), "AU");
  assert.equal(parseAltEnergyCapacityMw("1,250 MW"), 1250);
});

test("diagnostics expose only aggregate reason counters", () => {
  assert.deepEqual(createAltEnergyProjectDbDiagnostics(), {
    skipped_name: 0,
    skipped_energy_type: 0,
    skipped_status: 0,
    skipped_capacity: 0,
    skipped_country: 0,
    accepted: 0,
  });
});
