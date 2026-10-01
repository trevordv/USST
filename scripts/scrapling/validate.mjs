// Read-only release check. No database imports, credentials or scan writes.
import { execFileSync } from "node:child_process";
import { fetchApprovedWithScrapling } from "../../artifacts/api-server/src/lib/scrapling.ts";
import { getSourceRepairStrategy } from "../../artifacts/api-server/src/lib/source-repair-strategies.ts";
import { assertSourceDocument } from "../../artifacts/api-server/src/lib/source-extraction-outcome.ts";

execFileSync(process.env.SCRAPLING_PYTHON ?? "python3", ["/app/scripts/scrapling/test_fetch.py"], {
  timeout: 30_000,
  env: { PATH: process.env.PATH, HOME: "/tmp/usst-scrapling", LANG: "C.UTF-8",
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH, SCRAPLING_BROWSER_SMOKE: "true" },
  stdio: ["ignore", "ignore", "ignore"],
});
console.log(JSON.stringify({ event: "scrapling-release-check", check: "python-and-browser-runtime", passed: true }));

const source = process.env.SCRAPLING_VALIDATE_SOURCE;
if (source) {
  const strategy = getSourceRepairStrategy(source);
  const url = strategy.officialUrls.at(-1);
  let successes = 0;
  for (const mode of ["http", "browser"]) {
    const started = performance.now();
    try {
      const page = await fetchApprovedWithScrapling(source, url, mode);
      assertSourceDocument(page.html, strategy.mode === "standard" ? "html" : "structured-html");
      successes++;
      console.log(JSON.stringify({ event: "scrapling-release-check", source, mode, passed: true,
        status: page.status, bytes: Buffer.byteLength(page.html), durationMs: Math.round(performance.now() - started) }));
    } catch {
      console.log(JSON.stringify({ event: "scrapling-release-check", source, mode, passed: false,
        durationMs: Math.round(performance.now() - started) }));
    }
  }
  if (!successes) throw new Error("Scrapling live source validation failed; deployment withheld");
}
