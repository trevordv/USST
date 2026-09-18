# Client Data and Privacy Standard

Client data protection is mandatory from the first vertical slice.

## Minimum controls
- Collect only data needed for the feature.
- Classify data as public, internal, personal or sensitive.
- Every customer-owned record must be scoped to its user/organisation.
- Enforce tenant isolation at the database layer with tested RLS.
- Never expose service-role keys, API secrets or admin credentials to browsers or model prompts.
- Use separate development and production environments for real client data.
- Use synthetic or de-identified data for development wherever practical.
- Document exactly what client data is sent to OpenAI, MCP servers and other subprocessors.
- External tools receive only the minimum fields required for the action.
- Define retention and deletion rules for database rows, files, logs and backups.
- Keep audit evidence for consequential actions without logging unnecessary sensitive content.
- Review cross-border disclosure obligations where applicable.
- Consider OpenAI Zero Data Retention for eligible sensitive workloads.
- Backups must receive the same access protection as live data.
- Maintain an incident path for suspected data exposure or credential compromise.

## Data flow map
Before build, document:
User -> App -> Supabase -> OpenAI -> external tool -> result.

For every handoff answer:
1. What data moves?
2. Why is it required?
3. Is personal/sensitive information included?
4. Can it be removed, masked or summarised?
5. Where is it stored?
6. How long is it retained?
7. Who can access it?

## Action risk classes
- GREEN: low-risk read/analyse actions may run autonomously.
- AMBER: constrained creation/preparation actions may run within explicit limits.
- RED: consequential external, financial, deletion, permission or production-write actions require approval or deterministic authorisation.
- BLACK: agents must never grant themselves permissions, expose credentials, disable logs or bypass security controls.

**Privacy principle:** the fact that an agent can access data is never, by itself, a reason to give it that data.
