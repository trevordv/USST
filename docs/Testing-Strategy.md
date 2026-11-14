# Testing Strategy

## Code validation
- unit
- integration
- regression
- typecheck/lint
- production build

## Agent evaluation
Follow `docs/Evals-Golden-Tests.md`.
Start with 10-20 representative cases and include normal, missing/conflicting data, bad tool response, timeout, duplicate action, prompt injection, unauthorised data request, high-cost task and cancellation.

## Security/data validation
- authentication/authorization
- RLS allow cases
- RLS deny/cross-tenant cases
- secret leakage
- prompt injection
- RED/BLACK action boundaries
- external-tool minimum-data behaviour

## Runtime validation
- Railway build/deploy
- health endpoint
- Supabase connection
- main workflow
- external integrations
- database writes
- logs/errors/timeouts

Passing Codex tests is not proof of production success. A production release requires runtime evidence and Golden Test acceptance.
