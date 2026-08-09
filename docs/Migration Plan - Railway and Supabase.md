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

The current application remains the production reference implementation until the replacement deployment is fully verified.

## Migration principles

1. Do not rewrite working business logic unnecessarily.
2. Do not change production data before a verified backup exists.
3. Do not deploy experimental migration changes from `main`.
4. Keep Replit available as a rollback path until final acceptance.
5. Move one dependency at a time and verify behaviour after each stage.
6. Preserve the approved-source whitelist and existing quality filters.

## Stage 1 - Repository preparation

Status: in progress on `migration/railway-supabase`.

Tasks:

- Add `AGENTS.md` for Codex and future maintainers.
- Add `.env.example` with variable names only.
- Ensure `.env` files cannot be committed.
- Record current architecture and Replit dependencies.
- Do not alter application runtime behaviour in this stage.

Exit criteria:

- `main` remains untouched.
- Migration instructions are understandable without Replit.
- Secrets have a safe target configuration pattern.

## Stage 2 - Replit dependency removal

Tasks:

- Remove Replit-only frontend Vite plugins where they are not required outside Replit.
- Remove runtime dependence on `REPL_ID` and `REPLIT_DOMAINS`.
- Replace Replit-specific workflow assumptions with standard pnpm build/start commands suitable for Railway.
- Retain `.replit` and `replit.md` temporarily for migration reference until equivalent documentation exists.

Validation:

- `pnpm run typecheck`
- `pnpm run build`
- frontend loads locally/preview environment
- API health route responds

## Stage 3 - Direct OpenAI integration

Current code uses Replit-provided OpenAI integration variables.

Target:

- `OPENAI_API_KEY`
- optional `OPENAI_MODEL`
- official OpenAI Node SDK

Tasks:

- update the OpenAI client wrapper
- remove dependency on Replit OpenAI base URL/key variables
- preserve existing parsing/extraction behaviour unless explicitly changed
- verify scan paths that invoke OpenAI

## Stage 4 - Security and authentication

The replacement application must not be publicly exposed until server-side access controls are in place.

Tasks:

- remove hard-coded/default admin secret behaviour
- configure Supabase Auth
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
- React frontend is built for production.
- Express API starts on Railway-provided `PORT`.
- The production application is available from one primary domain where practical.
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

## Known migration issues identified

- Replit Vite plugins are present in the frontend.
- Replit configuration/artifact files remain in the repository.
- OpenAI client currently depends on Replit integration variables.
- app URL generation in auth code currently understands `REPLIT_DOMAINS` rather than a neutral `APP_URL`.
- authentication currently has a default admin-secret fallback that must be removed before public deployment.
- CORS is currently broad and should be reviewed for production.
- `.env` files were not previously explicitly ignored; the migration branch now addresses this.
- background scan/enrichment jobs are process-local; Railway restarts interrupt them and the app already marks stale jobs failed on startup. This is acceptable initially but should be monitored. A dedicated worker/queue may be warranted later if reliability requirements increase.

## What is deliberately NOT being changed in preparation stage

- scraper source whitelist
- project qualification rules
- database schema
- API contract
- frontend behaviour
- authentication behaviour
- OpenAI behaviour
- production hosting
- production database

These changes belong in later, separately reviewed migration stages.
