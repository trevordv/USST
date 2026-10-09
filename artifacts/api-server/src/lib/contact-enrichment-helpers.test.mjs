import assert from "node:assert/strict";
import test from "node:test";
import {
  alignSearchResults,
  linkedInTitleSeniority,
  resolveContactEmail,
  rotatingWindow,
} from "./contact-enrichment-helpers.ts";

const names = Array.from({ length: 60 }, (_, i) => `dev${i}`);

test("every developer is reached across successive runs at a fixed per-run size", () => {
  const seen = new Set();
  for (let run = 1; run <= 3; run++) {
    const window = rotatingWindow(names, 25, run);
    assert.equal(window.length, 25);
    assert.equal(new Set(window).size, 25);
    window.forEach((name) => seen.add(name));
  }
  assert.equal(seen.size, 60);
});

test("a short list is returned whole and an empty one stays empty", () => {
  assert.deepEqual(rotatingWindow(["a", "b"], 25, 7), ["a", "b"]);
  assert.deepEqual(rotatingWindow([], 25, 7), []);
  assert.equal(rotatingWindow(names, 25, undefined)[0], "dev0");
});

test("results are matched to queries by the echoed query text, not position", () => {
  const items = [{ searchQuery: { term: "q2" }, id: 2 }, { searchQuery: { term: "q1" }, id: 1 }];
  const aligned = alignSearchResults(["q1", "q2", "q3"], items);
  assert.equal(aligned[0].id, 1);
  assert.equal(aligned[1].id, 2);
  assert.equal(aligned[2], undefined);
});

test("position is used only when no result echoes its query", () => {
  const items = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(alignSearchResults(["q1", "q2"], items).map((item) => item.id), ["a", "b"]);
});

test("LinkedIn seniority ranks directors above managers above others", () => {
  assert.equal(linkedInTitleSeniority("Project Director"), 3);
  assert.equal(linkedInTitleSeniority("Head of Projects"), 3);
  assert.equal(linkedInTitleSeniority("Development Manager"), 2);
  assert.equal(linkedInTitleSeniority("Project Engineer"), 1);
});

test("a blank email never replaces a stored one and is never stored", () => {
  assert.equal(resolveContactEmail("", "a@dev.com"), "a@dev.com");
  assert.equal(resolveContactEmail(null, null), null);
  assert.equal(resolveContactEmail("  ", undefined), null);
  assert.equal(resolveContactEmail("new@dev.com", "old@dev.com"), "new@dev.com");
});
