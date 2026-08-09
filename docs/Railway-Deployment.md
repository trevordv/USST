# USST Railway + Supabase Deployment Runbook

This runbook is for the migration test deployment. The existing Replit application must remain available until Railway + Supabase has been fully verified and explicitly approved for cutover.

## 1. Authentication account

USST uses Supabase Auth for sign-in and the `public.app_users` table as an application allowlist.

Initial administrator:

- Email: `trevordv@gmail.com`
- Role: `admin`
- Active: `true`
- Supabase Auth account: created and email-confirmed
- `app_users.auth_user_id`: linked to the Supabase Auth user

The first invitation email redirected to `http://localhost:3000` because the Supabase Site URL had not yet been changed to the Railway test URL. This does not require deleting or recreating the user. Once Railway has a public domain, update the Supabase Auth Site URL and allowed Redirect URLs to the Railway URL before using password-reset or future invitation links.

Do not store or commit passwords in GitHub.

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

## 4. First Railway deployment

The first Railway deployment can be used to establish the public test URL before the production Replit data is migrated.

Minimum variables for the initial deployment are:

- `DATABASE_URL`
- `NODE_ENV=production`
- `BASE_PATH=/`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

After the deployment succeeds:

1. Generate a Railway public domain.
2. Set `APP_URL` to that exact `https://...up.railway.app` URL in Railway.
3. In Supabase Authentication URL Configuration, set the Site URL to that Railway URL.
4. Add the Railway URL to the allowed Redirect URLs.
5. Redeploy Railway so the updated environment is active.
6. Use the deployed USST sign-in/password-recovery flow rather than any old `localhost` invitation link.

The remaining OpenAI/source credentials can then be added before functional scan/enrichment testing.

## 5. Database migration gate

Before Railway is allowed to act as the replacement application:

1. Take a complete backup/export of the current Replit PostgreSQL database.
2. Preserve the backup unchanged as rollback evidence.
3. Import existing USST production data into Supabase.
4. Verify row counts for every migrated application table.
5. Check representative projects, scans, contacts and EPBC records manually.
6. Confirm scan lineage/history remains intact.
7. Keep the legacy `access_tokens` data only for migration/rollback verification; it is not used for Railway authentication.

Do not delete or modify the Replit production database during this process.

## 6. Functional acceptance checks

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

## 7. Cutover

Only after successful acceptance testing and explicit approval:

1. Merge the migration PR to `main`.
2. Point Railway production deployment at the approved `main` commit.
3. Confirm the production domain and Supabase Auth redirect/site settings.
4. Run a final smoke test.
5. Keep Replit available for a short rollback period.
6. Retire Replit only after the rollback period is complete and the replacement is stable.
