# USST Source Repair Report

Date: 12 August 2026

Issue: GitHub #9

Branch: `codex/source-access-repair`

Target: `migration/railway-supabase`

## Outcome

All 34 approved source slots remain registered. The 11 inaccessible and 12 extraction-problematic integrations now have an explicit, source-specific acquisition strategy, while the nine directly working sources retain their RSS or official HTML paths. AltEnergy and LUVI remain authenticated, opt-in integrations for Railway verification.

The runtime validates exact 34-source parity before every scan. Every source emits structured Railway diagnostics with the source, method, URL or fallback reason, elapsed time, project count, and one of these outcomes:

- `success`
- `empty` (no qualifying projects)
- `fallback-used`
- `extraction-failed`
- `blocked`
- `timeout`
- `skipped-missing-credentials`

No CAPTCHA, Cloudflare, authentication, robots, or rate-limit control is bypassed. Direct requests reject access-control challenge pages as blocked responses. Web-search fallback is limited to the configured official hostnames for the individual approved source.

## Source-by-source repair register

|   # | Approved source                 | Audit result                                    | Implemented production route                                                                                                             | Verification contract                                                                |
| --: | ------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
|   1 | Renew Economy                   | Working                                         | Existing RSS plus official search HTML; official-host OpenAI fallback only after zero results                                            | RSS preserved; parity and eligibility gates tested                                   |
|   2 | PV Magazine Australia           | Working                                         | Existing RSS plus official search HTML; scoped fallback after zero results                                                               | RSS preserved; parity and eligibility gates tested                                   |
|   3 | EcoGeneration                   | Working                                         | Existing solar-project RSS plus official category HTML                                                                                   | RSS preserved; parity and eligibility gates tested                                   |
|   4 | Utility Magazine                | Working                                         | Existing solar RSS plus official category HTML                                                                                           | RSS preserved; parity and eligibility gates tested                                   |
|   5 | ESD News                        | Working                                         | Existing RSS plus official solar-tag HTML                                                                                                | RSS preserved; parity and eligibility gates tested                                   |
|   6 | RenewMap                        | Extraction-problematic                          | Official-host OpenAI web search of RenewMap resources because the public map has no stable server-rendered project rows                  | Dedicated `scoped-openai` strategy test                                              |
|   7 | ARENA                           | Working                                         | Existing official RSS and ARENA solar search pages                                                                                       | RSS preserved; parity and eligibility gates tested                                   |
|   8 | Clean Energy Regulator          | Extraction-problematic                          | Official-host OpenAI extraction from the current large-scale renewable-energy data page                                                  | Dedicated `scoped-openai` strategy test                                              |
|   9 | AEMO                            | Inaccessible                                    | Direct official July 2026 NEM Generation Information XLSX; scoped official-host fallback if the workbook is unavailable or changes shape | Workbook-shape, technology, status, capacity, deduplication, and schema-change tests |
|  10 | Capacity Investment Scheme      | Inaccessible/timeout                            | Official-host OpenAI extraction from current open and closed CIS tender pages                                                            | Dedicated `scoped-openai` strategy test; timeout diagnostic                          |
|  11 | EPBC Act Referrals              | Extraction-problematic                          | Direct official DCCEEW ArcGIS feature layer; official-host fallback only if structured records cannot yield qualifying projects          | Existing ArcGIS tests plus dedicated source strategy test                            |
|  12 | EPBC Referrals Spatial Database | Extraction-problematic                          | Same official DCCEEW ArcGIS layer, retaining the approved spatial-database source slot and lineage                                       | Existing ArcGIS tests plus dedicated source strategy test                            |
|  13 | NSW Planning Portal             | Extraction-problematic                          | Official-host OpenAI extraction from the current Major Projects listing                                                                  | Dedicated `scoped-openai` strategy test                                              |
|  14 | NSW Planning Renewable Energy   | Extraction-problematic                          | Replaced obsolete path with the current official NSW renewable-energy page and scoped extraction                                         | Obsolete-URL regression test                                                         |
|  15 | Planning Victoria               | Inaccessible/blocked                            | Official-host OpenAI extraction from the current Victorian solar-energy-facilities page                                                  | Dedicated blocked-source strategy test                                               |
|  16 | QLD Coordinator-General         | Inaccessible/blocked                            | Official-host OpenAI extraction from current official coordinated-project listings                                                       | Dedicated blocked-source strategy test                                               |
|  17 | SA Energy & Mining              | Inaccessible/blocked                            | Official-host OpenAI extraction from the current SA solar energy projects page                                                           | Dedicated blocked-source strategy test                                               |
|  18 | WA EPA                          | Inaccessible/blocked                            | Official-host OpenAI extraction from the official proposal search                                                                        | Dedicated blocked-source strategy test                                               |
|  19 | NT Development Applications     | Extraction-problematic                          | Official-host OpenAI extraction from the official NTLIS planning portal                                                                  | Dedicated `scoped-openai` strategy test                                              |
|  20 | Tasmania EPA                    | Working; no current qualifying rows             | Existing official assessed-proposals HTML; scoped fallback only after zero results                                                       | Expected-empty HTML contract; `empty` diagnostic                                     |
|  21 | Planning Alerts Australia       | Extraction-problematic                          | Official-host OpenAI extraction limited to the approved Planning Alerts host                                                             | Dedicated `scoped-openai` strategy test                                              |
|  22 | Clean Energy Council            | Extraction-problematic                          | Official-host OpenAI extraction from the current large-scale solar page                                                                  | Dedicated `scoped-openai` strategy test                                              |
|  23 | QLD Planning – Renewable Energy | Inaccessible/obsolete path                      | Replaced obsolete path with the official SARA submissions portal; scoped extraction                                                      | Obsolete-URL regression test                                                         |
|  24 | Smart Energy Council            | Working                                         | Existing official RSS and news HTML                                                                                                      | RSS preserved; parity and eligibility gates tested                                   |
|  25 | Energy Magazine                 | Extraction-problematic/invalid redirect         | Replaced the image-redirect category path with official solar-project search; retained RSS                                               | RSS and current-search regression test                                               |
|  26 | NZ Electricity Authority        | Extraction-problematic                          | Official-host OpenAI extraction from the Generation Investment Pipeline dashboard                                                        | Dedicated `scoped-openai` strategy test                                              |
|  27 | Transpower NZ                   | Extraction-problematic                          | Direct structured parser for the official latest grid-connections page; scoped fallback after zero rows                                  | Official table/card parser fixture and source strategy test                          |
|  28 | NZ Fast-track                   | Inaccessible/blocked                            | Existing approved Browse.AI integration when its robot ID is configured, then official-host OpenAI fallback                              | Dedicated Browse.AI-or-fallback strategy and environment-key test                    |
|  29 | NZ EPA – Fast-track Projects    | Inaccessible/blocked                            | Source-specific approved Browse.AI robot, then official-host OpenAI fallback                                                             | Dedicated Browse.AI-or-fallback strategy and environment-key test                    |
|  30 | NZ EPA – RMA Proposals          | Inaccessible/blocked                            | Source-specific approved Browse.AI robot, then official-host OpenAI fallback                                                             | Dedicated Browse.AI-or-fallback strategy and environment-key test                    |
|  31 | NZ EPA – Public Consultations   | Inaccessible/blocked                            | Source-specific approved Browse.AI robot, then official-host OpenAI fallback                                                             | Dedicated Browse.AI-or-fallback strategy and environment-key test                    |
|  32 | NZ Ministry for the Environment | Working; no current qualifying rows             | Existing official Fast-track projects HTML; scoped fallback only after zero results                                                      | Expected-empty HTML contract; `empty` diagnostic                                     |
|  33 | AltEnergy Australia             | Authenticated; credentials unavailable in audit | Existing Laravel CSRF/session login and authenticated news, project database, and Watt News ingestion unchanged                          | Explicit missing-credential or success/empty Railway diagnostic                      |
|  34 | LUVI Project Tracker            | Authenticated; password unavailable in audit    | Existing password-based client-compatible pipeline decryption and current approved-status snapshot unchanged                             | Explicit missing-credential or success/empty Railway diagnostic                      |

