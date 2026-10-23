import assert from "node:assert/strict";
import test from "node:test";
import { capacityAppearsInContent, dateAppearsInContent } from "./ai-evidence.ts";

test("AI capacity must appear in the acquired content", () => {
  assert.equal(capacityAppearsInContent(50, "A proposed 50 MW solar farm"), true);
  assert.equal(capacityAppearsInContent(50, "A proposed 50MW solar farm"), true);
  assert.equal(capacityAppearsInContent(1200, "the 1,200 MW project"), true);
  assert.equal(capacityAppearsInContent(1200, "the 1.2 GW project"), true);
  assert.equal(capacityAppearsInContent(440, "Corop Solar Farm (440 megawatts)"), true);
  assert.equal(capacityAppearsInContent(150, "a 150-MW solar farm"), true);
  assert.equal(capacityAppearsInContent(50, "A proposed 150 MW solar farm"), false);
  assert.equal(capacityAppearsInContent(200, "Fifty solar panels, 200 homes"), false);
  assert.equal(capacityAppearsInContent(400, "400 MWh battery"), true); // MWh is screened by the shared capacity parsers, not here
});

test("AI announcement date must appear in the acquired content", () => {
  const iso = "2026-08-05";
  for (const text of ["Published 2026-08-05", "Announced 5 August 2026", "5th Aug 2026", "August 5, 2026", "05/08/2026", "5/8/2026"]) {
    assert.equal(dateAppearsInContent(iso, text), true, text);
  }
  for (const text of ["Announced 15 August 2026", "8/5/2026", "August 2026", "no date"]) {
    assert.equal(dateAppearsInContent(iso, text), false, text);
  }
});
