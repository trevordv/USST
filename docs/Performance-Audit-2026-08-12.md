# USST Performance and Efficiency Audit

Date: 12 August 2026
Branch: `codex/performance-audit`
Base: `migration/railway-supabase`

## Executive summary

The largest avoidable costs were not CPU-heavy React rendering. They were:

1. an uncompressed, single-file frontend bundle;
2. a 5.19 MB eagerly loaded API entry containing scanner and XLSX code;
3. one project search request per keystroke and overly broad React Query invalidation;
4. full-row transfer and in-process aggregation for Dashboard statistics;
5. N+1 EPBC persistence (`SELECT` plus `INSERT`/`UPDATE` per record);
6. strictly sequential execution of 32 independent generic scanner sources;
7. sequential developer-domain contact discovery; and
8. an `app_users.last_seen_at` write on every authenticated API request.

The implemented changes are deliberately bounded and preserve the existing product rules, all 34 sources, EPBC behavior, explicit contact enrichment, Supabase Auth, and historical data. No database schema or production data was changed.

## Measurement method and limitations

- Production Vite and esbuild outputs were measured before and after on the same checkout and runtime.
- Actual local HTTP transfer sizes were measured from the built Express service using the same request headers.
- Cold-start-to-health was sampled seven times per build using the production server and an intentionally refused local PostgreSQL endpoint. This measures module/process overhead but not Railway or Supabase network latency.
- Scanner scheduling was measured with 32 identical synthetic asynchronous waits. It validates scheduler behavior, not third-party response times.
- Database round-trip improvements are derived from the executed query structure. A production `DATABASE_URL` was not available, so no production `EXPLAIN (ANALYZE, BUFFERS)` was run.
- Paid or state-changing production operations (full scanner, EPBC sync, Apify, Lusha, OpenAI enrichment) were not invoked during the audit.

## Before and after evidence

| Area | Before | After | Evidence |
|---|---:|---:|---|
| Initial frontend JS, raw | 449,323 bytes | 329,127 bytes | 26.8% smaller through route splitting |
| Initial frontend JS, actual local transfer with `Accept-Encoding: gzip` | 449,323 bytes | 106,494 bytes | 76.3% fewer transferred bytes; baseline did not compress |
| Initial frontend JS, Vite gzip estimate | 139.92 kB | 106.49 kB | 23.9% smaller compressed entry |
| API eager code | 5,190,190 bytes | 2,798,955 bytes | 46.1% less eagerly imported code; scanner/XLSX are deferred |
| Local cold-start median, seven runs | 542.4 ms | 544.0 ms | No measurable improvement; no startup-speed claim is made |
| 32-source synthetic scheduler | 985 ms sequential | 229 ms, four workers | 77% reduction in synthetic wait; theoretical external-bound reduction approaches 75% |
| Projects search requests for 10 uninterrupted keystrokes | up to 10 | 1 after 300 ms pause | Debounced query input |
| Dashboard result transferred to Node | every matching project row | one summary row plus country/status groups | Aggregation moved to PostgreSQL |
| EPBC sync persistence for `N` records | up to `2N` statements | `1 + ceil(N/200)` statements normally | Existing-key read plus 200-row atomic upserts |
| EPBC metadata | 2 sequential queries | 1 aggregate query | `max(scraped_at)` and `count(*)` combined |
| Auth activity writes | 1 write per API request | at most 1 per user per 5 minutes, plus first identity link | Authorization checks remain per request |

The optimized initial asset also receives `Cache-Control: public, max-age=31536000, immutable`; HTML revalidates so deployments are not pinned to stale entry documents.

## Findings and implemented changes

### Frontend

**Root causes**

- All authenticated pages were imported eagerly into the initial bundle.
- React Query considered data stale immediately, causing avoidable refetches during short navigation cycles.
- Projects search sent a new API request for each character.
- Contact enrichment completion invalidated every query in the application.
- Projects created a separate tooltip context provider for each table row.

**Changes**

- Lazy-loaded Dashboard, Projects, Project Detail, Scans, Scan Detail, and EPBC routes.
- Added a 30-second default query `staleTime`; explicit scanner/enrichment polling remains active.
- Debounced Projects search by 300 ms.
- Narrowed enrichment invalidation to the Projects query family.
- Reused one Projects tooltip provider.

Pagination and list virtualization were not added because current production cardinality and browser render timing were unavailable. Adding a contract and navigation model without evidence would add risk. Reassess when a typical list response exceeds roughly 1 MB, table rendering exceeds 100 ms, or project/EPBC counts reach the low thousands.

### API and database access

**Root causes**

- Dashboard loaded all matching project columns and aggregated in JavaScript.
- EPBC metadata used two sequential queries.
- Scan history sorted ascending and reversed in Node.
- Scan detail waited for scan and lineage queries sequentially.
- EPBC live sync selected and wrote each record individually.

