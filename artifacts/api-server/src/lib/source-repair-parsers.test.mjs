import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySourceResponse,
  parseAemoGenerationRows,
  parseOfficialProjectHtml,
} from "./source-repair-parsers.ts";
import { filterEligibleScanProjects } from "./project-eligibility.ts";

test("classifies access-control, HTTP, invalid-content, and usable responses for Railway diagnostics", () => {
  assert.equal(
    classifySourceResponse(403, "text/html", "Forbidden"),
    "blocked",
  );
  assert.equal(
    classifySourceResponse(
      200,
      "text/html",
      "Request unsuccessful. Incapsula incident",
    ),
    "blocked",
  );
  assert.equal(
    classifySourceResponse(502, "text/html", "Bad gateway"),
    "http-error",
  );
  assert.equal(
    classifySourceResponse(200, "image/png", "PNG"),
    "invalid-content",
  );
  assert.equal(
    classifySourceResponse(200, "text/html", "<main>Official projects</main>"),
    null,
  );
});

test("extracts qualifying solar projects from an official HTML table without standalone BESS", () => {
  const html = `
    <table>
      <tr><th>Project</th><th>Proponent</th><th>Region</th><th>Capacity</th></tr>
      <tr><td><a href="/projects/river-solar">River Solar Farm</a></td><td>Sun Co</td><td>Waikato</td><td>150 MW proposed solar</td></tr>
      <tr><td>Harbour Battery</td><td>Store Co</td><td>Auckland</td><td>300 MW standalone BESS</td></tr>
      <tr><td>Tiny Solar Array</td><td>Town</td><td>Otago</td><td>4 MW solar</td></tr>
    </table>`;
  const candidates = parseOfficialProjectHtml(
    html,
    "https://official.example.govt.nz/projects/",
  ).map((candidate) => ({ ...candidate, country: "NZ" }));
  const eligible = filterEligibleScanProjects(candidates);
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0].name, "River Solar Farm");
  assert.equal(eligible[0].capacityMw, 150);
  assert.equal(
    eligible[0].sourceUrl,
    "https://official.example.govt.nz/projects/river-solar",
  );
});

test("parses and deduplicates proposed solar rows in the official AEMO workbook shape", () => {
  const rows = [
    ["Generator information"],
    [
      "Site Name",
      "Site Owner",
      "Region",
      "Max Site Capacity (AC)",
      "Technology Type",
      "Technology Detail",
      "Aggregated Nameplate Capacity (MW AC)",
      "Commitment Status",
    ],
    [
      "Darling Solar Farm",
      "Solar Co",
      "NSW1",
      180,
      "Solar",
      "PV tracking",
      175,
      "Publicly Announced",
    ],
    [
      "Darling Solar Farm",
      "Solar Co",
      "NSW1",
      170,
      "Solar",
      "PV tracking",
      165,
      "Publicly Announced",
    ],
    [
      "Operating Solar Farm",
      "Old Co",
      "QLD1",
      90,
      "Solar",
      "PV",
      90,
      "In Service",
    ],
    [
      "Windy Plains",
      "Wind Co",
      "VIC1",
      300,
      "Wind",
      "Turbine",
      300,
      "Publicly Announced",
    ],
    ["Tiny Solar", "Small Co", "SA1", 4, "Solar", "PV", 4, "Committed"],
  ];
  const candidates = parseAemoGenerationRows(
    rows,
    "https://www.aemo.com.au/generation.xlsx",
    "2026-08-12",
  ).map((candidate) => ({ ...candidate, country: "AU" }));
  assert.equal(candidates.length, 2);
  const eligible = filterEligibleScanProjects(candidates);
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0].name, "Darling Solar Farm");
  assert.equal(eligible[0].capacityMw, 180);
  assert.equal(eligible[0].location, "NSW");
  assert.match(eligible[0].sourceUrl, /#site=Darling%20Solar%20Farm$/);
});

test("fails clearly if AEMO changes the required workbook columns", () => {
  assert.throws(
    () =>
      parseAemoGenerationRows(
        [["Name", "Capacity"]],
        "https://www.aemo.com.au/file.xlsx",
        "2026-08-12",
      ),
    /header row not found/,
  );
});
