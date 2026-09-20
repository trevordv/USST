# USST Architecture Decision Log

This log records material USST deviations from the generic Agentic App Template baseline.

## 2026-09-19 — Adopt Agentic App Template v1.1

**Decision:** Adopt `trevordv/Agentic-App-Template` v1.1 at commit `6bc4275ce99d9444ea383f8d48f47b6adce7e149` as the governing engineering baseline.

**Reason:** Standardise Loop Engineering, security/privacy, token/cost controls, Golden Tests, complexity gates, observability and production acceptance for future USST work.

**USST exceptions retained:**

- Existing frontend remains React + Vite rather than migrating to Next.js.
- Existing API remains Express with OpenAPI contract-first generation.
- Existing pnpm monorepo structure remains.
- Existing PostgreSQL/Drizzle data layer remains.
- Railway + Supabase remain the production runtime/data platform.
- Existing background scan-job pattern remains.
- Existing strict 34-source whitelist and AU/NZ solar eligibility rules remain project-specific hard requirements.

**Evidence:** These components already support the deployed product and changing them solely to match a generic default would add risk and complexity without a measured customer benefit.

**Exit path:** Revisit an exception only if a measured reliability, security, cost, maintainability or product requirement triggers the relevant complexity gate.

## Decision entry template

### 2026-09-19 — Optional Bright Data fallback for approved public source pages

- Observed problem: Some approved public source pages fail technical acquisition
  or deliver JavaScript-only/empty server-rendered content. Existing deterministic
  parsing then loses coverage or admits a paid AI search.
- Evidence / metric: The RUN-0105 audit records degraded source paths and shows
  why completed 34-source scans do not prove every source was extracted. HTTP
  403/challenge paths are explicitly **not** eligible for this fallback.
- Simplest attempted fix: Keep direct fetch and source-specific deterministic
  parsers first, then existing bounded AI repair. Do not add a source or change
  the eligibility gates.
- Decision: Add an optional Bright Data Web Unlocker REST adapter for at most
  two exact approved public URLs per source per scan, only after a network,
  timeout, unusable-content or JavaScript-rendering failure. No request is made
  after a valid direct parse, including a valid zero. Access-control/CAPTCHA,
  authentication and rate-limit failures are never proxied. Authenticated,
  EPBC and registry-designated inaccessible paths remain unchanged.
- Security / privacy impact: The server sends only the pre-approved public URL
  and zone name to Bright Data. API key stays in Railway and is not logged.
  Provider content remains untrusted and passes existing parsing, source, date
  and hard eligibility gates. Diagnostic URLs omit query strings/fragments.
- Token / cost impact: Worst case is two paid Web Unlocker calls per eligible
  source, at most 42 calls across the 21 working/extraction-problematic source
  slots in a scan; normal successful direct paths cost zero. A successful
  alternate parse, including zero results, avoids an OpenAI repair for the
  recovered URL. Each call has a 45-second timeout and 2 MB response cap.
- Deployment impact: Requires `BRIGHT_DATA_API_KEY` and `BRIGHT_DATA_ZONE` in
  Railway. Without both, current scan behavior is unchanged. No migration.
- Rollback / exit path: Unset either variable to disable the adapter, or revert
  the integration commit. Verify source outcomes and provider charges in a
  bounded staging scan before production enablement.

### 2026-09-19 — Distinguish public 403 from protected access

- Observed problem: RUN-0107 made zero Bright Data calls despite a plain 403
  on an approved public Energy Magazine URL. The prior classifier grouped that
  response with login, paywall and challenge responses. A separate Bright Data
  diagnostic request returned HTTP 200, while an approved PV Magazine feed
  timed out at the former 30-second provider limit. A targeted Energy Magazine request
  from Railway returned HTTP 200 and 21,601 bytes in 7.3 seconds.
