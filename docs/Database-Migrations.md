# Database Migration Standard

Sequence:
1. Codex creates migration.
2. Tests/typecheck/build pass.
3. Human reviews.
4. Back up when appropriate.
5. Apply migration to Supabase.
6. Verify schema/RLS/indexes.
7. Merge/deploy dependent code.
8. Verify production.

Rules:
- Prefer additive changes.
- Avoid destructive changes.
- Data remediation is separate and scoped.
- Never silently rewrite production data.
- Preserve provenance.
