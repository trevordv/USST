# Complexity Gates

Complexity is not a starting feature. It must be earned by evidence.

| Area | Start | Allowed progression | Trigger |
|---|---|---|---|
| Agent runtime | Responses API | Agents API managed harness | durable/long-running sessions, sandboxed file/code work, context compaction, tool-search scale or recovery materially improves the measured result |
| Agent topology | One primary agent | bounded subagents | independent parallel work measurably improves quality/latency enough to justify coordination, context and cost |
| Runtime | One Railway service | cron -> worker -> queue | scheduling, long jobs, concurrency or retry reliability requires it |
| Data | Postgres queries | targeted retrieval -> vectors | ordinary retrieval cannot find relevant information reliably |
| Provider | Default provider | second provider | missing capability, measurable quality/cost advantage or resilience need |

Before adding complexity, record in `docs/Decision-Log.md`:
- observed problem
- evidence/metric
- simplest attempted fix
- proposed addition
- expected benefit
- security/data/token/deployment impact
- rollback/exit path
