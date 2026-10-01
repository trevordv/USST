# Railway acceptance check for Issue #14

Use this checklist after deploying the draft branch to Railway. The automated
suite verifies the same ESM/esbuild module shapes, but a live scan is still
required because official source access and authenticated credentials are
deployment concerns.

## Configuration

Required:

- `OPENAI_API_KEY`
- the existing database and Supabase variables
- `ALTENERGY_USERNAME` and `ALTENERGY_PASSWORD`
- `LUVI_USERNAME` and `LUVI_PASSWORD`

Do not add `AI_INTEGRATIONS_OPENAI_BASE_URL` or
`AI_INTEGRATIONS_OPENAI_API_KEY`. The application uses the standard OpenAI API
endpoint. The five `BROWSE_AI_*` variables remain optional; when an approved NZ
robot is absent, the official-host-scoped OpenAI fallback must run.

## Live scan verification

1. Deploy the draft branch without changing the production database or Auth
   configuration.
2. Start one full scan and record its run ID.
3. Confirm the scan begins with `configuredSourceCount: 34` and completes with
   `sourcesScanned: 34`.
4. Confirm at least one source invokes `openai-web-search` and does not log a
   missing `AI_INTEGRATIONS_OPENAI_BASE_URL` or
   `AI_INTEGRATIONS_OPENAI_API_KEY` error. Its final diagnostic must be
   `success`, `empty`, or a genuine provider/source failure rather than a
   Replit-configuration failure.
5. Confirm AEMO logs a final `success` or `empty` outcome using
   `aemo-workbook`, with no `readWorkbook is not a function` error.
6. Confirm AltEnergy authenticates and emits a final outcome.
7. Confirm LUVI authenticates/decrypts and emits a final outcome.
8. Count one final outcome for each of the 32 generic sources plus AltEnergy
   and LUVI. Each outcome must retain its method, project count, and duration.

The scan remains subject to the existing AU/NZ, solar or solar+BESS, minimum
5 MW, no standalone BESS, no wind-only, deduplication, historical-data,
Supabase Auth, and access-control rules.
