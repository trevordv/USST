import assert from "node:assert/strict";
import test from "node:test";
import { extractProjectCapacityEvidence } from "./source-text.ts";
import { matchKnownCanonicalAlias, sourceEventKey } from "./project-reconciliation.ts";

const canonical = [
  { id: 570, name: "Narrogin East Hybrid Project", developer: "Lightsource bp", location: "Narrogin, WA", country: "AU" },
  { id: 554, name: "Narrogin Solar Farm & BESS", developer: "TagEnergy / ARP Australian Solar", location: "Narrogin, WA", country: "AU" },
];

const article = "Lightsource bp seeks green light for 600 MW hybrid project in WA. The Narrogin East Renewable Energy Project comprises 150 MW solar, 250 MW wind and a 200 MW BESS. ACE Power's approved Narrogin Solar Farm is a separate 200 MWdc solar and 200 MW / 800 MWh BESS development south of Narrogin.";

test("RUN-0119 Narrogin aliases resolve to their two distinct canonical records", () => {
  assert.equal(matchKnownCanonicalAlias({ name: "Narrogin East Renewable Energy Project", country: "AU" }, canonical)?.canonicalProjectId, 570);
  assert.equal(matchKnownCanonicalAlias({ name: "Narrogin East Renewable Energy Precinct", country: "AU" }, canonical)?.canonicalProjectId, 570);
  assert.equal(matchKnownCanonicalAlias({ name: "Ace Power's approved Narrogin Solar Farm", country: "AU" }, canonical)?.canonicalProjectId, 554);
  assert.notEqual(matchKnownCanonicalAlias({ name: "Narrogin East Renewable Energy Project", country: "AU" }, canonical)?.canonicalProjectId,
    matchKnownCanonicalAlias({ name: "Ace Power's approved Narrogin Solar Farm", country: "AU" }, canonical)?.canonicalProjectId);
});

test("RUN-0119 capacity evidence separates solar, wind, BESS MW and BESS MWh", () => {
  assert.deepEqual(extractProjectCapacityEvidence(article), { solarMw: 150, windMw: 250, bessMw: 200, bessMwh: 800 });
  assert.equal(extractProjectCapacityEvidence("A 600 MW hybrid project with wind, solar and battery storage.").solarMw, null);
});

test("source event identity deduplicates the same canonical article/date but not another date", () => {
  const first = sourceEventKey(570, "https://www.pv-magazine-australia.com/2026/09/23/story/#narrogin-east", "2026-09-23");
  assert.equal(first, sourceEventKey(570, "https://www.pv-magazine-australia.com/2026/09/23/story/", "2026-09-23"));
  assert.notEqual(first, sourceEventKey(570, "https://www.pv-magazine-australia.com/2026/09/23/story/", "2026-09-24"));
});
