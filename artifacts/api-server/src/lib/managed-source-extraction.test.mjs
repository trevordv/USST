import assert from "node:assert/strict";
import test from "node:test";
import { classifyManagedZeroResult } from "./managed-source-extraction.ts";

test("Phase 1 guidance/current lists can report a legitimate zero", () => {
  assert.equal(
    classifyManagedZeroResult(
      "Planning Victoria",
      "# Solar energy facilities in Victoria\nPlanning guidance for permit applicants.",
    ),
    "legitimate-zero",
  );
  assert.equal(
    classifyManagedZeroResult(
      "QLD Coordinator-General",
      "# Current coordinated projects\nBig Rocks Weir\nCoal project",
    ),
    "legitimate-zero",
  );
});

test("Phase 1 JS, category and detail-page portals do not disguise parser misses as valid zero", () => {
  const cases = [
    ["QLD Planning – Renewable Energy", "# SARA submissions portal\n[iframe]"],
    ["NZ Fast-track", "# Projects\nSearch projects"],
    [
      "NZ EPA – Fast-track Projects",
      "| Project name | Description | Status |\n| Annie's Way Solar Farm | construct solar | Approved |",
    ],
    [
      "NZ EPA – RMA Proposals",
      "# RMA proposals\nView current proposals in consultations",
    ],
    [
      "NZ EPA – Public Consultations",
      "# Public consultations\nOpen for submission",
    ],
    [
      "NZ Ministry for the Environment",
      "# Fast-track projects\nView a list of listed projects",
    ],
    ["WA EPA", "# Proposal search\nSearch filters"],
    [
      "Energy Magazine",
      "# New Solar Farm approved\nA solar article without parsable evidence",
    ],
  ];
  for (const [source, content] of cases)
    assert.equal(
      classifyManagedZeroResult(source, content),
      "unresolved",
      source,
    );
});

test("an explicit portal empty state remains a valid zero", () => {
  assert.equal(
    classifyManagedZeroResult(
      "NZ EPA – Public Consultations",
      "No current consultations",
    ),
    "legitimate-zero",
  );
});
