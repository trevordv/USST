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
