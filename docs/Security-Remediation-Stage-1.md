# Security Remediation Stage 1

Addresses SEC-001 and partially addresses SEC-003 from the 15 August 2026 security audit.

## Implemented

- `requireAuth` authenticates first; `requireAdmin` then returns 401 when no authenticated principal exists, 403 for an authenticated non-admin, and calls `next()` for the trusted `app_users.role = admin` role.
- Admin-only routes: `POST/PATCH/DELETE /projects`, `POST /projects/enrich-contacts`, `POST /scans`, `POST /epbc/upload`, `POST /epbc/sync`, `PATCH /epbc/projects/:id`, and `POST /epbc/projects/:id/import`.
- Read-only project, scan, enrichment-status, and EPBC routes remain available to authenticated active users. Authorization is entirely server-side.
- Costly admission applies to scan, enrichment, and EPBC sync after authentication and admin authorization and before expensive work. It permits one active job per operation type globally within the process and applies a 15-second cooldown per administrator and operation.
- Scan admission releases after background promise settlement and after pre-start database failure. Enrichment releases after its background promise settles or start-up throws. EPBC sync releases through `finally` on success, early return, or thrown failure.
- Rejected admission returns a generic 429 response and logs only the operation name.

## EPBC classification

- **Sync — admin + costly admission:** external network retrieval and potentially high-volume database upsert; concurrent duplicates create network, CPU, and write load.
- **Upload — admin only:** bounded operator-supplied file parsing and database writes. Parser/resource controls are explicitly deferred to SEC-004 rather than mixed into Stage 1A.
- **Import — admin only:** one database record, no external network/API or financial cost, with an existing duplicate source-URL check.

## Verification and limitations

Stage 1A verifies source-level authorization branches, middleware/route composition, admission concurrency/cooldown/release behavior, type safety, production build, and the existing regression suite. Admin authorization implemented; request-level HTTP verification deferred to Stage 1B.

Real Express HTTP 401, 403, and admin pass-through behavior is **not yet request-level verified**. The current direct TypeScript test loader cannot safely import the real middleware because its dependency graph reaches the workspace DB/schema ESM directory import. Stage 1B will add a reusable in-process Express harness and production-safe dependency boundary without weakening production authentication.

Admission state is **instance-local** in Railway process memory. It is effective for the current single-replica deployment. Multiple Railway replicas would each admit one job, so horizontal scaling requires shared coordination (for example Redis or database-backed leases).

FIXED in Stage 1A: SEC-001 server-side admin authorization, the 401/403 distinction, privileged-route coverage, the approved EPBC policy, and instance-local admission/release safeguards for scans, enrichment, and EPBC sync. SEC-003 is partially fixed for the current single-replica deployment.

Deferred: dependency remediation (SEC-002), upload parser hardening (SEC-004), log redaction (SEC-005), legacy auth removal (SEC-006), Supabase privilege/RLS verification (SEC-007), identity-linking hardening (SEC-008), SSRF/prompt controls (SEC-009), and Stage 1B HTTP security-test infrastructure.
