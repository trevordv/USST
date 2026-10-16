import assert from "node:assert/strict";
import test from "node:test";
import { findLatestAemoWorkbookUrl } from "./aemo-workbook.ts";

const page = "https://www.aemo.com.au/energy-systems/electricity/national-electricity-market-nem/nem-forecasting-and-planning/forecasting-and-planning-data/generation-information";

test("picks the newest quarterly NEM Generation Information workbook on aemo.com.au", () => {
  const html = `
    <a href="/-/media/files/electricity/nem/planning_and_forecasting/generation_information/2026/nem-generation-information-july-2026.xlsx?rev=abc&amp;sc_lang=en">July</a>
    <a href="/-/media/files/electricity/nem/planning_and_forecasting/generation_information/2026/nem-generation-information-october-2026.xlsx?rev=def&amp;sc_lang=en">October</a>
    <a href="/-/media/files/electricity/nem/planning_and_forecasting/generation_information/2025/nem-generation-information-november-2025.xlsx">Nov 2025</a>
    <a href="https://evil.example/nem-generation-information-december-2026.xlsx">bad host</a>
    <a href="/-/media/files/other/connection-scorecard-december-2026.xlsx">other workbook</a>`;
  assert.equal(findLatestAemoWorkbookUrl(html, page),
    "https://www.aemo.com.au/-/media/files/electricity/nem/planning_and_forecasting/generation_information/2026/nem-generation-information-october-2026.xlsx?rev=def&sc_lang=en");
});

test("returns null when the page links no generation workbook", () => {
  assert.equal(findLatestAemoWorkbookUrl("<a href='/report.pdf'>pdf</a>", page), null);
});
