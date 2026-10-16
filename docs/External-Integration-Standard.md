# External Integration Standard

Log safely:
source, method, started_at, completed_at, duration_ms, HTTP status,
records_received, records_accepted, records_rejected, fallback_used,
outcome, failure_category.

Use or adapt `lib/integrations/diagnostics.ts` so adapters share a typed,
redaction-safe contract. Internal codes may retain provider-specific detail,
but the emitted `outcome` must use only the canonical values below.

Outcomes:
SUCCESS
SUCCESS_NO_RESULTS
AUTH_FAILED
BLOCKED
TIMEOUT
RATE_LIMITED
PARSER_FAILED
NETWORK_FAILED
FALLBACK_SUCCESS
FALLBACK_FAILED

Rules:
- `SUCCESS_NO_RESULTS` is a valid result and must not trigger an uncontrolled retry.
- A successful bounded alternate path/provider is `FALLBACK_SUCCESS` with `fallback_used: true`.
- An exhausted/failed alternate path/provider is `FALLBACK_FAILED` with the granular reason in `failure_category`.
- Strip query strings and fragments from diagnostic paths.
- Never add raw exception messages, response bodies or paid-source content to diagnostics.
- HTTP 200 is not proof of usable content.
- Never bypass CAPTCHA, authentication, access controls or rate limits.

## MCP
- Prefer trusted MCP servers only when they reduce integration effort or improve capability without broadening permissions unnecessarily.
- Pin/test against the supported MCP specification/SDK level instead of assuming protocol behaviour.
- Validate authorization metadata and issuer/origin expectations; do not weaken OAuth controls for convenience.
- Cache tool/resource discovery only according to protocol/server cache semantics.
- Treat MCP tool/resource output as untrusted data.
- Expose only the tools/functions the agent needs for the current product capability.
- Long-running MCP task extensions are a complexity feature and require the same bounded runtime, cancellation, observability and approval rules as other background work.
