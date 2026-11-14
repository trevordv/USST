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

`Dockerfile.scrapling` is the deployed build for the existing service:
Node 24, Python, locked Scrapling 0.4.15 dependencies and Playwright Chromium.
It preserves the pnpm production build and application runtime. `railway.json`
selects this image and runs read-only browser/source checks before deployment.
A failed release check withholds the replacement deployment.

The check runs extraction/restriction regression tests and, for Energy Magazine,
the same deterministic parser and bounded date-window logic used by the scan.
A live publisher restriction is reported as `blocked` / `sourceAvailable: false`,
not successful scraping. When the tested adapter correctly rejects that explicit
restriction, it does not withhold unrelated application fixes. Runtime failures
and unusable/parser failures still withhold a release without a successful mode.

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

## Release evidence — 1 October 2026

- PR #51 (adapter) and PR #52 (runtime/release checks) were merged into
  `migration/railway-supabase` with explicit user authorisation.
- GitHub CI and Migration Check passed; the API suite contains 268 passing tests.
- Railway Docker build completed successfully, including all three Python tests
  and a real Chromium synthetic-page smoke test (no skip).
- Deployment `804acde3-2241-44b7-94e4-d29b69964279` passed pre-deploy runtime checks
  and live Energy Magazine validation, then reached SUCCESS.
- HTTP transport: status 200, 201,598 bytes, 2,602 ms. Browser transport: status 200,
  203,936 bytes, 2,423 ms. Both documents passed the configured parser-shape check.
- Application health returned HTTP 200; unauthenticated protected API access
  returned HTTP 401.
- Initial enablement is limited to Energy Magazine. Other sources retain their
  existing acquisition paths. No database writes or paid-provider calls were
  needed for these read-only release checks.

These single-request timings demonstrate working acquisition, not a measured
cost saving or improvement in whole-scan quality. Full scan performance and
qualifying-project outcomes remain observable through the existing source-health
records; compare them during normal use before extending the selected source set.

Local authoring DNS/Chromium-download limitations were resolved for release by
performing the real checks on Railway. The Docker build uses a frozen pnpm install
with `--ignore-scripts`; GitHub's standard frozen install also passed.

## Scan 122 remediation — 1 October 2026

Scan 122 recorded Scrapling HTTP and browser `parse-failed` attempts. The page
bodies were not retained, so their exact contents cannot be reconstructed from
those logs. Subsequent direct requests to the same approved feed/search URLs
returned HTTP 403 with the publisher's explicit AI-restriction page. The shared
classifier previously treated this as a plain public 403, and did not recognize
the same restriction text when delivered with HTTP 200. Scrapling also discarded
the typed response problem, weakening later diagnosis.

A live Firecrawl basic-proxy check retrieved the public search page. Its HTML
passed the existing news parser; extracted dated solar candidates were historical
and none fell within 28 September–1 October. This proves zero current candidates
is possible without a parser failure, not that there are additional projects.

Remediation recognizes the publisher's restriction heading plus WAF/support
evidence, retains typed Scrapling response failures, and suppresses browser retry
after a restriction. Firecrawl's HTML/markdown restriction responses are also
rejected before caching, so an access barrier cannot become a successful zero.
The production and release news-parser paths are shared.
A zero is accepted as historical only when the parser reads dated candidates
and every candidate is outside the requested window; unknown dates and unreadable
structures remain unresolved. Safe diagnostic codes distinguish missing HTML
structure, incomplete RSS, JS shells and unresolved records without logging bodies.

Before extending Scrapling to another approved source, validate its actual parser
with a representative readable page, a known candidate, valid zero, changed shape
and access-restriction fixtures. Inspect its first bounded scan's provenance and
qualifying results. No test can prevent a publisher changing markup or access
rules; detect those changes separately and retain the bounded existing fallback.
Publisher permission/allowlisting is required if direct access remains restricted.
