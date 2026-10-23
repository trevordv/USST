# USST Architecture Decision Log

This log records material USST deviations from the generic Agentic App Template baseline.

## 2026-10-23 — Gate application deploys on the Industry News archive schema

**Observed problem:** The AU/NZ market-intelligence application deployed while
production Supabase still had the legacy `industry_news` shape. Railway's
repository `railway.json` pre-deploy command took precedence over the dashboard
command, so API reads failed on the first new archive column.

**Decision:** Add a versioned, additive Supabase migration for the archive
fields and source-coverage table, then make Railway verify the required table
shape before running the existing Scrapling release checks.

**Safety and rollback:** Legacy rows are preserved and receive only empty JSON
and timestamp defaults. The new coverage table is backend-only with RLS enabled
and public roles revoked. The existing `industry_news` RLS posture is not
changed in this repair and remains a separate access-policy decision. Reverting
application code does not require dropping the additive schema.

## 2026-10-23 — Integrate AU/NZ market-intelligence controls into Industry News

**Observed problem:** The first Industry News slice used six broad provider
queries, URL-only within-scan deduplication and one row per article. It did not
prove the APAC workflow's named primary-source coverage, distinguish evidence
strength or lifecycle, preserve corroborating sources, or identify the same
event across scans.

**Decision:** Keep the existing Industry News page, scan action, API response
and `industry_news` archive. Replace its runtime discovery path with a bounded,
registry-restricted workflow covering the approved APAC primary, specialist and
public-commentary sources. Use Australia/Sydney inclusive-start/exclusive-end
windows, deterministic eligibility/classification/capacity handling, event-level
deduplication, primary-source canonical selection, evidence status, novelty
status and append-only scan observations. Persist per-source coverage outcomes
in `industry_news_source_coverage`; never report a failed search as checked.

**Security / privacy:** Only public URLs on the explicit registry may become
events. Provider results are untrusted and pass deterministic host, geography,
date and relevance gates. No client data or new credential is introduced.

**Token / cost:** No model call is added. Firecrawl is capped at ten results per
targeted plan with concurrency three. A successful empty search stops; only a
technical failure uses the existing single batched Apify fallback. With the
current registry the upper bound is nine Firecrawl searches plus one Apify
run per scan.

**Deployment / rollback:** Railway's existing pre-deploy Drizzle push adds only
nullable/defaulted archive columns and the coverage table before the new code
starts. Revert the integration commit to restore the previous discovery path;
the additive fields and coverage records may remain without affecting the old
interface.

## 2026-10-01 — Opt-in local Scrapling transport

**Request and problem:** The user requested Scrapling integration only for USST
to improve acquisition efficiency. Existing scan code has deterministic paths
and paid fallback providers. No source-specific performance improvement is yet
established.

**Decision:** Add a bounded Python subprocess in the existing service, ahead of
paid fallback and only for explicitly selected approved failed public URLs.
Retain Node/TypeScript orchestration, parsers, template conventions and product
rules. No additional service, database, source or AI call. Keep the feature off
until live evidence supports enablement.

**Impact and rollback:** Locked Python/browser dependencies increase build size
and runtime resources. Child processes exclude application credentials. Exact
host, public destination, timeout, size and concurrency limits apply. Disable
with `SCRAPLING_ENABLED=false`; no migration or irreversible write.

**Evidence:** Fixture and subprocess/scan regressions cover opt-in, valid empty,
fallback continuity and access boundaries. Authoring-network DNS/browser-download
failures block live comparison and browser/container verification. See
`docs/Scrapling-Acquisition.md` for release checks and explicit limitations.

## 2026-09-23 — Firecrawl as bounded approved-source acquisition

**Decision:** Use Firecrawl v2 only after deterministic acquisition fails for a reviewed subset of the existing 34 approved sources. Bound scrape/crawl depth, pages, concurrency, time, content size, redirects and exact hosts.

**Fallback order:** Official/RSS/API/authenticated path, direct HTML, Firecrawl, Apify, Bright Data, then OpenAI normalisation of already acquired content. A valid empty result stops escalation.

**Safety:** Firecrawl cannot add sources or bypass runtime project eligibility. Durable backend-only source-health rows expose outcomes and cost signals without storing source bodies or credentials.

**Evidence:** Bounded live checks succeeded for NSW Planning, Planning Victoria, NZ Fast-track and Energy Magazine. WA EPA returned a target-side 403/WAF response and remains visible as degraded rather than a false success. See `docs/Firecrawl-Scan-Acquisition.md`.

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

### 2026-10-01 — Energy Magazine restriction and parser verification

