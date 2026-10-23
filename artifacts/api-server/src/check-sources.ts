export {};

/**
 * Source health check — tests every approved scan source from the deployed
 * environment without writing to the database.
 *
 *   pnpm --filter @workspace/api-server run check-sources
 *   pnpm --filter @workspace/api-server run check-sources -- --since=2026-09-01 --only="PV Magazine"
 *   pnpm --filter @workspace/api-server run check-sources -- --with-fallbacks   (may spend paid credits)
 *   ... -- --json                                                            (machine-readable output)
 *
 * On Railway (runs inside the deployed service):  railway ssh, then  node dist/check-sources.mjs
 */
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

if (!flag("with-fallbacks")) {
  // Direct acquisition only: prove each source works without paying providers.
  for (const key of ["FIRECRAWL_API_KEY", "APIFY_API_TOKEN", "BRIGHT_DATA_API_KEY", "OPENAI_API_KEY", "BROWSE_AI_API_KEY"]) delete process.env[key];
}
process.env.LOG_LEVEL ??= flag("verbose") ? "info" : "error";

const since = value("since") ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
const only = value("only")?.split(",").map((item) => item.trim()).filter(Boolean);

const { checkScanSources } = await import("./lib/scraper");
const started = Date.now();
const results = await checkScanSources({ startDate: since, only });
results.sort((a, b) => a.sourceName.localeCompare(b.sourceName));

const healthy = (outcome: string) => outcome === "success-with-results" || outcome === "success-zero-results";
if (flag("json")) {
  console.log(JSON.stringify({ since, withFallbacks: flag("with-fallbacks"), results }, null, 2));
} else {
  const pad = (text: string, width: number) => text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);
  console.log(`USST source health check — window ${since} to today — ${flag("with-fallbacks") ? "with paid fallbacks" : "direct only (no paid fallbacks)"}\n`);
  console.log(`${pad("Source", 34)} ${pad("Result", 22)} ${pad("Method", 22)} ${"Found".padStart(6)} ${"Kept".padStart(5)} ${"Secs".padStart(6)}  Problem`);
  for (const row of results) {
    console.log(`${healthy(row.outcome) ? "✓" : "✗"} ${pad(row.sourceName, 32)} ${pad(row.outcome, 22)} ${pad(row.acquisitionMethod, 22)} ${String(row.candidateCount).padStart(6)} ${String(row.qualifyingProjectCount).padStart(5)} ${(row.durationMs / 1000).toFixed(1).padStart(6)}  ${row.failureCategory ?? ""}`);
  }
  const ok = results.filter((row) => healthy(row.outcome)).length;
  console.log(`\n${ok}/${results.length} sources acquired successfully in ${Math.round((Date.now() - started) / 1000)}s.`);
  console.log("\"success-zero-results\" means the source was read correctly but had nothing in the window.");
}
process.exit(0);
