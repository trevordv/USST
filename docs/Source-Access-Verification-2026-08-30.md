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

This patch changes response classification and failure reporting only. It does
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
  counts as successful acquisition, even if a later search fallback fails.
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