**Changes**

- Moved Dashboard counts and capacity totals to PostgreSQL. The summary, country grouping, and status grouping execute concurrently and transfer only aggregate rows while preserving legacy country keys.
- Combined EPBC metadata into one aggregate query.
- Sorted scan history descending in PostgreSQL.
- Ran independent scan and lineage reads concurrently.
- Replaced EPBC live-sync N+1 persistence with atomic upserts in batches of 200. A failed batch falls back to isolated per-record upserts, preserving failure isolation.

The manual XLSX importer still processes rows individually. It is an explicit, uncommon administrative operation, and its row-level failure/count semantics are more important than optimizing it without a production-size workbook benchmark.

### Authentication

**Root causes**

- Each protected API request validates the bearer token with Supabase, reads the application allowlist, and wrote `last_seen_at`/`updated_at`.
- The write created avoidable WAL, table churn, and connection work during page loads with multiple parallel API requests.

**Changes**

- Supabase token validation and active allowlist checks remain on every request.
- Identity mismatch checks are unchanged.
- Only the activity write is throttled to once per five minutes per user; initial identity linking still writes immediately.

Short-lived authorization caching or local JWT/JWKS validation was deliberately not introduced because it could delay user deactivation or change security semantics. That should be a separate security-reviewed change with revocation requirements and production latency traces.

### Scanner

**Root causes**

- The 32 generic sources ran strictly one after another even though they are independent.
- A redundant full-table source-URL query ran before another, richer full-table project query.
- Source logs reported outcomes but not elapsed time.

**Changes**

- Added a tested fixed-worker mapper and run generic sources with four workers.
- Preserved source result ordering so duplicate precedence is deterministic and matches registry order.
- Serialized progress writes so concurrent completion cannot make the visible counter move backwards.
- Removed the redundant projects query.
- Added source and overall scan duration fields to existing outcome logs.

Browse.AI work inside a source remains sequential, and per-source URL concurrency remains as previously defined. OpenAI fallback conditions and the approved source registry are unchanged. The registry remains exactly 32 generic sources plus AltEnergy and LUVI.

### Contact enrichment

**Root causes**

- Known developer domains were processed one developer at a time, with up to nine paths and a 10-second timeout per path.
- The initial project read fetched unused descriptions and other columns.

**Changes**

- Developer groups now use three bounded workers; paths within one developer remain sequential and stop at the first valid contact.
- The database selects only fields needed by enrichment.
- Existing grouping continues to deduplicate paid Apify/Lusha work by developer during a run.
- Added overall enrichment timing.

No persistent negative-result cache was added. Such a cache could save credits across runs but needs schema, expiry, retry, and operator-visibility decisions to avoid suppressing newly available contacts.

### EPBC

- ArcGIS remains the authoritative structured source.
- ArcGIS pagination and year filters remain unchanged because each page depends on the preceding offset and the current page size is already efficient.
- Successful ArcGIS records remain authoritative; OpenAI cannot append unmatched records.
- OpenAI detail supplementation and outage fallback behavior remain unchanged to preserve Issue #6 functionality.
- Database persistence is now batched and timed.

### Railway runtime and delivery

**Changes**

- Enabled HTTP compression for responses over 1 kB.
- Added immutable caching for fingerprinted Vite assets and revalidation for HTML/non-fingerprinted files.
- Enabled API code splitting.
- Scanner, XLSX parsing, and Nodemailer load only when invoked.
- Startup stale-scan and stale-enrichment recovery queries now run concurrently.

The local startup median did not improve, despite lower eager code volume, so no cold-start improvement is claimed. The smaller entry should reduce parse/memory work, but Railway measurements are required to quantify that effect.

The application already uses a single process-wide `pg.Pool`; it does not create a connection per request. The deployment should use Supabase's pooled connection endpoint when Railway is long-lived but may scale/restart, and pool size should be checked against the Supabase plan. Railway and Supabase regions were not available in repository configuration. They should be colocated; cross-region RTT is paid by every auth/database operation and can dominate all application-level query improvements.

There is no measured justification for splitting the app into multiple Railway services. A split would add network hops and deployment complexity while scanner/enrichment work is already asynchronous.

## Recommended indexes (not applied)

No index migration is included because production query plans and table sizes were unavailable. Run `EXPLAIN (ANALYZE, BUFFERS)` in a non-production clone before applying these.

