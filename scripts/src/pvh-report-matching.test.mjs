import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyReportStatus, cleanOwner, dedupeReport, identityKey, matchToUsst, planEnrichment, splitReportName,
} from "./pvh-report-matching.ts";

const usst = (over) => ({ id: 1, name: "Corop Solar Farm", description: "d", capacityMw: "440", developer: "BNRG Leeson",
  epc: null, location: "Rushworth, VIC", country: "AU", status: "announced", sourceName: "LUVI", ...over });
const report = (over) => ({ sheet: "VIC_development", name: "Corop Solar Farm", altNames: [], state: "VIC", owner: "Leeson Group",
  locality: "Rushworth", epc: null, capacityMw: 320, reportStatus: "Approved", battery: null, usstStatus: "under_development", pipeline: true, ...over });

test("report names lose state and technology suffixes; bracketed names become aliases", () => {
  assert.deepEqual(splitReportName("Stubbo - Solar"), { name: "Stubbo", altNames: [] });
  assert.deepEqual(splitReportName("Wollar Solar Farm-Solar"), { name: "Wollar Solar Farm", altNames: [] });
  assert.deepEqual(splitReportName("Sun Spot 3 Pty Ltd - Solar - Vic").name, "Sun Spot 3 Pty Ltd");
  assert.deepEqual(splitReportName("Beelbee Solar Farm (Darling Downs II)"), { name: "Beelbee Solar Farm", altNames: ["Darling Downs II"] });
  assert.equal(splitReportName("MOREE SOLAR FARM").name, "Moree Solar Farm");
  assert.equal(cleanOwner("STUBBO 1 PTY LTD as THE TRUSTEE FOR STUBBO 1 SOLAR PROJECT TRUST"), "Stubbo 1 Pty Ltd");
  assert.equal(cleanOwner("Not disclosed"), null);
});

test("only pipeline statuses are importable", () => {
  for (const s of ["Approved", "Yet to be approved", "Under Construction", "In Commissioning", "PPA not committed", "Underwritten"]) assert.equal(classifyReportStatus(s).pipeline, true, s);
  for (const s of [2019, "Withdrawn", "Not active", "Rejected", "Pre2015"]) assert.equal(classifyReportStatus(s).pipeline, false, String(s));
  assert.equal(classifyReportStatus("Yet to be approved").usstStatus, "announced");
});

test("matches name variants and aliases; never guesses", () => {
  assert.equal(identityKey("Bridle Track Solar Project"), identityKey("Bridle Track"));
  assert.equal(matchToUsst(report({}), [usst({})]).kind, "match");
  assert.equal(matchToUsst(report({ name: "Beelbee Solar Farm", altNames: ["Darling Downs II"], state: "QLD", capacityMw: 240 }),
    [usst({ name: "Darling Downs II Solar Farm", capacityMw: 240, location: "Queensland" })]).kind, "match");
  assert.equal(matchToUsst(report({ capacityMw: 29 }), [usst({ capacityMw: 120 })]).kind, "review");
  assert.equal(matchToUsst(report({}), [usst({ id: 1 }), usst({ id: 2, developer: "Other" })]).kind, "match", "developer breaks the tie");
  assert.equal(matchToUsst(report({}), [usst({ id: 1, developer: "X" }), usst({ id: 2, developer: "Y" })]).kind, "review");
  assert.equal(matchToUsst(report({ name: "Corop Solar Farm Stage 2" }), [usst({})]).kind, "review");
  assert.equal(matchToUsst(report({ state: "NSW" }), [usst({})]).kind, "review");
  assert.equal(matchToUsst(report({ name: "Brand New Solar Farm" }), [usst({})]).kind, "missing");
});

test("enrichment fills blanks only and never overwrites USST", () => {
  assert.deepEqual(planEnrichment(usst({}), report({ epc: "UGL" })), { epc: "UGL" });
  assert.deepEqual(planEnrichment(usst({ developer: null, location: null, description: null }), report({})).developer, "Leeson Group");
  assert.deepEqual(planEnrichment(usst({ epc: "Existing EPC" }), report({ epc: "UGL" })), {});
});

test("rows repeated inside the report are merged, preferring the pipeline status", () => {
  const merged = dedupeReport([report({ sheet: "Operational", reportStatus: "2019", pipeline: false, epc: "UGL" }), report({})]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].pipeline, true);
  assert.equal(merged[0].epc, "UGL");
});

test("developer comparison uses shared distinctive words", async () => {
  const { sameOwner } = await import("./pvh-report-matching.ts");
  assert.equal(sameOwner("BNRG Leeson", "Leeson Group"), true);
  assert.equal(sameOwner("ACEN Australia", "ACEN Australia Pty Ltd"), true);
  assert.equal(sameOwner("Neoen Australia", "Ark Energy"), false);
  assert.equal(sameOwner("Australia Pty Ltd", "Group Australia"), false);
});
