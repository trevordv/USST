import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

test("scanner and contact enrichment remain route-lazy", async () => {
  const [scansRoute, projectsRoute] = await Promise.all([
    readSource("../routes/scans.ts"),
    readSource("../routes/projects.ts"),
  ]);

  assert.match(scansRoute, /import\("\.\.\/lib\/scraper"\)/);
  assert.match(projectsRoute, /import\("\.\.\/lib\/scraper"\)/);
  assert.doesNotMatch(scansRoute, /^import .* from "\.\.\/lib\/scraper"/m);
  assert.doesNotMatch(projectsRoute, /^import .* from "\.\.\/lib\/scraper"/m);
});

test("the combined scanner keeps XLSX deferred and source timing enabled", async () => {
  const scraper = await readSource("./scraper.ts");

  assert.doesNotMatch(scraper, /^import .* from "xlsx"/m);
  assert.match(scraper, /await import\("xlsx"\)/);
  assert.match(scraper, /GENERIC_SCAN_WORKERS/);
  assert.match(scraper, /CONTACT_DOMAIN_WORKERS/);
  assert.match(
    scraper,
    /mapWithConcurrency\(\s*SOURCES,\s*GENERIC_SCAN_WORKERS/,
  );
  assert.match(scraper, /progressUpdate = progressUpdate\.then/);
  assert.match(
    scraper,
    /for \(const scraped of genericResults\) allScraped\.push\(\.\.\.scraped\)/,
  );
  assert.match(
    scraper,
    /durationMs: Math\.round\(performance\.now\(\) - startedAt\)/,
  );
  assert.match(
    scraper,
    /durationMs: Math\.round\(performance\.now\(\) - scanStartedAt\)/,
  );
  assert.match(
    scraper,
    /validateSourceRepairStrategies\(CONFIGURED_SCAN_SOURCE_NAMES\)/,
  );
});

test("EPBC batching, auth-write throttling, gzip, and cache policy remain wired", async () => {
  const [epbcRoute, authMiddleware, app] = await Promise.all([
    readSource("../routes/epbc.ts"),
    readSource("../middlewares/supabase-auth.ts"),
    readSource("../app.ts"),
  ]);

  assert.match(epbcRoute, /EPBC_UPSERT_BATCH_SIZE = 200/);
  assert.match(epbcRoute, /onConflictDoUpdate/);
  assert.match(
    authMiddleware,
    /shouldRefreshLastSeen\(allowedUser\.lastSeenAt, now\)/,
  );
  assert.match(app, /compression\(\{ threshold: 1024 \}\)/);
  assert.match(app, /staticCacheControl\(filePath, publicDir\)/);
});
