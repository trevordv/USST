import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  WATTS_NEWS_UPDATE_EVIDENCE,
  describeWattsNewsEvidence,
  extractWattNewsProject,
  extractWattsNewsCapacities,
  findCanonicalWattsNewsMatch,
  parseWattNewsSections,
  planWattsNewsCanonicalUpdates,
} from "./watts-news.ts";
import { getProjectIneligibilityReason } from "./project-eligibility.ts";

const newsletterUrl = "https://altenergy.com.au/watt_news/show/2026-09-11";
const newsletterDate = "2026-09-11";
const html = await readFile(new URL("./fixtures/watts-news-2026-09-11.html", import.meta.url), "utf8");
const sections = parseWattNewsSections(html, newsletterUrl);
const events = sections.map((section) => extractWattNewsProject(section, newsletterDate));

function event(name) {
  const found = events.find((row) => row.name.includes(name));
  assert.ok(found, `Expected ${name} fixture section`);
  return found;
}

test("11 September DOM parser finds project articles and skips generic solar news", () => {
  assert.deepEqual(events.map((row) => row.name), [
    "Boree Solar Farm, NSW",
    "Aurora Energy Precinct Solar and Battery Storage Project Stage One",
    "Fraser Coast Solar Project, QLD",
    "Waroona Renewable Energy Project Stage One, WA",
    "Wooderson Solar Farm, QLD",
    "Narrabri Solar Farm & BESS, NSW",
    "Carwarp Solar Farm, VIC",
  ]);
  assert.equal(events.some((row) => row.name.includes("policy")), false);
  assert.equal(events.some((row) => row.name.includes("Battery Energy")), false);
  assert.equal(events.some((row) => row.name.includes("Wind Farm")), false);
});

test("Boree uses 250 MW solar and retains 200 MW / 800 MWh BESS evidence", () => {
  const boree = event("Boree");
  assert.equal(boree.solarCapacityMw, 250);
  assert.equal(boree.bessPowerMw, 200);
  assert.equal(boree.bessEnergyMwh, 800);
  assert.equal(boree.newsletterDate, "2026-09-11");
  assert.equal(WATTS_NEWS_UPDATE_EVIDENCE, "altenergy_watts_news_update");
  assert.match(describeWattsNewsEvidence(boree), /200 MW \/ 800 MWh/);
  assert.equal(getProjectIneligibilityReason({ name: boree.name, description: boree.description, capacityMw: boree.solarCapacityMw, country: boree.country }), null);
});

test("hybrid capacity extraction keeps solar MW separate from battery MW and MWh", () => {
  assert.deepEqual(extractWattsNewsCapacities("250 MW solar PV, 200 MW / 800 MWh BESS"), {
    solarCapacityMw: 250, bessPowerMw: 200, bessEnergyMwh: 800,
  });
  assert.equal(event("Aurora").solarCapacityMw, 70);
  assert.equal(event("Aurora").bessPowerMw, 140);
  assert.equal(event("Fraser Coast").solarCapacityMw, 330);
  assert.equal(event("Waroona").solarCapacityMw, 132);
  assert.equal(event("Waroona").bessPowerMw, 81.5);
  const waroona = event("Waroona");
  assert.equal(getProjectIneligibilityReason({ name: waroona.name, description: waroona.description, capacityMw: waroona.solarCapacityMw, country: waroona.country }), null);
});

