# USST Architecture Decision Log

This log records material USST deviations from the generic Agentic App Template baseline.

## 2026-09-19 — Adopt Agentic App Template v1.1

**Decision:** Adopt `trevordv/Agentic-App-Template` v1.1 at commit `6bc4275ce99d9444ea383f8d48f47b6adce7e149` as the governing engineering baseline.

**Reason:** Standardise Loop Engineering, security/privacy, token/cost controls, Golden Tests, complexity gates, observability and production acceptance for future USST work.

**USST exceptions retained:**

- Existing frontend remains React + Vite rather than migrating to Next.js.
- Existing API remains Express with OpenAPI contract-first generation.
- Existing pnpm monorepo structure remains.
- Existing PostgreSQL/Drizzle data layer remains.
- Railway + Supabase remain the production runtime/data platform.
- Existing background scan-job pattern remains.
- Existing strict 34-source whitelist and AU/NZ solar eligibility rules remain project-specific hard requirements.

**Evidence:** These components already support the deployed product and changing them solely to match a generic default would add risk and complexity without a measured customer benefit.

**Exit path:** Revisit an exception only if a measured reliability, security, cost, maintainability or product requirement triggers the relevant complexity gate.

## Decision entry template

### YYYY-MM-DD — Decision title

- Observed problem:
- Evidence / metric:
- Simplest attempted fix:
- Decision:
- Security / privacy impact:
- Token / cost impact:
- Deployment impact:
- Rollback / exit path:
