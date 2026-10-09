# AI Observability

All paid AI calls should emit a common usage record.

Recommended fields:

- operation
- model
- provider response id
- source/project identifiers where appropriate
- input tokens
- cached input tokens
- output tokens
- reasoning tokens if exposed
- tool/web-search calls if exposed
- cache hit
- success/failure
- result count
- latency
- escalation reason
- estimated cost
- non-sensitive metadata

## Cost configuration

Keep model/tool pricing in one versioned configuration helper. Do not scatter price constants through feature code. Pricing is operational metadata and should be easy to update without changing business logic.

## Failure behaviour

Telemetry must be best-effort and non-blocking. A logging failure cannot turn a valid business result into an application failure.

## Dashboards / queries

At minimum support:

- calls today
- estimated cost today
- calls last 30 days
- estimated cost last 30 days
- cost by operation
- cost by model
- cache-hit rate
- escalation rate
- repeated paid zero-result operations

## Privacy/security

Never log API keys, passwords, cookies, auth headers, service-role credentials or unnecessary raw prompts/source contents.
