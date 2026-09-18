# Observability

Track:
- route durations
- background-job durations
- source durations
- database/auth failures
- fallback use
- memory/knowledge reuse
- paid API calls avoided
- AI calls by operation and model
- input, cached-input and output tokens when exposed
- cache hit/miss
- escalation reason and final model
- web-search/tool calls when exposed
- AI latency, success/failure and result count
- estimated AI cost using centrally maintained pricing configuration

Recommended operational views:
- calls and estimated cost today
- calls and estimated cost over 30 days
- cost by operation
- cost by model
- sources/features with repeated zero-result paid calls
- cache savings
- escalation rate

Never log passwords, keys, tokens, cookies, auth headers, service-role credentials or unnecessary raw sensitive prompt contents.

AI usage telemetry is non-blocking: an observability write failure must not fail otherwise-valid business processing.