- Decision: On registry-reviewed `extraction-problematic` public sources only,
  a plain 403 without login, payment, rate-limit or challenge evidence may be
  retried through Web Unlocker. Parser failures and JavaScript-only shells on
  exact approved public URLs may also be retried. Never proxy a successfully
  parsed URL, authenticated source, registry-designated inaccessible source,
  AEMO workbook or EPBC ArcGIS source. Keep the per-source two-URL cap and
  bounded provider timeout, response-size cap and downstream eligibility gates.
  RUN-0108 subsequently attempted Bright Data for Energy Magazine, but the
  request timed out at 30 seconds during the concurrent scan. The same approved
  URL succeeded from the Railway container in 21.7 seconds when retried alone.
  Increase only the provider timeout to 45 seconds; keep the two-URL and 2 MB
  caps, and measure the next bounded scan before merging.
- Security / cost impact: A plain 403 alone is not proof of a login wall; any
  explicit authentication, paywall, rate-limit or challenge signal still blocks
  the provider call. Approved URLs and credentials remain fixed and server-side.
  A full scan's source lineage and provider charges should be reviewed before
  permanent deployment.

### 2026-09-20 — Deterministic extraction depth and per-project source identity

- Observed problem: Scans returned little detail per source. Code review of
  `scraper.ts` found (1) projects that share a listing/article URL collapsed to
  one row because `source_url` was the identity, and a rejected project poisoned
  that URL for the rest of the scan; (2) feed excerpts rarely contain the MW
  figure, so most solar articles failed the shared gate as `missing-capacity`;
  (3) RSS read only page one and only the excerpt; (4) HTML cards were cut at the
  first nested `</div>`; (5) capacity parsing read "1,200 MW" as 200 MW and
  "400 MWh" or a national statistic as project MW; (6) developer extraction
  returned project names and regulators; (7) undated items were stamped with the
  scan day, contrary to `Scan-Date-Window-Policy.md`.
- Evidence / metric: Reproduced with fixture regression tests
  (`source-text`, `news-parsers`, `project-identity`, `article-enrichment`,
  `source-heuristics`). Not measured against live sources: the authoring
  environment could not reach the approved hosts (egress policy 403).
- Simplest attempted fix: Shared pure helpers and balanced-tag parsing; bounded
  same-site article reads for candidates without a capacity; feed paging;
  stable `#<project-slug>` identity for shared URLs with a same-source name
  fallback for records stored before this change.
- Decision: Deterministic code only. No new sources, no new AI calls, no change
  to the OpenAI fallback prompt/model/token cap, eligibility rules, schema or
  API contract. Undated feed/card/Browse.AI/AI-fallback items are now stored with
  a null announcement date (unbounded scans) or excluded (bounded scans), matching
  the documented policy and LUVI/AltEnergy behaviour. The earlier supplied
  article/listing patch overlaps the bundle; its distinct AU numeric-date and
  next-listing-page behaviours were retained without installing duplicate parsers.
- Security / privacy impact: Article reads are restricted to the source's own
  approved HTTPS hosts, use the existing response classifier (blocks/challenges
  are respected, never bypassed), and are capped at 30 pages per source with 4
  concurrent requests. Newly discovered article/listing requests reject redirects
  rather than following one to a different host.
- Token / cost impact: No paid AI added. Deterministic recovery may reduce
  fallback attempts because fewer valid sources look empty. HTML listing depth
  adds at most two direct requests per successfully fetched configured listing URL;
  feed depth is bounded separately as documented in the scraper.
- Deployment impact: Draft PR against `migration/railway-supabase`. Verify with a
  bounded authenticated scan and compare per-source counts and
  `Article enrichment complete` log lines after deployment.
- Rollback / exit path: Revert the PR; no data migration. Rows stored with the
  new `#slug` URLs remain valid and are still name-matched by source.

### YYYY-MM-DD — Decision title

- Observed problem:
- Evidence / metric:
- Simplest attempted fix:
- Decision:
- Security / privacy impact:
- Token / cost impact:
- Deployment impact:
- Rollback / exit path:
