# Source-access verification — 30 August 2026

## Verified defects and repairs

- ARENA and NZ Ministry for the Environment return real public HTML containing
  an `/_Incapsula_Resource` script. The previous response classifier rejected
  any occurrence of `incapsula`, including this normal security script. It now
  rejects actual challenge frames/messages rather than the vendor name alone.
  HTTP 401/403, Cloudflare challenge markers and Azure WAF remain blocked.
- Successful fallback `[]` results on fallback-first sources were incorrectly
  labelled `extraction-failed`, because only direct acquisition success was
  tracked. The outcome now tracks successful fallback acquisition separately.
- Missing fallback credentials, malformed JSON and upstream failures no longer
  silently become empty arrays. Final diagnostics include `directSucceeded`,
  `fallbackSucceeded` and `failureCount` so fallback recovery does not hide a
  failed direct path. Empty does not establish full source coverage.

## Runtime baseline and external blockers

The running Railway `usst-migration-test` service uses migration commit
`6d2d523113d9dfc6a353c80dc7af56019d165ed3`. Health returned `{"status":"ok"}`.
The latest available runtime scan was #100 on 24 August: 34 sources, 10 success,
5 empty, 17 extraction-failed and 2 blocked. The diagnostic defect means the
17 extraction-failed outcomes must not all be interpreted as network failures.

Workstation HTTP checks on 30 August found 403 access challenges at AEMO,
Planning Victoria, QLD Coordinator-General, SA Energy & Mining, WA EPA,
QLD Planning and NZ Fast-track. These controls were not bypassed. Local HTTP
reachability does not establish Railway reachability or successful extraction.

The four NZ Browse.AI integrations have no configured API key/robot IDs in the
running service. They require approved account configuration, not placeholder
credentials. AltEnergy and LUVI succeeded in scan #100; their authentication
has not been freshly retested.

## Scope and verification limits

This patch changes response classification, failure reporting and evidence-based
paid fallback admission. It does
not change source membership, eligibility rules, inventory semantics, dates,
the API contract, database schema, authentication, or PR #29.

A controlled verification scan needs an authenticated USST administrator
session. Deploying this separate repair branch requires review; no migration
branch merge or Railway deployment is performed as part of the local checks.
After deployment, verify source-level outcomes and records, not just HTTP 200.

## Local validation

- `pnpm -r --if-present test`: passed, 99 API tests + 5 frontend tests.
- `pnpm run typecheck`: passed.
- `pnpm run build`: passed (existing Vite sourcemap warnings only).
- Live Node HTTP requests against ARENA and NZ Environment returned 200;
  the patched classifier accepted both, with 40,079 and 772,654 characters.
- The existing AltEnergy eligibility import now includes `.ts` so Node's
  native TypeScript test runner can resolve it; eligibility logic is unchanged.
- Validation reused the installed dependency tree from the adjacent Brave
  worktree, whose package manifests and lockfile are unchanged from this base.
  `pnpm_config_verify_deps_before_run=warn` prevents pnpm 11 from reinstalling
  that shared tree merely because the worktree location changed.

## Follow-up: live scan #101 and remaining work

The authenticated verification scan on 30 August ran the deployed migration
commit, not this patch. It completed in 608,398 ms: 34 sources, 868 found,
100 new. Final acquisition diagnostics were 28 success, 5 extraction-failed,
and 1 blocked. Acquisition counts are not unique eligible lineage counts.
AltEnergy login succeeded, retrieving 2,371 inventory rows (564 accepted by
the DB gate); combined news/inventory acquisition returned 581. LUVI returned
204. No separate contact-enrichment request was initiated.

The five zero-result sources were NSW Planning Portal, NSW Planning Renewable
Energy, QLD Coordinator-General, NT Development Applications, and QLD Planning.
They cannot be called inaccessible merely because a date-bounded search found
nothing. This patch distinguishes valid empty output from errors without
relaxing dates, capacity or project eligibility to manufacture results.

NZ Environment still hit the HTTP-200 false-block defect fixed above. ARENA
had the same HTML rejection but succeeded through RSS. AEMO's workbook was
HTTP 403 but its scoped search fallback returned a record. Energy Magazine
had a blocked HTML path while other acquisition returned records.

### Browse.AI follow-up repairs

- Missing API key, missing robot ID, valid empty results, and actual provider
  failures now have distinct diagnostics. A successful empty robot execution
  counts as successful acquisition and does not trigger a paid search fallback.
- HTTP errors, malformed results, failed tasks and timeouts propagate into
  per-source failure tracking; they no longer silently become empty arrays.
- Search fallback is still attempted after robot failure. No source is removed.
- The 90-second polling budget now includes creation, request time and delays;
  request deadlines are capped by the remaining budget.
- Upstream error response bodies are not logged. Six regression tests cover
  configuration, empty results, structured records, failures, timeout and
  no network calls without credentials.

Follow-up validation: `pnpm -r --if-present test` passed 105 API + 5 frontend
tests; `pnpm run typecheck` and `pnpm run build` passed. Existing Vite sourcemap
warnings remain. The first sandboxed run could not resolve esbuild paths;
the complete suite passed when rerun with approved filesystem access.

### External prerequisites (not fixed by code)

The four Browse.AI sources require a user-owned, approved account with robots
trained for the exact existing official URLs and the table columns documented
in scraper.ts. Configure secrets directly in the Railway secret store:

- BROWSE_AI_API_KEY
- BROWSE_AI_NZ_FAST_TRACK_ROBOT_ID
- BROWSE_AI_NZ_EPA_FAST_TRACK_ROBOT_ID
- BROWSE_AI_NZ_EPA_RMA_ROBOT_ID
- BROWSE_AI_NZ_EPA_CONSULTATIONS_ROBOT_ID

Do not paste secret values into a PR, report or chat. No connected Browse.AI
management tool is available to create or inspect those robots here. All four
search fallbacks returned records in scan #101, but do not prove complete
coverage or functioning Browse.AI configuration.

Publisher HTTP-403 restrictions require publisher-approved access (or an
approved official export). They were not bypassed with proxies, forged browser
identities, or challenge circumvention. Existing scoped fallbacks remain in
place; no new source or broader search was added.

Review and deployment are still required before this code changes live scans.
PR #29 remains untouched, and neither PR is merged by this work. After account
configuration and deployment, repeat a bounded scan and inspect direct and
fallback diagnostics separately. Do not declare all-source access from an
overall completed scan or a nonzero fallback result.

## Evidence-based paid fallback admission

Each normal extraction path logs one of `success-with-results`,
`success-zero-results`, `fetch-failed`, `parse-failed`, `content-unusable`, or
`requires-js-or-ai-repair`. A fetch is not successful extraction until its
parser completes. Input checks distinguish valid empty RSS/HTML from empty
documents, incomplete RSS, JS-only shells and unsupported parser structures.
Project count is never used as evidence of a parser failure.

When all paths succeed with zero results, OpenAI is not called. When a path
returns results, the existing no-supplement behaviour is preserved. If no path
returns results and a configured path genuinely fails, the approved fallback
may repair it; a successful empty sibling does not hide that failure. All
configured paths still run, and URL deduplication keeps configuration order.

Sources explicitly registered as OpenAI-first retain their approved repair
strategy and log it as the admission reason. Browse.AI still runs first when
configured: valid empty output stops without OpenAI, while missing configuration
or failure can invoke its configured fallback. Dedicated AltEnergy/LUVI paths
and Firecrawl helper behaviour are unchanged.

Existing aggregate outcome names are retained for compatibility. Per-path
`extractionOutcomes`, `fallbackUsed`, `resultOutcome`, and the logged repair
reason make zero-result runs and paid repairs distinguishable for cost audits.
These changes do not alter eligibility, dates, scoring or rule governance.

## Persistent paid-source cache

`ai_source_fallback_cache` stores the raw structured source-fallback array,
including successful `[]`, before project filtering. Both fresh and cached
arrays pass the same parser and current country, capacity, technology, date and
official-source gates. Cache entries are not eligibility decisions. Newsletter,
authenticated AltEnergy/LUVI, Browse.AI and Firecrawl paths are unchanged.

The SHA-256 key covers source name, exact source URL, observed-content
fingerprint, optional start/end dates (null differs from a supplied date), model,
full prompt/request-settings hash and cache schema version. Cache version 2 uses
a meaningful-content fingerprint for each captured page/feed: canonical JSON,
or normalised visible document text plus links and valid JSON-LD. It ignores
whitespace, comments, presentation styles, executable scripts, metadata/form
controls, fragments and common tracking parameters, while text, link and
structured-data changes produce a new hash. Secret-like JSON fields are removed
before hashing. Request headers, cookies, credentials and sessions are never
inputs; neither raw content nor fingerprints are logged.

The combined fingerprint covers every attempted path's URL, method, outcome and
meaningful body hash, including rejected HTTP bodies where available. No source
bodies are stored. Prompt changes (including today's date and official hostname
restrictions) also invalidate previous entries. Deterministic fetch and parsing
still run on every scan; hashing only controls the subsequent paid fallback.

AI-first sources and transport failures do not supply a fresh source body: their
key explicitly represents the acquisition context with an absent body hash,
not a claim that remote content is unchanged. Those entries expire after six
hours without sliding expiry on hits. Entries backed by observed meaningful
content do not expire: changed content, date window, prompt/model or cache version
selects a different key. This makes an unchanged bounded page reuse its prior
valid result, including `[]`, without periodically repaying for the same work.
Bounded prompts omit volatile “today” text so identical explicit windows keep the
same request hash; open-ended windows retain the date context they need.

