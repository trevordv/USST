# USST Alignment to Agentic App Template

USST adopts `trevordv/Agentic-App-Template` as its governing engineering baseline.

- Template repository: https://github.com/trevordv/Agentic-App-Template
- Adopted baseline: v1.1
- Baseline commit: `6bc4275ce99d9444ea383f8d48f47b6adce7e149`
- Adoption date: 19 September 2026

## Rule precedence

1. Security, privacy, human-approval and production-safety controls in the Agentic App Template are mandatory.
2. USST-specific product rules in `AGENTS.md` remain authoritative for scope, source whitelist, AU/NZ eligibility, minimum capacity, scan lineage, contract-first API behaviour, and contact enrichment.
3. Existing USST architecture is preserved where it is already proven and production-compatible. The template's default stack is a starting default for new projects, not a reason to rewrite USST.
4. Any material exception to the template must be documented in `docs/Decision-Log.md` with evidence and a rollback/exit path.
5. Reusable lessons from USST may be proposed back to the template only through a reviewed template PR; USST must never silently modify the master template.

## Local governing documents

Coding agents must read these before non-trivial work:

- `AGENTS.md`
- `docs/Agentic-Masterplan.md`
- `docs/Loop-Engineering.md`
- `docs/Client-Data-Privacy.md`
- `docs/Security-Model.md`
- `docs/AI-Cost-Control.md`
- `docs/Evals-Golden-Tests.md`
- `docs/Complexity-Gates.md`
- `docs/Engineering-Standards.md`
- `docs/Testing-Strategy.md`
- `docs/Production-Acceptance.md`
- `docs/Observability.md`
- `docs/AI-Observability.md`
- `docs/Database-Migrations.md`
- `docs/External-Integration-Standard.md`
- `docs/Agent-Governance.md`
- `docs/Decision-Log.md`

## USST-specific interpretation

For USST, the template means:

- GitHub remains source of truth.
- Codex works on dedicated branches and opens draft PRs for non-trivial changes.
- Use the smallest vertical slice that fixes the measured problem.
- Prefer deterministic parsing, SQL and explicit rules before paid AI.
- AI fallback must be bounded, observable and tested against real scan cases.
- Keep context and tool output small and high-signal.
- Measure paid-AI cost per successful scan/extraction task.
- Preserve Supabase Auth, authorization and RLS; privileged credentials remain server-side.
- Railway remains the minimum production host shape unless a measured complexity gate is triggered.
- Every production defect becomes a regression/Golden Test.
- Production changes require test/typecheck/build and applicable security/data checks.
- RED production, deletion, permission and consequential data actions require explicit human approval or deterministic authorization.
- New infrastructure such as queues, Redis, vectors, extra services, subagents or alternate model providers requires a documented complexity-gate decision.

## Refresh process

When the master template changes materially:

1. Review the template changelog and latest baseline commit.
2. Compare the changed standards against USST.
3. Update the local USST copies only where applicable.
4. Record new exceptions or decisions.
5. Validate that project-specific rules are preserved.
6. Merge through normal review.

The master template is not automatically pulled into production code. This prevents an upstream template change from silently changing USST behaviour.