## Business-rule and data-safety verification

All new structured and fallback candidates pass the existing shared eligibility gate before ingestion:

- Australia or New Zealand only
- solar or solar plus co-located BESS
- known capacity of at least 5 MW
- no standalone BESS
- no wind project

Existing source-URL and fuzzy-name deduplication remains unchanged. No database schema, Supabase Auth, RLS, user, project-history, scan-history, or contact-enrichment behavior was removed or weakened. The change adds acquisition routing, response validation, and diagnostics only.

## Railway configuration

Keep the existing `OPENAI_API_KEY`, Supabase, database, AltEnergy, and LUVI variables. The following optional variables enable the approved Browse.AI-first route for the four blocked NZ sources:

```text
BROWSE_AI_API_KEY
BROWSE_AI_NZ_FAST_TRACK_ROBOT_ID
BROWSE_AI_NZ_EPA_FAST_TRACK_ROBOT_ID
BROWSE_AI_NZ_EPA_RMA_ROBOT_ID
BROWSE_AI_NZ_EPA_CONSULTATIONS_ROBOT_ID
```

If a robot is not configured or yields no qualifying rows, the scan records `fallback-used` and uses the existing OpenAI web-search integration restricted to that source's official hostname. Secrets are never logged; diagnostics expose only missing variable names.

## Maintenance note

AEMO publishes a periodically replaced Generation Information workbook. The current official July 2026 workbook is pinned so production extraction is deterministic and testable. If AEMO replaces it, Railway will report a clear extraction failure and use the scoped official-host fallback; update `AEMO_GENERATION_WORKBOOK_URL` to the newest official workbook in the next routine source-maintenance change.
