# Controlled Learning Loop

USST follows a deterministic loop:

1. Observe source, parser, classification, enrichment, or user-feedback outcomes.
2. Retrieve memory and approved knowledge scoped to the current entity.
3. Decide using hard business rules first, then approved knowledge, then advisory memory.
4. Act through the existing scanner, qualification, deduplication, or enrichment workflow.
5. Measure an action, safe context, duration, and outcome.
6. Compare success, failure, later contradiction, and human feedback.
7. Deduplicate or update memory.
8. Create a knowledge candidate when evidence is useful and structured.
9. Require administrator approval; conflicts block authority.
10. Reuse only approved knowledge and fresh, scoped memory.

## What is learned

Initial integrations capture source access/parser outcomes, fallbacks, response time, qualifying-project count, project acceptance/rejection, user corrections, aliases, duplicate reports, false positives, and contact enrichment successes or time-bounded failures.

Source reliability is a transparent 0–100 diagnostic derived from access success, parser success, and fallback reliance. It improves diagnostics but never removes a source or changes the approved registry.

Confirmed contacts remain reusable for 90 days by default. An identical failed developer search is paused for 7 days by default. Both windows are configurable, and expired entries retry; no failure permanently suppresses enrichment.

## Hard-rule boundary

Memory and knowledge cannot override geographic scope, 5 MW minimum, required solar component, exclusion of standalone BESS and wind-only projects, approved sources, authentication, deletion policy, or database access controls. The project eligibility functions remain the final gate. OpenAI is not used for retrieval, confidence, freshness, deduplication, or promotion mechanics.

## Metrics

Safe learning events support counts for memory created/reused, feedback received, candidates created, knowledge approved/rejected, and external API calls avoided. Values such as tokens, cookies, credentials, and authorization headers are redacted before persistence.

## Runtime reuse and closed sequence

The combined scanner calls `buildAgentContext()` only after the immutable gates pass. It retrieves at most 20 records for the current project name, developer, location, source, and source domain.

`feedback -> memory -> knowledge candidate -> administrator approval -> scoped retrieval -> advisory runtime decision -> telemetry`

- Approved false-positive knowledge can advise rejection only when the normalized project pattern and at least one scoped signal match. It does not perform broad text blocking.
- Approved developer aliases canonicalise the stored developer while `developer_source_value` preserves the source spelling.
- Approved project aliases and duplicate relationships require location, developer, source, or domain corroboration. Name similarity alone never merges projects.
- Runtime influence is recorded as `knowledge_reused`, `false_positive_avoided`, `alias_applied`, `duplicate_candidate_matched`, or `external_api_call_avoided`, with safe provenance IDs.

Duplicate feedback requires a user to search for and select a distinct canonical project. The feedback ledger stores both IDs, reason, user, and timestamp; it does not merge or delete either project. Open conflicts block ordinary approval. Administrators can reject a value while leaving the conflict open, select and approve a preferred value (rejecting alternatives), or dismiss the conflict with a required reason. The actor, action, selected value, reason, and resolution timestamp remain auditable.
