import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getProjectIneligibilityReason } from "./project-eligibility.ts";

test("Brave is restricted to admin contact enrichment and is not a scan source", async () => {
  const [scraper, projectsRoute] = await Promise.all([
    readFile(new URL("./scraper.ts", import.meta.url), "utf8"),
    readFile(new URL("../routes/projects.ts", import.meta.url), "utf8"),
  ]);
  const enrichmentStart = scraper.indexOf("export async function enrichMissingContacts");
  const enrichmentEnd = scraper.indexOf("export async function startEnrichment");
  assert.ok(enrichmentStart > 0 && enrichmentEnd > enrichmentStart);
  assert.doesNotMatch(scraper.slice(0, enrichmentStart), /await researchDeveloperWithBrave\(/);
  assert.match(scraper.slice(enrichmentStart, enrichmentEnd), /await researchDeveloperWithBrave\(/);
  assert.doesNotMatch(scraper.match(/const SOURCES:[\s\S]*?\n\];/)?.[0] ?? "", /Brave Search/);
  assert.match(projectsRoute, /router\.post\("\/projects\/enrich-contacts", requireAdmin/);
  assert.match(projectsRoute, /admitCostlyOperation\("enrichment"/);
});

test("project research is admin-only, requires an existing project, and cannot mutate projects", async () => {
  const routeSource = await readFile(new URL("../routes/projects.ts", import.meta.url), "utf8");
  const start = routeSource.indexOf('router.post("/projects/:id/research"');
  const end = routeSource.indexOf("// PATCH /projects/:id", start);
  const route = routeSource.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(route, /requireAdmin/);
  assert.match(route, /researchProjectWithBrave/);
  assert.match(route, /admitCostlyOperation\("project-research"/);
  assert.ok(route.indexOf('res.status(404).json({ error: "Project not found" })') < route.indexOf('admitCostlyOperation("project-research"'));
  assert.doesNotMatch(route, /db\.(?:insert|update|delete)/);
  assert.match(route, /finally[\s\S]*admission\.release\(\)/);
});

test("Brave discovery cannot weaken hard project eligibility rules", () => {
  const cases = [
    { name: "Brave Tiny Solar Farm", description: "Brave search snippet", capacityMw: 4.99, country: "AU" },
    { name: "Brave Wind Farm", description: "Wind turbine project", capacityMw: 100, country: "AU" },
    { name: "Brave Standalone BESS", description: "Battery storage only", capacityMw: 100, country: "AU" },
    { name: "Brave Solar Farm", description: "Solar project", capacityMw: 100, country: "US" },
  ];
  assert.deepEqual(cases.map(getProjectIneligibilityReason), [
    "below-minimum-capacity",
    "wind-project",
    "no-solar-component",
    "outside-target-region",
  ]);
});

test("existing provider and authenticated-source integrations remain wired", async () => {
  const scraper = await readFile(new URL("./scraper.ts", import.meta.url), "utf8");
  assert.match(scraper, /callLushaBulkEnrich/);
  assert.match(scraper, /callLushaProspecting/);
  assert.match(scraper, /process\.env\.OPENAI_API_KEY/);
  assert.match(scraper, /scrapeAltEnergy/);
  assert.match(scraper, /scrapeLuvi/);
});
