# Agentic AI Production Masterplan v1.1

**Core rule:** Build the smallest system that can pass the real test. Add complexity only after evidence proves it is needed.

## Permanent standard
- One product goal. One primary agent. One repository. One database. One production host.
- Humans define outcomes and approve consequential actions; agents build, test, operate within boundaries and report evidence.
- Every feature follows: Define -> Build -> Test -> Measure -> Fix -> Re-test -> Release -> Monitor.
- Security and client-data protection start in version 1.
- Context is a finite engineering resource: send the smallest high-signal context that lets the agent succeed.
- Token burn is an engineering cost: minimise context, tool definitions, repeated data, model strength and unnecessary agent turns.
- Do not add subagents, queues, Redis, microservices, a second host, vectors or a second model until a measured bottleneck justifies it.

## Default stack
- Product planning: ChatGPT Work
- Source of truth: GitHub
- Builder: Codex
- Web app: Next.js + TypeScript
- AI runtime: OpenAI Responses API by default
- Durable/long-running agent runtime: OpenAI Agents API only when its managed harness is justified
- Data/login/files: Supabase
- Tools: OpenAI built-ins -> trusted MCP -> direct API
- Hosting: Railway
- Payments: Stripe Checkout + Customer Portal
- Monitoring: OpenAI traces/evals + Railway/Supabase logs first

## Runtime choice
Use **Responses API** for ordinary request/response workflows and bounded tool use.

Consider **Agents API** only when evidence shows the application benefits from a managed agent harness such as durable long-running sessions, managed context compaction, sandboxed file/code work, large tool sets/tool search, recovery across long tasks, or justified parallel subagents.

Agents API is still a complexity gate, not the new default. Its public-beta status, execution environment, permissions, data flow, cost limits and rollback path must be recorded before adoption.

## Master flow
Idea -> Product Blueprint -> Data/Risk Gate -> GitHub -> Codex vertical slice -> Responses API -> Supabase -> minimum tools -> Railway -> Stripe if needed -> Golden Tests -> Pilot -> Production -> Monitor -> next loop.

## 17-step build process
1. **Define one outcome.** User, input, output, exclusions, 3 measurable success conditions.
2. **Create the minimum product blueprint.** 3-5 screens, workflow, data, tools, acceptance tests, launch scope. Mark nonessential work LATER.
3. **Run the Data + Risk Gate.** Classify data; map User -> App -> Supabase -> OpenAI -> external tools -> result; classify actions GREEN/AMBER/RED/BLACK.
4. **Create one GitHub repository.** Keep durable product, security, eval and decision knowledge in repo docs. Keep AGENTS.md short.
5. **Give Codex one vertical slice.** Build one end-to-end customer path, with tests and preview.
6. **Use the simplest AI runtime that passes.** Responses first; Agents API only when a managed long-running harness is measurably useful.
7. **Engineer context before adding model strength.** Minimal instructions, targeted retrieval, compact tool schemas/results, explicit state, structured output and bounded history/compaction.
8. **Design token efficiency before features.** Cache safely, avoid unchanged work, bound steps/tool calls/output/spend and measure cost per successful task.
9. **Add Supabase with client isolation from day one.** Auth, owner/org scoping, tested RLS, server-side secrets, separate dev/prod.
10. **Connect tools in the shortest reliable order.** Built-in -> trusted MCP -> direct API. Minimum permission and minimum data.
11. **Build security around boundaries, not prompts.** Sandbox risky execution, use least privilege, treat external content as untrusted and require approval for RED actions.
12. **Deploy the smallest Railway shape.** Start with one web service. Add cron, worker or queue only when a trigger is proven.
13. **Use hosted Stripe billing.** Do not build card/payment management.
14. **Create the Golden Test Pack.** Start with 10-20 real cases; every production failure becomes a regression.
15. **Pilot narrowly.** Measure successful-task rate, corrections, latency, tool failures, token/cost per successful task and data-access mistakes.
16. **Release and monitor with rollback.** Branches/PRs, reversible migrations or restore path, backups, production health checks and decision-changing telemetry.
17. **Scale only when a trigger fires.** Complexity must be justified by measured need.

## Complexity gates
See `docs/Complexity-Gates.md`.

## Client data
See `docs/Client-Data-Privacy.md`.

## Golden tests
See `docs/Evals-Golden-Tests.md`.

## Template refresh
See `docs/Template-Improvement-Loop.md`. External technology changes are candidates, not automatic standards.

## Final rule
If a proposed component does not improve a measured customer outcome, security/privacy control, reliability requirement or cost constraint, do not add it.