A PostgreSQL transaction-scoped advisory lock serializes each key across API
processes; the unique cache key and upsert additionally prevent duplicate rows.
The connection/transaction remains held during a cache miss's paid request;
other same-key callers wait up to 120 seconds for the lock. Failures roll back,
release the connection and are not cached as empty successes. Cache outages fail
closed instead of silently causing uncached repeat spend. This cannot guarantee
exactly-once billing if a process dies after OpenAI responds but before commit.

Structured events are `ai_source_cache_hit`, `ai_source_cache_miss`,
`ai_source_cache_write`, `ai_source_cache_empty_result` and
`ai_source_cache_error`. Empty-result events distinguish reads from writes via
`cached`. The existing `fallbackUsed` means the repair path was admitted; a cache
hit does not represent another paid request. Hits update `last_used_at` only.

Apply `20260831114721_ai_source_fallback_cache.sql` before deploying this code.
The additive migration changes no project/scan/learning tables. RLS is enabled;
anon/authenticated have no table or sequence privileges, and only the backend
service role (or database owner) may read/write the cache. Expired entries are
ignored and refreshed in place; distinct historical keys are retained for audit
and can be removed later by an operator without affecting project data.

### Cache validation (2026-08-31)

- Applied cache-only migration version `20260831114721` to connected USST
  Supabase project `iynofxdcuvsdbmnojfzp`; the local filename matches its history.
- Live PostgreSQL checks passed for empty JSON persistence, freshness/expiry,
  advisory-lock availability, unique-key rejection, upsert, count/date checks,
  RLS and backend-only privileges. Test inserts were rolled back (zero remaining).
- Full suite: 137 API + 5 frontend tests passed. Typecheck and build passed;
  existing Vite sourcemap and shared-dependency sync warnings remain.
- Cache regression coverage includes hit/miss/empty, all key dimensions,
  expiration, malformed/error results, cache outage, fetched-content hashing,
  current eligibility gates, and eight concurrent callers producing one paid
  invocation/one entry using a deterministic SQL-client double. No live OpenAI
  request was needed for validation.
- Supabase's informational [RLS enabled without policies notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
  is intentional for this backend-only table: application users have no access.
  Its separate [leaked-password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
  is an existing Auth setting, outside this cache change, and was not modified.
- Only the database migration is live. Application changes remain local pending
  review/deployment; no PR was merged.

## EPBC unresolved-first enrichment

The former EPBC fallback constructed eight state queries, one query for every
year band in the requested range, and one current-assessment query, then launched
all of them concurrently. The observed `queryCount: 18` therefore represented
eight states + nine annual bands + one latest sweep. It also ran this discovery
fan-out as optional supplementation after a successful ArcGIS response.

The refactored path starts with the official DCCEEW ArcGIS feature layer, applies
its existing year and Energy-category filters, normalises records, deduplicates
by EPBC number, and merges previously persisted EPBC detail. A record is resolved
without AI when its technology is decisive and, for solar, capacity is known;
clear sub-5 MW solar, wind, transmission and standalone BESS records therefore
do not consume AI. Only unknown technology or solar with unknown capacity enters
the unresolved queue. Complete official results use zero OpenAI calls.

Unresolved records are grouped into compact batches of at most 20 official EPBC
numbers. Thus the request bound is `ceil(unresolved / 20)`, derived from actual
unresolved work rather than states or years, and batches execute sequentially
rather than as a parallel fan-out. Each batch allows only its requested EPBC
numbers back into the merge. It searches only the official EPBC portal and
DCCEEW spatial host; AI-only records are never appended after ArcGIS succeeds.

Each batch uses the persistent source cache keyed by the meaningful official
record payload, exact date window, model and prompt. Cached data, including an
empty array, consumes zero new OpenAI calls. The same parser, official-number
allow-list and downstream project gates apply to cache hits. Logs report total
candidates, deterministic resolutions, duplicates removed, cached work,
unresolved count, maximum/planned calls, actual calls and final eligible count.

If ArcGIS is wholly unavailable, one cached/bounded official-domain discovery
request replaces the state/year fan-out. Previously persisted EPBC records are
retained and combined with new official discoveries, preventing a transient
source outage from erasing known coverage. This is the only potential coverage
trade-off: discovery during a first-ever ArcGIS outage is less redundant than
18 overlapping searches. Normal operation has no fixture coverage loss because
ArcGIS remains comprehensive and unresolved official records receive targeted
enrichment. No learning-loop or rule-governance behavior changes.

Validation after the EPBC refactor: 144 API + 5 frontend tests passed;
workspace typecheck and production build passed. Existing Vite sourcemap and
shared-dependency synchronization warnings remain.
