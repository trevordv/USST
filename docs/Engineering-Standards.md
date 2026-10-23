# Engineering Standards

- GitHub is the source of truth.
- Non-trivial Codex work uses dedicated branches and draft PRs.
- Runtime secrets live only in environment variables.
- Use Supabase Auth by default where authentication is needed.
- Apply least privilege and RLS.
- Schema changes require migrations.
- Apply migrations before code that depends on them.
- Prefer additive changes.
- Never silently rewrite production data.
- Separate `event_date`, `discovered_at`, `last_seen_at`, `created_at`, `updated_at`.
- Never fabricate domain dates from scan/import timestamps.
- Normalize runtime DB values defensively.
- Test production-equivalent module/runtime behaviour.
- HTTP 200 does not prove extraction usability.
- Distinguish access, auth, extraction, network and rate-limit failures.
- Use bounded concurrency.
- Respect external access controls.
- Preserve provenance.
- Human approval governs critical learned knowledge.
- Align Railway and Supabase regions when practical.
- Inspect Railway logs after significant deployments.
- Every production bug gets a regression test where practical.

## AI engineering standards

- Prefer deterministic code/SQL for calculations, filtering, thresholds, state transitions, deduplication and validation.
- Route runtime model calls through one shared AI policy/gateway layer.
- Default to the lowest-cost model tier that passes the affected Golden Tests.
- Escalate to a stronger model tier only on explicit technical or quality failures; do not hard-code the template to transient model names.
- Never escalate because a valid result is empty or because a result fails downstream business eligibility.
- Cache paid model results when reuse is safe; valid empty results should also be cached.
- Use stable content hashes to avoid repeated AI work on unchanged inputs.
- Set explicit output-token limits and request compact structured responses.
- Record model, operation, usage, cache status, outcome and estimated cost where available.
- AI logging must never contain credentials, cookies, auth headers or unnecessary raw sensitive content.
- AI usage logging failures must not break the application.
- Every new AI feature requires tests proving cache behaviour, bounded retries/escalation, and preservation of hard rules.
- Before merge, document the expected worst-case AI calls per feature execution.

## Context engineering standard

Treat model context as a limited runtime resource.

- Keep stable instructions short, explicit and at the correct level of abstraction.
- Retrieve only information needed for the current decision; do not dump entire databases, histories or documents.
- Prefer compact schemas and filtered tool results over raw payloads.
- Keep authoritative state outside model context when it must survive, be audited, or enforce permissions.
- For long sessions, use bounded summarisation/compaction and preserve critical identifiers, permissions, provenance, unresolved tasks and failures.
- Do not assume a longer context window removes the need for context selection.
- Measure whether additional context improves Golden Test performance enough to justify its token/cost and latency.

## Harness choice

- Start with Responses API and application-owned orchestration.
- Use Agents API only when the managed harness provides a measured benefit for durable sessions, long-running work, sandboxed code/files, context compaction, large tool sets/tool search, recovery, or parallel subagents.
- Keep security, authorization, business rules and durable audit state outside the model/harness.
- A move to Agents API requires a Decision Log entry covering beta risk, environment/sandbox choice, permissions, data exposure, spend limits, observability and rollback.