- Observed problem: Scan 122 logged Scrapling HTTP/browser parser failures.
  Historical page bodies were not retained; the exact past failure cannot be
  attributed to a particular returned page. Live direct feed/search requests
  subsequently returned publisher AI-restriction pages with HTTP 403. The shared
  classifier missed their explicit restriction text and Scrapling erased typed
  response failures. Release checks only tested document shape, not extraction.
- Evidence: A live Firecrawl basic-proxy search response passed the existing HTML
  parser, with dated historical candidates and zero in the scan's 28 September–
  1 October window. Synthetic/de-identified tests cover nested cards, historical
  zero, unknown dates, structure changes and restriction responses at 200/403.
- Decision: Preserve approved URLs, parser eligibility/date rules and providers.
  Recognize explicit publisher restriction pages, retain response categories,
  stop browser retry after restriction, reject restriction content in Firecrawl,
  share production/release news parsing,
  and add safe parser diagnostic codes. A proven historical zero stops escalation.
- Security/privacy: No access bypass, new provider, source, credential, database
  write, schema or API change. Diagnostics contain codes/counts, never page bodies.
- Cost: No new AI calls; valid historical zero avoids browser/paid escalation.
  Existing provider bounds are unchanged. No claimed whole-scan savings.
- Deployment: Focused PR against `migration/railway-supabase`; release checks
  distinguish successful extraction from correctly handled publisher restriction.
  External restriction may remain and requires publisher permission/allowlisting.
- Rollback: Revert the PR; no migration or stored-data remediation.

### 2026-10-16 — Audit remediation: contacts, dates, duplicates, eligibility, AI evidence

- Observed problem: A code audit of `migration/railway-supabase` @ 4d76357 found:
  (1) the scan-time PVH contact fallback matched companies by substring/word
  overlap, attaching e.g. Ark Energy's contact to "Spark Renewables", "Clarke
  Energy" and "Parkes Solar Farm", and BP's to "Lightsource bp"; (2) AltEnergy
  newsandviews cards and Watts News issues with an unreadable date were stamped
  with the scan day, passing bounded windows and persisting a false
  announcement date; (3) projects were deduplicated only within one source, so
  the same farm from LUVI, AltEnergy and news became separate rows; (4) the
  shared gate accepted standalone BESS whose text mentioned a nearby solar farm
  or "pv magazine", and rejected solar farms whose description mentioned any
  turbine; (5) AI fallback capacity/dates were accepted without appearing in the
  acquired content, and default reasoning effort could exhaust the 2,500-token
  cap and escalate to Terra/Sol; (6) `scans.rejection_summary` (schema, API, UI)
  was never written; (7) unused `routes/auth.ts` retained a hard-coded admin
  secret fallback in a public repo; frontend tests were not run in CI.
- Evidence / metric: Reproduced each with fixture tests (contact matcher probe,
  listing fixtures, eligibility cases, AI harness). No production DB access, so
  the number of affected stored rows is unmeasured.
- Simplest attempted fix: Deterministic code only.
- Decision: Exact normalised company match for PVH fallback; undated AltEnergy
  cards stay undated (bounded scans exclude) and undated Watts News issues are
  skipped; conservative cross-source key (country + name without generic asset
  suffixes, capacities within 35%, unique match only, different source) links
  reports to one project as an update; standalone-storage and turbine rules
  tightened, reported under the existing `no-solar-component`/`wind-project`
  reasons (no contract change); AI capacity/date kept only when written in the
  acquired content; `reasoning.effort: "low"` on source fallback and Watts News
  extraction; rejection summary tallied and stored on completion; same-scan
  inserts are never downgraded from "new"; `routes/auth.ts` deleted; CI runs
  frontend tests. Two operator scripts: `audit-pvh-contacts` (dry-run by
  default, `--apply` clears flagged contacts) and `report-duplicate-projects`
  (read-only).
- Security / privacy impact: Removes a hard-coded secret fallback; stops
  attaching third-party contacts to unrelated companies. No new sources,
  providers or credentials.
- Token / cost impact: Lower expected escalation from truncated Luna replies;
  undated Watts News issues no longer trigger AI repair. No new AI calls.
- Deployment impact: Draft PR against `migration/railway-supabase`. No schema
  migration. After deploy, run `audit-pvh-contacts` (review, then `--apply`)
  and `report-duplicate-projects`, then a bounded scan; confirm the scan page
  shows the quality-gate panel and logs show "Cross-source duplicate linked".
- Rollback / exit path: Revert the PR. Cleared contacts are listed by the
  script's dry-run output; keep that output before `--apply`.

### 2026-10-16 — New-only dated scans, contact discovery with Lusha v3, source health check

