# Agent Governance

AI assists the system; it does not own hard policy.

## Hard-rule boundary

The following must remain deterministic or explicitly governed outside the model:

- security and authorization
- eligibility criteria
- compliance rules
- approved source restrictions
- approval requirements
- position/risk limits where applicable
- immutable strategy constraints
- rule-promotion governance
- destructive action permissions

An AI response may create a candidate or recommendation. It cannot silently weaken, bypass or rewrite a hard rule.

## Learning systems

Where memory/learning is enabled:

```text
observation
  -> evidence/performance
  -> candidate learning
  -> review/approval where required
  -> approved rule/knowledge
  -> runtime use
```

A candidate rule is not an active rule. Runtime model output must not autonomously promote candidates.

## Cost optimisation boundary

Cost optimisation must never be achieved by:

- dropping required eligibility checks
- substituting model judgement for deterministic hard gates
- removing required provenance
- accepting unapproved source domains
- silently reducing safety/compliance validation

Optimise call frequency, caching, routing, token limits and deterministic preprocessing instead.
