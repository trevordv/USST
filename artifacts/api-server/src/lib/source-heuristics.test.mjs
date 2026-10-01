import assert from "node:assert/strict";
import test from "node:test";
import { determineStatus, extractDeveloper, extractLocation, isEarlyStage } from "./source-heuristics.ts";

test("developer: explicit cues", () => {
  assert.equal(extractDeveloper("The 200 MW farm, developed by Acme Energy Pty Ltd, is under way."), "Acme Energy Pty Ltd");
  assert.equal(extractDeveloper("Developer: Venn Energy. Location: Geurie."), "Venn Energy");
  assert.equal(extractDeveloper("Neoen's 400 MW Culcairn Solar Farm approved"), "Neoen");
  assert.equal(extractDeveloper("Origin Energy has lodged plans for a 300 MW solar farm"), "Origin Energy");
  assert.equal(extractDeveloper("BNRG Leeson has announced the Corop Solar Farm"), "BNRG Leeson");
});

test("developer: regulators, project names and generic phrases are never returned", () => {
  assert.equal(extractDeveloper("Approved by the NSW Independent Planning Commission after review"), null);
  assert.equal(extractDeveloper("Culcairn Solar Farm approved in New South Wales"), null);
  assert.equal(extractDeveloper("The Queensland Government has announced a solar project"), null);
  assert.equal(extractDeveloper("Australia has 10 GW of solar"), null);
  assert.equal(extractDeveloper("Green Solar Power for schools"), null);
});

test("status, stage and location helpers keep prior behaviour", () => {
  assert.equal(determineStatus("Development approval granted"), "under_development");
  assert.equal(determineStatus("Solar farm announced"), "announced");
  assert.equal(isEarlyStage("Solar farm now generating power"), false);
  assert.equal(isEarlyStage("Solar farm proposed"), true);
  assert.equal(extractLocation("near Dubbo, NSW", "AU"), "NSW");
});

test("location: whole-word, earliest mention wins", () => {
  assert.equal(extractLocation("Exported to the USA from Dubbo, NSW", "AU"), "NSW");
  assert.equal(extractLocation("A farm near Bendigo in Victoria, with grid works in NSW", "AU"), "Victoria");
  assert.equal(extractLocation("Consent granted in Canterbury and Otago", "NZ"), "Canterbury");
  assert.equal(extractLocation("Nothing here", "AU"), null);
});