test("Boree, Fraser Coast, Waroona and Wooderson strongly match canonical projects", () => {
  const canonical = [
    { id: 590, name: "Boree Solar Farm", developer: "Venn Energy", location: "Near Dubbo, NSW", capacityMw: "200", country: "AU", sourceName: "AltEnergy Australia" },
    { id: 601, name: "Fraser Coast Solar Farm", developer: "Fraser Coast Renewables", location: "QLD", capacityMw: "330", country: "AU" },
    { id: 602, name: "Waroona Renewable Energy Project", location: "WA", capacityMw: "132", country: "AU" },
    { id: 603, name: "Wooderson Solar Farm", developer: "Wooderson Energy", location: "QLD", capacityMw: "100", country: "AU" },
  ];
  assert.equal(findCanonicalWattsNewsMatch(event("Boree"), canonical)?.project.id, 590);
  assert.equal(findCanonicalWattsNewsMatch(event("Fraser Coast"), canonical)?.project.id, 601);
  assert.equal(findCanonicalWattsNewsMatch(event("Waroona"), canonical)?.project.id, 602);
  assert.equal(findCanonicalWattsNewsMatch(event("Wooderson"), canonical)?.project.id, 603);
  assert.equal(event("Wooderson").solarCapacityMw, null, "capacity remains unresolved in the article");
});

test("Boree canonical update changes stale solar capacity but preserves announcement history by construction", () => {
  const boree = event("Boree");
  const plan = planWattsNewsCanonicalUpdates(boree, {
    id: 590,
    name: "Boree Solar Farm",
    description: "200 MW solar project",
    capacityMw: "200",
    developer: "Venn Energy",
    location: "NSW",
    country: "AU",
    sourceName: "AltEnergy Australia",
    status: "announced",
  });
  assert.equal(plan.updates.capacityMw, "250");
  assert.equal(plan.updates.developer, "Venn Energy");
  assert.equal(plan.updates.status, "under_development");
  assert.equal("announcedDate" in plan.updates, false);
  assert.match(plan.decisions.capacityMw, /200 -> 250/);
});

test("Watts News cannot overwrite stronger official canonical fields", () => {
  const plan = planWattsNewsCanonicalUpdates(event("Boree"), {
    id: 590,
    name: "Boree Solar Farm",
    description: "Official planning record",
    capacityMw: "200",
    developer: "Venn Energy",
    location: "Dubbo, NSW",
    country: "AU",
    sourceName: "NSW Planning Authority",
    status: "under_development",
  });
  assert.equal(plan.updates.capacityMw, undefined);
  assert.equal(plan.updates.description, undefined);
  assert.equal(plan.decisions.capacityMw, "retained stronger official source");
});

test("Waroona dated evidence can repair a weak legacy renewable-project description", () => {
  const plan = planWattsNewsCanonicalUpdates(event("Waroona"), {
    id: 18,
    name: "Waroona Renewable Energy Project",
    description: "Large renewable energy development near Wagerup with extensive planning documentation but no technology label in this legacy summary.",
    capacityMw: "120",
    developer: "Frontier Energy",
    location: "Wagerup, WA",
    country: "AU",
    sourceName: "AltEnergy Australia",
    status: "under_development",
  });
  assert.equal(plan.updates.capacityMw, "132");
  assert.match(plan.updates.description ?? "", /132 MW solar/);
  assert.equal(plan.decisions.description, "updated with explicit missing solar-component evidence");
  assert.equal("announcedDate" in plan.updates, false);
});

test("loose substring alone cannot match a canonical project", () => {
  const boree = event("Boree");
  assert.equal(findCanonicalWattsNewsMatch(boree, [
    { id: 1, name: "Boree North Renewable Hub", location: "VIC", capacityMw: 250, country: "AU" },
  ]), null);
});

test("closed lifecycle and unchanged hard eligibility exclusions remain enforced", () => {
  assert.equal(event("Narrabri").activeLifecycle, false);
  assert.equal(event("Carwarp").activeLifecycle, false);
  assert.equal(getProjectIneligibilityReason({ name: "Standalone BESS", description: "200 MW battery", capacityMw: 200, country: "AU" }), "no-solar-component");
  assert.equal(getProjectIneligibilityReason({ name: "Coastal Wind Farm", description: "300 MW wind", capacityMw: 300, country: "AU" }), "wind-project");
  assert.equal(getProjectIneligibilityReason({ name: "Tiny Solar Farm", capacityMw: 4.99, country: "AU" }), "below-minimum-capacity");
});
