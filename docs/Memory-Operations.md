# Memory Operations

## Migration

Do not apply the production migration automatically. After backup and review, apply `supabase/migrations/20260813080138_memory_learning_loop.sql` through the established Supabase migration workflow. The migration creates only new tables, indexes, constraints, comments, RLS state, and privilege revocations.

Validate after staging:

```sql
select relname, relrowsecurity
from pg_class
where relname like 'agent_%'
order by relname;

select table_name, privilege_type, grantee
from information_schema.role_table_grants
where table_name like 'agent_%'
  and grantee in ('anon', 'authenticated');
```

The second query should return no rows. Verify a normal user can submit feedback through the API, cannot open `/api/learning/dashboard`, and an administrator can review candidates.

## Railway configuration

No new service is required. Keep the existing `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY`. Optional freshness settings are:

- `CONTACT_MEMORY_CONFIRMED_DAYS=90`
- `CONTACT_MEMORY_FAILED_DAYS=7`

Deploy application code only after the additive migration is present in the target Supabase database. A deployment before migration will fail only on learning paths, but source telemetry writes will warn, so migrate staging first.

## Administration

Administrators use **Learning / Memory** to inspect pending learnings, approved knowledge, source reliability, feedback, and conflicts. Approve only when evidence supports reuse. Reject uncertain items with a reason. Do not approve an alias solely because spelling is similar.

## Hygiene

Identical observations increment rather than insert. `expires_at` marks low-value memory and telemetry for hygiene; `pruneExpiredTransientData()` expires memory and removes only transient learning events. Approved knowledge, feedback, conflicts, and superseded decisions are retained. Contradictions are superseded or resolved, never erased as ordinary cleanup.

Recommended scheduled maintenance is a daily call from a controlled server job after operational monitoring is established. No database cron is introduced in this change.

## Rollback

Application rollback is safe because existing tables are unchanged. The new tables may remain unused. If schema removal is ever required, export their audit data first and use a separate reviewed down migration; production table deletion is intentionally not included here.
