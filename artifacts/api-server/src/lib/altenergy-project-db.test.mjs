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

test("rejects the live Bourke record at the unchanged 5 MW hard gate", () => {
  const decision = classifyAltEnergyProjectDbRecord({
    ...eligibleSolar,
    id: 1444,
    energy_id: 1,
    project_name: "Bourke 2B Solar Farm",
    capacity: "4.99",
    country: "AUS",
    description: "Solar farm development",
    state: "NSW",
    status: "Proposed",
    updated_at: "2026-01-09 01:25:40",
  });

  assert.deepEqual(decision, {
    outcome: "skipped_capacity",
    capacityMw: 4.99,
    country: "AU",
    sourceUpdatedDate: "2026-01-09",
  });
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
