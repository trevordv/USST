# Golden Tests

Golden Tests are the quality system for nondeterministic agent behaviour.

## Start small
Create 10-20 real scenarios covering:
- normal case
- missing data
- conflicting data
- bad tool result
- timeout/retry
- duplicate action
- prompt injection
- unauthorised data request
- high-cost task
- user cancellation
- one or more critical business-rule cases

## Rules
- Every production failure becomes a permanent regression test.
- Model, prompt, tool or workflow changes do not ship unless affected Golden Tests remain acceptable.
- Measure cost per successful task, not token count alone.
- Include security/data isolation tests for client-facing systems.
- Include allow and deny tests for RLS-protected data.
- Keep tests representative, not huge.

## Minimum evidence at release
- pass/fail result
- relevant quality threshold
- token/cost impact
- latency impact
- tool failures
- security/data-access outcome
