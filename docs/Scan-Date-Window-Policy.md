# Scan Date-Window Policy

The authoritative unit shown in scan results is persisted `scan_projects` lineage. A bounded scan links a project only when a source-supported announcement/event date falls inclusively inside the requested `start_date` and `end_date`.

## Effective date

- Existing project: use the persisted project announcement date. Rediscovery or page refresh updates `last_seen_at` only and never makes the announcement current.
- New project: use the source-reported announcement/event date.
- Unknown date: exclude from bounded scans. An unbounded scan may store the project with a null `announced_date`, `announced_date_evidence = 'unknown'`, and a separate `last_seen_at`.

LUVI is a current pipeline snapshot and, as observed in its payload, does not generally provide a per-project announcement/event date. The scraper therefore no longer assigns scan/import day as `announced_date`. It accepts only explicitly named announcement/event date fields if LUVI introduces them.

## RUN-0095 and historical remediation

This PR does not rewrite historical production rows or lineage. RUN-0095's 204 LUVI rows dated 2026-08-04 demonstrate that historical LUVI dates require a separate, reviewed data-quality exercise before mutation. Recommended remediation:

1. Audit LUVI rows by creation time, first scan lineage, and raw/source evidence to distinguish genuine dates from import fallbacks.
2. Produce a dry-run report of proposed `announced_date = null` changes and affected historical counters/lineage.
3. Obtain explicit production approval before changing rows or recalculating historical scans.

New scans persist their requested window and each relation's effective date/evidence, so counters, Scan Detail ("View found"), and project-directory `scanId` ("View new") share the same qualified lineage.
