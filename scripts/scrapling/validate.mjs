// Read-only release check. No database imports, credentials or scan writes.
import { execFileSync } from "node:child_process";
import { fetchApprovedWithScrapling, ScraplingResponseError } from "../../artifacts/api-server/src/lib/scrapling.ts";
import { parseScraplingNewsPage } from "../../artifacts/api-server/src/lib/scrapling-news.ts";
import { getSourceRepairStrategy } from "../../artifacts/api-server/src/lib/source-repair-strategies.ts";
import { assertSourceDocument, SourceExtractionError } from "../../artifacts/api-server/src/lib/source-extraction-outcome.ts";

execFileSync(process.env.SCRAPLING_PYTHON ?? "python3", ["/app/scripts/scrapling/test_fetch.py"], {
  timeout: 30_000,
  env: { PATH: process.env.PATH, HOME: "/tmp/usst-scrapling", LANG: "C.UTF-8",
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH, SCRAPLING_BROWSER_SMOKE: "true" },
  stdio: ["ignore", "ignore", "ignore"],
});
console.log(JSON.stringify({ event: "scrapling-release-check", check: "python-and-browser-runtime", passed: true }));

execFileSync(process.execPath, ["--test", "/app/artifacts/api-server/src/lib/scrapling-news.test.mjs",
  "/app/artifacts/api-server/src/lib/scrapling.test.mjs", "/app/artifacts/api-server/src/lib/source-repair-parsers.test.mjs"], {
  timeout: 30_000, stdio: ["ignore", "ignore", "ignore"],
});
console.log(JSON.stringify({ event: "scrapling-release-check", check: "extraction-and-restriction-regressions", passed: true }));

const source = process.env.SCRAPLING_VALIDATE_SOURCE;
if (source) {
  const strategy = getSourceRepairStrategy(source);
  const url = strategy.officialUrls.at(-1);
  let successes = 0;
  let restricted = false;
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  for (const mode of ["http", "browser"]) {
    const started = performance.now();
    try {
      const page = await fetchApprovedWithScrapling(source, url, mode);
      assertSourceDocument(page.html, strategy.mode === "standard" ? "html" : "structured-html");
      const items = source === "Energy Magazine" ? parseScraplingNewsPage(page.html,
        { name: source, country: "AU", searchUrl: url }, startDate, endDate, url) : undefined;
      successes++;
      console.log(JSON.stringify({ event: "scrapling-release-check", source, mode, passed: true,
        status: page.status, bytes: Buffer.byteLength(page.html), projectCount: items?.length,
        outcome: items ? (items.length ? "success-with-results" : "success-zero-results") : "document-validated",
        startDate, endDate,
        durationMs: Math.round(performance.now() - started) }));
    } catch (error) {
      restricted = error instanceof ScraplingResponseError && error.problem === "blocked";
      console.log(JSON.stringify({ event: "scrapling-release-check", source, mode, passed: false,
        outcome: restricted ? "blocked" : error instanceof SourceExtractionError ? error.outcome : "extraction-failed",
        reason: error instanceof SourceExtractionError ? error.diagnostic : undefined,
        status: error instanceof ScraplingResponseError ? error.status : undefined,
        durationMs: Math.round(performance.now() - started) }));
      if (restricted) break; // Respect the publisher restriction; never retry it in a browser.
    }
  }
  if (!successes && !restricted) throw new Error("Scrapling live source validation failed; deployment withheld");
  if (restricted) console.log(JSON.stringify({ event: "scrapling-release-check", source,
    check: "restriction-handling", passed: true, sourceAvailable: successes > 0 }));
}
