# Optional Scrapling acquisition for USST

## Scope and acceptance

Add a local transport for selected existing public sources without changing the
34-source registry, parsers, project eligibility, dates, contacts, API or database.
Acceptance: successful direct extraction (including zero) never invokes Scrapling;
technical failure can use Scrapling before paid transports; unavailable or unusable
Scrapling keeps existing fallbacks; recovered URLs are not fetched again by
Firecrawl; source-health records retain the acquisition method.

This change is based on the deployed `migration/railway-supabase` branch, not
legacy `main`. Only USST is modified. No shared template changes.

## Runtime and boundaries

- Disabled by default. Both `SCRAPLING_ENABLED=true` and an exact source name in
  comma-separated `SCRAPLING_SOURCES` are required.
- Direct/RSS/official integrations stay first. Two failed exact configured URLs
  per source maximum; one HTTP attempt, then at most one browser attempt if the
  document cannot be parsed. No retries, new sources or discovered-page crawling.
- Authenticated, registry-inaccessible, AEMO-workbook and EPBC-ArcGIS paths are
  excluded. Authentication, challenge and rate-limit failures do not invoke it.
- One Python subprocess across concurrent sources. A busy caller immediately
  keeps its existing fallback. Each process has a 25-second deadline, group cleanup
  and bounded output; HTML is limited to 2 MB.
- HTTP redirects are disabled. Browser requests stay on the exact configured
  HTTPS host and public DNS addresses, with service workers blocked. No external
  subresources, proxy, login, CAPTCHA solver, stealth fetcher or cookies supplied.
- The child receives only runtime paths and locale. Database/provider credentials
  and application secrets are not inherited. Raw Python diagnostics are discarded.
- HTML remains untrusted and goes through existing source-document validation,
  deterministic parsing, source/date/eligibility rules and content hashing.
- Successful zero results stop escalation. Unresolved portal documents retain
  existing normalisation. No additional OpenAI calls are introduced.

Maximum additional local work per selected source: two URLs x two processes,
up to 100 seconds if both documents need a browser. This is an upper bound,
not a performance claim. No scraper API fees are added, but Railway CPU/memory
and browser build costs apply. Savings and source quality are not yet measured.

## Build and release

`Dockerfile.scrapling` is an optional complete build for the existing service:
Node 24, Python, locked Scrapling 0.4.15 dependencies and Playwright Chromium.
It preserves the pnpm production build and start command. The default Railway
configuration is unchanged until review and release are approved.

Before enabling:
1. Build the optional image with public Vite settings as build arguments
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `BASE_PATH`). Never pass
   server credentials as build arguments.
2. Verify the Docker image and browser startup. Select `Dockerfile.scrapling`
   for the existing `usst-migration-test` service, retaining runtime secrets,
   domain, healthcheck and branch configuration. Do not reactivate retired `usst-app`.
3. Deploy with Scrapling disabled, check `/api/healthz`, authentication and logs.
4. Enable only `SCRAPLING_SOURCES=Energy Magazine` initially, with
   `SCRAPLING_ENABLED=true`. Perform a bounded staging scan and compare source
   acquisition method, qualifying records, runtime, provider calls and cost with
   the disabled baseline. Check failure and empty paths. Expand only after evidence.
5. Roll back immediately by setting `SCRAPLING_ENABLED=false`; existing
   acquisition remains available. Revert the code/build change if needed. No migration.

## Verification limits

Local dependency installation, Python worker protocol tests, Node adapter/scan
regressions, typecheck and production build were run. Public Energy Magazine
retrieval failed DNS resolution in the authoring environment. Chromium download
failed with a truncated/non-ZIP payload. Docker is unavailable here. Therefore
the browser/container and live source efficiency are **not verified**, and the
feature must stay disabled until the release checks above pass.

The ordinary frozen pnpm install encountered the existing workspace build-script
approval setting for esbuild. A frozen install with `--ignore-scripts` passed and
the real application build succeeded. The workspace policy was left unchanged.
