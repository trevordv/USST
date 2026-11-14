# USST Migration Plan - Railway and Supabase

## Objective

Move the working USST application away from Replit while preserving functionality, historical data, scraper rules, and the ability to continue development through GitHub + Codex.

Target operating model:

- GitHub: single source of truth for application code and documentation.
- Codex Cloud: primary AI development environment.
- Railway: production application hosting.
- Supabase: PostgreSQL database and authentication.
- OpenAI: direct API integration.
- Existing external providers such as Apify, Firecrawl, AltEnergy, LUVI and Lusha remain external integrations as required.

## Current application

USST is a pnpm workspace monorepo using:

- Node.js / TypeScript
- React + Vite frontend
- Express API
- PostgreSQL + Drizzle ORM
- OpenAPI contract with generated API client/validation
- background scanning and contact-enrichment jobs

The current Replit application remains the production reference implementation until the replacement deployment is fully verified.

## Migration principles

1. Do not rewrite working business logic unnecessarily.
2. Do not change production data before a verified backup exists.
3. Do not deploy experimental migration changes from `main`.
4. Keep Replit available as a rollback path until final acceptance.
5. Move one dependency at a time and verify behaviour after each stage.
6. Preserve the approved-source whitelist and existing quality filters.

## Stage 1 - Repository preparation

Status: **complete on `migration/railway-supabase`**.

Completed:

- Added `AGENTS.md` for Codex and future maintainers.
- Added `.env.example` with variable names only.
- Added `.env` protection to `.gitignore`.
- Recorded current architecture, business rules and migration stages.
- Kept `main` untouched.

## Stage 2 - Replit runtime dependency removal

Status: **code and CI build validation complete; live runtime validation remains for the Railway test deployment**.

Completed:

- Removed Replit Vite plugin imports and runtime plugin activation from the main frontend and mockup sandbox Vite configuration.
- Removed runtime dependence on `REPL_ID`.
- Replaced `REPLIT_DOMAINS` invite-link generation with neutral `APP_URL` configuration.
- Added safe defaults for frontend `PORT` and `BASE_PATH` so Vite production builds do not require Replit-provided variables.
- Added root `start` command for the Express API.
- Added a production staging script that copies the built React application into the API server's `dist/public` directory.
- Configured Express to serve the staged React application and SPA fallback when those production assets exist.
- Added GitHub Actions migration validation.
- Fixed two pre-existing workspace typecheck issues in one-off import scripts that directly imported an undeclared `drizzle-orm` dependency.
- Retained `.replit` and `replit.md` temporarily as migration reference; they are not part of the new production runtime path.

Validated by GitHub Actions on Node 24 / pnpm 10:

- dependency installation with frozen lockfile
- `pnpm run typecheck`
- `pnpm run build`
- production frontend staging into `artifacts/api-server/dist/public`

Still to validate after a test database and deployment environment are available:

- `pnpm start` with real environment variables
- `/api/health`
- frontend load and client-side routes
- API calls from the staged frontend

Cleanup note:

The three `@replit/vite-plugin-*` packages are no longer imported or executed, but their package/catalog/lockfile declarations are being left temporarily until the lockfile can be regenerated with pnpm in a proper development/Codex checkout. This avoids hand-editing `pnpm-lock.yaml`. Remove those declarations during final dependency cleanup and regenerate the lockfile before the migration branch is finally merged.

## Stage 3 - Direct OpenAI integration

Status: **code migration complete; live OpenAI call validation remains for the test deployment**.

Completed:

- Replaced the Replit-provided OpenAI integration variables with `OPENAI_API_KEY`.
- Removed the Replit OpenAI base URL requirement.
- Kept the official OpenAI Node SDK and existing application parsing/extraction logic.
- Updated `.env.example` for direct OpenAI credentials.
- Confirmed the workspace still typechecks and builds after the change.

Still to validate:

- an actual OpenAI-assisted scan/extraction using the Railway test environment
- any future decision to centralise model selection through `OPENAI_MODEL`; existing model-selection behaviour has not otherwise been changed

