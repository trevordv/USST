# Loop Engineering Standard

Every non-trivial feature follows the same short loop:

**Define -> Build -> Test -> Measure -> Diagnose -> Fix -> Re-test -> Release -> Monitor**

## Operating rules
1. Define one observable outcome and acceptance criteria.
2. Implement the smallest change/vertical slice.
3. Run the closest relevant automated check and affected Golden Tests.
4. Inspect actual logs/results, including token/cost impact where AI is involved.
5. Fix root cause, not the visible symptom.
6. Re-run affected checks, then broader verification.
7. Release only when evidence meets the acceptance threshold.
8. Monitor production evidence and convert real failures into regression/Golden Tests.

## Stop conditions
- Do not retry the same approach indefinitely.
- Escalate reasoning/tooling only after a cheaper attempt fails for a clear reason.
- If repeated iterations fail, stop and report the blocker and required design/input decision.
- Do not silently burn paid API or infrastructure budget.

## Verification
A step is verified only when a real check ran and passed. Code that looks correct is not proof.

Verify as applicable:
- types/lint/build
- unit/integration/regression tests
- Golden Tests
- auth/authorization/RLS allow and deny cases
- prompt-injection/security boundaries
- migrations/rollback
- success/empty/retry/timeout/failure paths
- tool permissions
- token/cost limits
- production health and critical user journey

## Continuous template improvement
Reusable lessons from real projects may be proposed back to `trevordv/Agentic-App-Template` through a dedicated branch/PR with evidence and human approval. Child projects must not silently self-modify the master template.
