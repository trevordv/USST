# Narrogin reconciliation (Issue #46)

This is an additive reconciliation plan. It has not been applied to production.
No project row, ID, scan lineage, external ID or source evidence is deleted.

| Legacy RUN-0119 row | Canonical project | Reason |
| --- | --- | --- |
| 1563 Narrogin East Renewable Energy Project | 570 Narrogin East Hybrid Project | Lightsource bp East alias; article reports 150 MW solar, 250 MW wind and 200 MW BESS. |
| 1564 Narrogin East Renewable Energy Precinct | 570 Narrogin East Hybrid Project | Contextual wording for the same Lightsource bp East development. |
| 1565 Ace Power's approved Narrogin Solar Farm | 554 Narrogin Solar Farm & BESS | Separate ACE Power/TagEnergy development south of Narrogin; incidental reference, not a 23 September update. |

The schema adds `project_reconciliations` for a reviewed future mapping and
`project_source_events` for canonical-project/article/date deduplication. The
migration deliberately contains no data manipulation statement. A separately
reviewable, rollback-only plan is at
`supabase/reconciliation/20260927_narrogin_legacy_review.sql`; it includes
pre/post checks and inserts mappings only after explicit approval.