- Observed problem / request: The product owner asked that (1) all sources be
  verified as working, (2) the code be made more efficient without losing
  accuracy, (3) a dated scan show only new projects inside its start/end dates,
  (4) contacts named in project descriptions be captured, and (5) Lusha be used
  to find an email or phone for each new project. Review found the Lusha
  company-prospecting step used v2 endpoints that Lusha retires on 30 November
  2026, and Lusha results without an email were discarded even when a direct
  phone number was returned. The AEMO Generation Information workbook URL was
  pinned to July 2026. A skipped, unconfigured paid fallback overwrote the real
  direct-acquisition failure category in source health.
- Evidence: Lusha v3 OpenAPI (api-evangelist/lusha) and Lusha's v3 migration
  guide. Live source probing was not possible from the authoring environment
  (egress allowlist), so a deployable read-only check was added instead.
- Decision:
  - Dated scans return and count only projects first stored by the scan with an
    in-window announcement date, or stored earlier with a persisted
    announcement date in the window. Updates and undated inventory remain lineage.
  - After each scan, new projects get free description extraction (named
    person + title, developer email, AU/NZ phone; blank fields only), then Lusha
    v3: named person via `/v3/contacts/search-and-enrich`, otherwise the most
    sales-relevant AU/NZ person via `/v3/contacts/prospecting` + `/v3/contacts/enrich`.
    One lookup per developer; email must belong to the developer; a phone-only
    result is kept; credits tracked from `billing.creditsCharged`, capped by
    `LUSHA_SCAN_MAX_CREDITS` (default 25, max 100); stops on 401/402/403. This
    supersedes the earlier "enrichment is manual only" rule for new projects.
  - Manual enrichment uses the same v3 client and accepts phone-only results.
  - `check-sources` command: runs every approved source's real acquisition and
    parser path without DB writes; paid fallbacks disabled unless `--with-fallbacks`.
  - AEMO: discover the newest quarterly workbook on the approved AEMO page,
    falling back to the pinned URL.
  - Efficiency: one batched last-seen update per scan instead of one query per
    re-found project; AltEnergy and LUVI run concurrently with generic sources
    (results combined in the original order).
- Security / privacy impact: Contact data stored is limited to business email,
  phone, name for project developers. Lusha's own DNC flags are honoured;
  masked numbers are discarded. No new sources.
- Token / cost impact: Lusha spend per scan is capped (default 25 credits).
  No new AI calls. `check-sources` is free by default.
- Deployment impact: No schema migration. Optional env vars
  `LUSHA_AUTO_ENRICH_NEW_PROJECTS`, `LUSHA_SCAN_MAX_CREDITS`. After deploy run
  `railway ssh` into the service and run `node dist/check-sources.mjs`.
- Rollback / exit path: Set `LUSHA_AUTO_ENRICH_NEW_PROJECTS=false` to stop paid
  lookups immediately; revert the PR for the rest.

### 2026-10-16 — Reserve automatic Lusha scan credits before provider calls

- Observed problem: `billing.creditsCharged` is returned only after Lusha has
  processed a request. The prior post-scan code counted that response, so a
  multi-request company workflow could start while fewer credits remained than
  its worst-case charge.
- Evidence / metric: The company workflow can make two prospecting calls and
  one reveal; the prior admission check considered only credits already charged.
- Simplest attempted fix: Keep the existing one-developer workflow and disable
  automatic paid lookup whenever a safe request-cost bound is unavailable.
- Decision: Require `LUSHA_MAX_CREDITS_PER_REQUEST` for automatic Lusha. Reserve
  one bounded request for a named-person lookup and three for company
  prospecting/reveal before calling Lusha. Record actual charged credits and
  reserved credits separately. Free description extraction is unchanged.
- Security / privacy impact: No additional data leaves the service. The caller
  retains the existing business-contact and DNC checks.
- Token / cost impact: A scan cannot begin a workflow unless its configured
  worst-case reservation fits within `LUSHA_SCAN_MAX_CREDITS`. This may perform
  fewer lookups than the old optimistic accounting.
- Deployment impact: Set `LUSHA_MAX_CREDITS_PER_REQUEST` from the account plan
  before enabling automatic Lusha. Without it, paid automatic lookup is safely
  disabled.
- Rollback / exit path: Set `LUSHA_AUTO_ENRICH_NEW_PROJECTS=false`, unset the
  new variable, or revert this change. No migration or data rewrite.

### YYYY-MM-DD — Decision title

- Observed problem:
- Evidence / metric:
- Simplest attempted fix:
- Decision:
- Security / privacy impact:
- Token / cost impact:
- Deployment impact:
- Rollback / exit path:
