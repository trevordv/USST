# USST Codex Instructions

## Project purpose

USST (Utility Scale Solar Tracker / Solar Project Scout) is a sales-intelligence application for discovering and maintaining Australian and New Zealand utility-scale solar projects.

The current application is working in Replit. Migration work must preserve current behaviour until the replacement Railway + Supabase deployment has been tested and accepted.

## Non-negotiable product rules

- Target Australia and New Zealand only.
- Include utility-scale solar projects and hybrid solar + BESS projects only.
- Do not ingest standalone BESS/battery-only projects.
- Do not ingest wind or wind + BESS projects.
- Normal project threshold is 5 MW or greater.
- Data quality is more important than project count.
- Do not turn article headlines, operational updates, fundraising stories, or unrelated announcements into projects.
- Only scan approved sources. Do not add broad web search, developer-site scraping, or new sources without explicit approval.
- Contact enrichment must remain an explicit user action rather than an automatic scan step unless explicitly requested otherwise.

## Architecture

This repository is a pnpm workspace monorepo using Node.js and TypeScript.

- Frontend: React + Vite + Tailwind + React Query.
- API: Express.
- Database: PostgreSQL + Drizzle ORM.
- API contract: OpenAPI.
- API validation/client generation: Zod + Orval-generated client hooks.
- Long-running project scans are started by API request and tracked as background jobs.

Important locations:

- Database schema: `lib/db/src/schema/`
- OpenAPI contract: `lib/api-spec/openapi.yaml`
- API routes: `artifacts/api-server/src/routes/`
- Scraping and source logic: `artifacts/api-server/src/lib/scraper.ts`
- EPBC scraper: `artifacts/api-server/src/lib/epbc-scraper.ts`
- Frontend: `artifacts/solar-tracker/src/`
- Generated React API client: `lib/api-client-react/src/`

## Contract-first rule

When changing an API contract:

1. Update `lib/api-spec/openapi.yaml` first.
2. Run API code generation.
3. Update server implementation as required.
4. Update frontend usage as required.
5. Run full type checking and build before considering the change complete.

Do not hand-edit generated API-client files when the source of truth is the OpenAPI specification.

## Required validation before merging application changes

Use pnpm only.

- `pnpm run typecheck`
- `pnpm run build`

If the API specification changes, also run:

- `pnpm --filter @workspace/api-spec run codegen`

Database schema changes must be deliberate and reviewed before being applied to production data.

## Migration target

Target architecture:

- GitHub: source of truth.
- Codex Cloud: development, refactoring, tests, and maintenance.
- Railway: application hosting.
- Supabase: PostgreSQL database and authentication; storage only if later required.
- OpenAI: direct official API integration.

## Migration safety rules

- Do not make migration experiments directly on `main`.
- Preserve the working Replit application until Railway + Supabase passes functional verification.
- Do not delete or irreversibly alter the existing Replit database during migration.
- Take and verify a database backup before data migration.
- Do not expose secrets, passwords, API keys, connection strings, Gmail app passwords, or service-role keys in Git.
- Keep secrets in deployment/environment secret stores.
- Do not commit `.env` files. `.env.example` may contain variable names only.
- Prefer small, reviewable migration changes over a large rewrite.
- Preserve existing business logic unless the task explicitly asks to change it.
- Do not rewrite the application simply to fit Railway or Supabase when a small compatibility change is sufficient.

## Replit migration status

The migration branch has removed active runtime dependence on Replit Vite plugins, `REPL_ID`, `REPLIT_DOMAINS`, and the Replit-provided OpenAI client variables. Direct OpenAI calls use `OPENAI_API_KEY`.

Temporary Replit files and dead package/catalog/lockfile declarations may remain for migration reference and lockfile safety. Remove them only after equivalent documentation is preserved and the lockfile can be regenerated and validated with pnpm.

`replit.md` contains valuable product and operational knowledge. Do not delete it until all useful instructions have been carried into durable project documentation.

## Authentication and security migration

Before exposing the Railway deployment publicly:

- Remove any hard-coded authentication secret fallback.
- Move user authentication to Supabase Auth unless explicitly instructed otherwise.
- Enforce authentication/authorization server-side on protected API routes.
- Restrict CORS to the intended production origin(s) where applicable.
- Keep privileged Supabase service-role credentials server-side only.
- Review invitation/access-token behaviour before retiring the current system.

## Database migration

The existing database is PostgreSQL and must be migrated with data integrity checks.

At minimum verify:

- projects
- scans and scan lineage
- contacts/contact enrichment records
- EPBC records
- access/auth-related records as needed for transition
- row counts and representative records before cutover

Do not point production Railway traffic at the new database until verification is complete.

## Source rules

The definitive approved-source list and detailed scraper behaviour currently live in `replit.md` and the scraper source. During migration, preserve those rules exactly unless explicitly instructed to change them.

Adding a new source requires explicit approval and corresponding updates to durable project documentation and scraper configuration.
