# USST Railway + Supabase Deployment Runbook

This runbook is for the migration test deployment. The existing Replit application must remain available until Railway + Supabase has been fully verified and explicitly approved for cutover.

## 1. Authentication account

USST uses Supabase Auth for sign-in and the `public.app_users` table as an application allowlist.

Initial administrator allowlist entry:

- Email: `trevordv@gmail.com`
- Role: `admin`
- Active: `true`

Create the matching Supabase Auth user directly in the Supabase dashboard. Choose the password there; do not store or commit the password in GitHub.

On the first successful USST API request, the server will link the Supabase Auth user ID to the matching active `app_users` row.

## 2. Railway service

Create one Railway service from the GitHub repository and deploy the `migration/railway-supabase` branch during migration testing.

The repository-level `railway.json` defines:

- Railpack builder
- build command: `pnpm run build`
- direct Node start command: `node --enable-source-maps ./artifacts/api-server/dist/index.mjs`
- health check: `/api/healthz`
- restart-on-failure policy

Do not deploy `main` until cutover is explicitly approved.

## 3. Required Railway variables

Set secrets in Railway, not in GitHub.

### Database

- `DATABASE_URL` — Supabase Postgres connection string used by Drizzle.

### Application

- `NODE_ENV=production`
- `APP_URL` — set to the Railway public URL after the domain is generated.
- `BASE_PATH=/`
- `PORT` — Railway normally provides this automatically; do not hard-code it if Railway injects it.

### Supabase Auth

Server-side:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Frontend build-time:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The frontend values are intentionally publishable credentials. Never expose a Supabase service-role or secret key to Vite/browser variables.

### OpenAI

- `OPENAI_API_KEY`
- `OPENAI_MODEL` if an explicit model override is required by the application.

### Approved source credentials

Set only the credentials actually used by the existing USST configuration:

- `ALTENERGY_USERNAME`
- `ALTENERGY_PASSWORD`
- `LUVI_USERNAME`
- `LUVI_PASSWORD`
- `APIFY_API_TOKEN`
- `LUSHA_API_KEY`
- `FIRECRAWL_API_KEY`

Do not add new sources or source credentials without explicit approval.

## 4. Database migration gate

Before Railway is allowed to act as the replacement application:

1. Take a complete backup/export of the current Replit PostgreSQL database.
2. Preserve the backup unchanged as rollback evidence.
3. Import existing USST production data into Supabase.
4. Verify row counts for every migrated application table.
5. Check representative projects, scans, contacts and EPBC records manually.
6. Confirm scan lineage/history remains intact.
7. Keep the legacy `access_tokens` data only for migration/rollback verification; it is not used for Railway authentication.

Do not delete or modify the Replit production database during this process.

## 5. Functional acceptance checks

Using the Railway test URL:

- Sign in as the administrator.
- Confirm an invalid/unapproved account cannot access the API.
- Load Dashboard.
- Load Projects and representative project detail records.
- Load Scan History and representative scan details.
- Load EPBC Projects.
- Run a controlled approved-source scan.
- Verify source whitelist and >=5 MW / solar-component rules have not changed.
- Run contact enrichment only as an explicit user action.
- Verify OpenAI-assisted functions that are currently part of USST.
- Sign out and sign back in.
- Restart/redeploy the Railway service and verify persistent data remains in Supabase.

Compare the results against the still-running Replit application before approval.

## 6. Cutover

Only after successful acceptance testing and explicit approval:

1. Merge the migration PR to `main`.
2. Point Railway production deployment at the approved `main` commit.
3. Confirm the production domain and Supabase Auth redirect/site settings.
4. Run a final smoke test.
5. Keep Replit available for a short rollback period.
6. Retire Replit only after the rollback period is complete and the replacement is stable.