| Index | Query improved | Expected benefit | Migration required |
|---|---|---|---|
| `create index projects_announced_date_idx on public.projects (announced_date desc);` | Projects list/export ordering and date-range Dashboard filters | Avoids a full sort and can reduce scanned rows for date windows; likely negligible at tens of rows, material at thousands+ | Yes |
| `create index projects_country_announced_date_idx on public.projects (country, announced_date desc);` | Country-filtered Projects list/export | Equality lookup followed by ordered range scan; consider instead of, not automatically in addition to, the single-column index | Yes |
| `create index projects_source_url_idx on public.projects (source_url) where source_url is not null;` | EPBC import duplicate check and any future URL-targeted dedupe | Changes source-URL equality lookup from table scan to index lookup | Yes |
| `create index scans_started_at_idx on public.scans (started_at desc);` | Scan History | Avoids sort as history grows | Yes |
| `create index epbc_referral_date_idx on public.epbc_projects (referral_date desc);` | EPBC default list order | Avoids full sort; benefit grows with referral history | Yes |
| `create index epbc_state_referral_date_idx on public.epbc_projects (state, referral_date desc);` | State-filtered EPBC list | Efficient equality plus ordered scan; validate state-filter frequency first | Yes |
| `create index projects_contact_announced_idx on public.projects (announced_date desc) where contact_email is not null;` | "Has Contact" Projects filter | Smaller partial index; useful only if the table becomes large and the filter is common | Yes |

Existing useful indexes were confirmed for project scan IDs, scan lineage IDs, unique EPBC numbers, and unique app-user email/auth IDs. The explicit `app_users_auth_user_id_idx` is redundant with the unique constraint but was not removed because this audit avoids unnecessary schema changes.

## Remaining unavoidable latency

- Supabase token verification and the allowlist query are intentional security work on every protected request.
- Railway-to-Supabase network RTT cannot be optimized in code; region placement matters.
- AltEnergy login/pages, LUVI download, government sites, ArcGIS, Browse.AI, OpenAI, Apify, and Lusha have external response times and rate limits.
- ArcGIS pagination is sequential by protocol offset.
- Apify job polling and paid-provider batch execution are dominated by provider queue time.
- Per-source OpenAI fallback can be expensive when structured pages contain no qualifying projects, but disabling it would reduce existing functionality.

## Deliberately not implemented

- No schema/index migration without production plans and cardinality evidence.
- No pagination or virtualized tables without response/render thresholds.
- No auth-result cache or weaker token validation.
- No persistent enrichment-attempt cache without expiry and operator controls.
- No uncontrolled scanner/contact parallelism.
- No removal of scanner sources or OpenAI/EPBC/enrichment capability.
- No service split, worker queue rewrite, or streaming CSV rewrite without load evidence.
- No live paid integration runs or production data mutations during the audit.

## Files changed

- Frontend routing/query behavior: `artifacts/solar-tracker/src/App.tsx`, `artifacts/solar-tracker/src/pages/projects.tsx`
- API delivery/startup: `artifacts/api-server/build.mjs`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/index.ts`
- API/database paths: `artifacts/api-server/src/routes/projects.ts`, `scans.ts`, `epbc.ts`, `auth.ts`
- Auth efficiency: `artifacts/api-server/src/middlewares/supabase-auth.ts`, `src/lib/auth-timing.ts`
- Background work: `artifacts/api-server/src/lib/scraper.ts`, `src/lib/concurrency.ts`
- HTTP caching: `artifacts/api-server/src/lib/http-cache.ts`
- Focused tests: concurrency, cache headers, auth write throttling
- Dependencies: `compression`, `@types/compression`, and the pnpm lockfile

## Validation

- `pnpm -r --if-present test`: 24 tests passed (19 API, 5 frontend).
- `pnpm run typecheck`: passed.
- `pnpm run build`: passed.
- Production static smoke check: health endpoint, gzip transfer, immutable asset cache, and SPA entry served correctly.
- Scanner registry count: 32 generic + AltEnergy + LUVI = 34.
- Existing eligibility tests confirm AU/NZ scope, solar/solar+BESS only, 5 MW threshold, and rejection of standalone BESS and wind.
- Existing EPBC/auth client tests remain green.

Live login/logout and state-changing production workflows were not exercised because deployment credentials and a production test URL were not present in the checkout, and paid/data-changing operations were intentionally avoided. Their code paths compile and the existing focused tests pass; a signed-in Railway acceptance pass remains a deployment check.

## Further recommendations

1. Capture p50/p95 route `responseTime` and new source `durationMs` for at least one week.
2. Confirm Railway and Supabase regions, then measure database RTT from Railway.
3. Use `pg_stat_statements` and non-production `EXPLAIN (ANALYZE, BUFFERS)` before selecting indexes.
4. Record typical Projects/EPBC response sizes and browser long tasks; add cursor pagination only when thresholds justify it.
5. Track external-source duration, empty rate, timeout rate, and OpenAI fallback frequency to identify sources needing targeted fixes.
6. Evaluate a persistent enrichment-attempt cache only with explicit retry/expiry product rules.
