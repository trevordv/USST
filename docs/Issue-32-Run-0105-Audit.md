# Issue 32 — RUN-0105 audit

Audit date: 14 September 2026. Scope: the retained RUN-0105 evidence in Issue
#32, the production Projects Directory viewed through the authenticated USST UI,
and the most recent per-source verification report in
`Source-Access-Verification-2026-08-30.md`.

## Duplicate groups (read-only production audit)

No production rows were changed or merged. These are search groups for review,
not automatic merge instructions: a human must confirm project identity and the
surviving canonical row.

| Search group | Current rows | Audit finding |
| --- | ---: | --- |
| Boree | 1 | Project 590 is the single canonical row: Boree Solar Farm, Venn Energy, 200 MW, Geurie NSW, announced 2026-03-26. |
| Fraser Coast | 10 | Eight likely hybrid-project variants (IDs 1544, 1402, 1073, 1090, 1079, 1088, 1052 and the exact-name pair 1227/789) plus a likely distinct 53 MW Fraser Coast Solar Park (667). Review before merging. |
| Waroona | 10 | Nine likely current Renewable Energy Project variants (18, 1055, 1059, 1064, 1071, 1080, 1086, 1097, 1098), spanning 120/132 MW and Stage 1/One aliases, plus the potentially distinct 2020 Waroona Solar Farm (925). |
| Wooderson | 5 | Five likely variants (119, 829, 1011, 1380, 1541), with 450 MW, 150 MW and missing-capacity records and conflicting NSW/QLD locations. |

The Issue #32 matcher prevents a new Watts News event from creating another row
when it has either an exact normalized name or an alias plus developer, state or
capacity corroboration. It intentionally does not alter the historical groups
above.

## Approved-source health matrix

RUN-0105 completed all 34 configured source operations, but completion alone is
not proof of extraction health. Per-source outcomes are currently emitted to
runtime logs and are not persisted on the scan record. Where RUN-0105 retained
evidence is unavailable, the table says so rather than inferring health from the
553-project aggregate. `Needs retained outcome` is itself an observability gap.

| Approved source | Classification | Evidence / next check |
| --- | --- | --- |
| Renew Economy | Needs retained outcome | No per-source RUN-0105 result is stored with scan 105. |
| PV Magazine Australia | Needs retained outcome | Same. |
| EcoGeneration | Needs retained outcome | Same. |
| Utility Magazine | Needs retained outcome | Same. |
| ESD News | Needs retained outcome | Same. |
| RenewMap | Needs retained outcome | Same. |
| ARENA | Healthy fallback (last verified) | RSS recovered the source after direct HTML classification failed in scan 101; verify RUN-0105 direct/fallback counters. |
| Clean Energy Regulator | Needs retained outcome | No per-source RUN-0105 result is stored. |
| AEMO | Degraded / fallback | RUN-0105 evidence reports the official workbook HTTP 403. Scoped fallback exists, but direct official extraction is unhealthy. |
| Capacity Investment Scheme | Needs retained outcome | No per-source RUN-0105 result is stored. |
| EPBC Act Referrals | Needs retained outcome | Official portal/ArcGIS behavior is tracked separately by Issue #31. |
| EPBC Referrals Spatial Database | Needs retained outcome | No per-source RUN-0105 result is stored. |
| NSW Planning Portal | Unexpected repeated zero | One of five zero-result sources in scan 101; Issue #32 reports repeated approved-source fallback zeros. Needs a fresh retained outcome. |
| NSW Planning Renewable Energy | Unexpected repeated zero | Same. |
| Planning Victoria | Degraded / blocked (last verified) | Direct workstation check returned an access challenge; verify Railway outcome. |
| QLD Coordinator-General | Unexpected repeated zero / degraded | Repeated zero result and prior direct access challenge. |
| SA Energy & Mining | Degraded / blocked (last verified) | Prior direct access challenge; verify Railway outcome. |
| WA EPA | Degraded / blocked (last verified) | Prior direct access challenge; verify Railway outcome. |
| NT Development Applications | Unexpected repeated zero | One of five zero-result sources in scan 101; needs a fresh retained outcome. |
| Tasmania EPA | Needs retained outcome | No per-source RUN-0105 result is stored. |
| Planning Alerts Australia | Needs retained outcome | No per-source RUN-0105 result is stored. |
| Clean Energy Council | Needs retained outcome | No per-source RUN-0105 result is stored. |
| QLD Planning – Renewable Energy | Unexpected repeated zero / degraded | Repeated zero result and prior direct access challenge. |
| Smart Energy Council | Needs retained outcome | No per-source RUN-0105 result is stored. |
| Energy Magazine | Degraded / fallback | RUN-0105 evidence reports HTTP 403 on the direct path. Alternative acquisition has previously returned records. |
| NZ Electricity Authority | Needs retained outcome | No per-source RUN-0105 result is stored. |
| Transpower NZ | Needs retained outcome | No per-source RUN-0105 result is stored. |
| NZ Fast-track | Degraded / configuration | Browse.AI robot credentials were not configured at last verification; scoped fallback does not prove full coverage. |
| NZ EPA – Fast-track Projects | Degraded / configuration | Same. |
| NZ EPA – RMA Proposals | Degraded / configuration | Same. |
| NZ EPA – Public Consultations | Degraded / configuration | Same. |
| NZ Ministry for the Environment | Needs retained outcome | A previously fixed HTML false-block requires confirmation on the deployed commit. |
| AltEnergy Australia | Healthy direct, Watts News extraction defective | Authentication/inventory succeeded. Issue #32 fixes the newsletter DOM parser and section-level repair defect. |
| LUVI | Healthy direct (last verified) | Direct integration succeeded in the last retained verification; confirm RUN-0105 counters. |

## Conclusions

- The 34-source job completed, but the current scan schema cannot support a
  conclusive historical per-source health audit from scan 105 alone.
- AEMO and Energy Magazine have confirmed degraded direct paths.
- Five planning sources have a repeated-zero pattern requiring source-specific
  verification; zero is not automatically an error and must not itself trigger
  paid AI fallback.
- Four NZ sources still depend on external Browse.AI configuration for their
  intended authenticated/JS-rendered path.
- Follow-ups: #33 (AEMO), #34 (Energy Magazine), #35 (durable 34-source
  health/repeated zeros), and #36 (reviewed historical duplicate remediation).
