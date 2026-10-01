# AI Cost and Token Control

Optimise **cost per successful task**, not token count or model price in isolation.

## Required decision order
1. Can deterministic code, SQL or an existing parser solve it?
2. Can a safe cached result be reused?
3. Has meaningful input changed?
4. Can targeted retrieval replace large-context input?
5. If AI is required, use the lowest-cost model that passes the affected Golden Tests.
6. Escalate only for defined quality/technical failure.
7. Record outcome and token/cost telemetry.

## Token-burn rules
- Keep stable instructions concise and reusable.
- Keep `AGENTS.md` short; link to targeted docs.
- Do not replay full chat histories, databases or documents when a focused query is enough.
- Trim/summarise tool output before returning it to the model.
- Prefer structured outputs when the application consumes fields.
- Use prompt caching where supported.
- Use content hashing and safe result caching.
- Use compaction for long sessions instead of unbounded transcript replay.
- Limit maximum turns, tool calls, runtime, output tokens and spend per task.
- One capable agent is the default; agent handoffs must earn their coordination/context cost.

## Never use AI for
- deterministic arithmetic/thresholds
- database comparisons/deduplication
- permissions, approvals or security enforcement
- deterministic state transitions
- schema validation that ordinary code can perform

## Acceptance for new AI features
Before merge report:
- why AI is needed
- runtime choice: Responses or justified Agents API
- starting model and why it is sufficient
- maximum steps/tool calls/output tokens
- context/retrieval plan
- caching/content-hash plan
- worst-case paid calls and spend
- Golden Test evidence
