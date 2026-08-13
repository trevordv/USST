# Knowledge Governance

## Authority order

1. Hard rules in code and engineering documentation.
2. Administrator-approved knowledge.
3. Active scoped memory as advisory context.
4. Current task data and source evidence.

All knowledge candidates currently require human review. Human approval assigns high confidence but does not grant authority to override hard rules.

## Confidence

- Low: fewer than three independent observations, stale evidence, or any unresolved conflict.
- Medium: at least three independent observations.
- High: five independent observations without conflict, or human confirmation.

Confidence is evidence communication, not probability. Independent provenance matters more than repeated copies from one source.

## Promotion and provenance

A candidate requires at least one memory record. It stores the full supporting memory ID list and total observation count. Project aliases, developer aliases, duplicate relationships, validated contacts, and false-positive patterns may be proposed. Name similarity alone is never sufficient to merge projects or developers.

## Conflicts

When the same knowledge key has different values, USST creates an open conflict with both knowledge and memory IDs. Neither value silently replaces the other. An administrator must inspect the evidence and explicitly resolve, dismiss, reject, approve, edit, or supersede the records. Contradictory history remains auditable.

## Security and privacy

Learning tables use row-level security and explicitly revoke `anon` and `authenticated` Data API privileges. Railway accesses them through the existing server-side PostgreSQL connection. Express requires an active Supabase-authenticated `app_users` record for feedback and the `admin` role for dashboard and review operations.

Passwords, secret keys, access/refresh tokens, authorization values, cookies, sessions, and database URLs are excluded recursively. Logs contain aggregate configuration status and event metadata, never secret values.