## Stage 4 - Security and authentication

Status: **next infrastructure-dependent stage**.

The replacement application must not be publicly exposed until server-side access controls are in place.

Tasks:

- create/configure the Supabase project and Auth settings
- remove hard-coded/default admin secret behaviour
- define roles/claims required by USST
- enforce authentication/authorization on protected Express API routes
- ensure privileged Supabase service-role credentials exist server-side only
- restrict CORS to the deployed application origin where appropriate
- decide how existing invitation/access tokens are retired or mapped during transition

Exit criteria:

- unauthenticated users cannot call protected write/admin/scan endpoints
- authenticated users retain intended application access
- administrator functions require explicit privilege

## Stage 5 - Supabase database migration

Before migration:

- export a complete backup of the Replit PostgreSQL database
- store the backup somewhere independent of Replit and Supabase
- record current table row counts

Target database remains PostgreSQL, so the Drizzle schema should remain substantially reusable.

At minimum verify tables/data relating to:

- projects
- scans and scan lineage
- contacts/contact enrichments
- EPBC data
- access tokens/auth transition data where needed

Migration sequence:

1. Create Supabase project/database.
2. Restore schema/data using an appropriate PostgreSQL dump/restore approach.
3. Configure `DATABASE_URL` for a non-production validation deployment.
4. Compare row counts.
5. Check representative records and date/numeric fields.
6. Run application reads, writes and a controlled scan against Supabase.
7. Do not cut over production until validation passes.

## Stage 6 - Railway deployment

Initial preferred topology: one Railway application deployment unless operational testing shows a need to split services.

Desired behaviour:

- Railway builds the pnpm workspace from GitHub.
- React frontend is built and staged into the Express service.
- Express API starts on Railway-provided `PORT`.
- The production application is available from one primary domain.
- Runtime secrets are configured in Railway, not GitHub.
- `DATABASE_URL` points to Supabase.

A later phase may split the scraper/background worker into a separate Railway service if scans require isolation from the web process.

## Stage 7 - Functional acceptance test

Before switching away from Replit, compare the replacement app against the working Replit version.

Test at minimum:

- application login/access
- dashboard metrics
- project directory filters/search
- project add/edit/delete
- CSV export
- scan creation and status polling
- scan history and scan lineage
- project ingestion quality rules
- AU/NZ filtering
- solar-component rule
- 5 MW threshold behaviour including intentional government-data exceptions
- EPBC functionality
- contact enrichment
- external source credentials
- AltEnergy authenticated access
- LUVI pipeline access
- Firecrawl integration
- Apify integration
- Lusha behaviour if enabled
- OpenAI-assisted extraction/parsing
- invitation/admin functions or their Supabase Auth replacement

## Stage 8 - Cutover and rollback window

Only after acceptance:

1. Freeze changes briefly.
2. Take a final Replit database backup.
3. If required, migrate any records created since the first test migration.
4. Deploy final GitHub `main` revision to Railway.
5. Point production domain to Railway.
6. Monitor scans, API errors and database writes.
7. Keep Replit available for a short rollback period.
8. Decommission Replit only after confidence in the replacement deployment.

## Known migration issues still open

- authentication still has a default admin-secret fallback; Stage 4 must remove it before public deployment.
- API routes still require a server-side authentication/authorization layer; Stage 4 will address this.
- CORS is currently broad and should be restricted for production in Stage 4.
- Replit package/catalog/lockfile declarations remain as temporary dead dependencies pending lockfile regeneration.
- Replit configuration/artifact files remain for migration reference and will be removed only after their useful information is preserved.
- background scan/enrichment jobs are process-local; Railway restarts interrupt them and the app already marks stale jobs failed on startup. This is acceptable initially but should be monitored. A dedicated worker/queue may be warranted later if reliability requirements increase.

## Deliberately unchanged so far

- scraper source whitelist
- project qualification rules
- database schema/data
- API contract
- current authentication model (other than neutral invite URL generation)
- OpenAI parsing/extraction business logic
- production Replit deployment

These remain protected until their specific migration stages are completed and validated.
