# Firecrawl scan acquisition

Firecrawl is a bounded transport layer for reviewed weak sources in USST's existing 34-source registry. It does not discover new source domains, decide project eligibility, or replace deterministic parsers.

## Acquisition order

Each scan uses the cheapest deterministic path first:

1. Official structured data, RSS, workbook, API, or authenticated integration.
2. Direct approved-host HTML.
3. Firecrawl v2 for a reviewed weak source after a recorded direct failure.
4. Apify, then Bright Data, only after the preceding managed transport failed.
5. OpenAI only to normalise bounded content already acquired from an approved source. It has no web-search tool in this path.

A valid empty result is successful acquisition and stops escalation. AltEnergy, LUVI, AEMO and EPBC retain their dedicated paths. All acquired candidates still pass the existing AU/NZ, solar, lifecycle, date, duplicate and 5 MW eligibility gates.

Transport success alone is not a valid empty extraction. After Firecrawl or
Apify acquires content, USST classifies known iframe, client-rendered search,
category and detail-page portals as unresolved when the bounded parser cannot
resolve their records. That outcome can use bounded normalisation of the
already-acquired approved-host content; it is not reported as a successful
zero. Explicit empty states and true non-project guidance/current lists remain
valid zero results.

## Firecrawl controls

- Server-only `FIRECRAWL_API_KEY`; secret values and raw provider error bodies are never logged.
- Current API: `https://api.firecrawl.dev/v2`.
- Exact HTTPS host allowlist derived from each approved source's configured URLs; credentials, custom ports, cross-host redirects and external links are rejected.
- Scrape mode: one page. Crawl mode: at most three pages, discovery depth one, one provider worker.
- Global Firecrawl concurrency: two; request timeout: 35 seconds; total crawl budget: 55 seconds.
- Response cap: 2 MiB; retained content cap: 1 MiB per page; at most 100 approved-host links.
- Provider cache age: one hour; in-process successful-result cache and in-flight deduplication: 15 minutes.
- Source content is normalized and SHA-256 hashed for provenance and cost control; raw content, cookies and credentials are not persisted in source health.

## Durable health and operations

`scan_source_health` records one row per scan/source with acquisition method, provider attempts, outcome, safe failure category, candidate and qualifying counts, timing, content fingerprint, and Firecrawl usage. `acquisition_method` always identifies the transport that obtained the content (`direct`, `firecrawl`, `apify`, or `brightdata`); bounded OpenAI extraction is recorded separately by `openai_normalisation_attempted` and `openai_normalisation_succeeded`. The scan-detail page therefore keeps a successfully acquired source in its healthy transport group and notes normalisation alongside the method instead of treating OpenAI as a transport or a degraded acquisition.

The table is backend-only: RLS is enabled, public roles are revoked, and only the server service role is granted access. Apply the migration through the normal reviewed Supabase deployment process before deploying the application commit.

Recommended operational checks after deployment:

- Confirm integration diagnostics report Firecrawl configuration presence without exposing the value.
- Run one bounded scan and inspect the source-health panel plus Railway logs for method, pages, duration, cache reuse and safe outcome.
- Alert on repeated `auth-failed`, `rate-limited`, `timeout`, `unsafe-final-url`, or provider-error outcomes.
- Do not run an uncontrolled full-site crawl; expand source targets or page/depth limits only through reviewed code changes.

## RUN-0115 Phase 1 source review (2026-09-23)

| Source                          | Page evidence                                                                                                                                                    | Zero-result classification                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Energy Magazine                 | Direct search remained inaccessible; RSS is the deterministic path. Managed content containing solar article cards but no resolved asset evidence is unresolved. | Unresolved when solar content is present; otherwise transport failure is retained.   |
| Planning Victoria               | The configured URL is planning guidance and links to a separate spatial register; it does not itself list current project events.                                | Legitimate zero.                                                                     |
| QLD Coordinator-General         | The rendered current-project list contained no solar project.                                                                                                    | Legitimate zero for that current list.                                               |
| QLD Planning – Renewable Energy | The configured SARA page embeds the application portal in an Appian iframe.                                                                                      | Unresolved / requires JS or bounded repair.                                          |
| NZ Fast-track                   | The rendered page is a search shell without project rows.                                                                                                        | Unresolved / requires JS or bounded repair.                                          |
| NZ EPA – Fast-track Projects    | The page contains named solar rows, but the listing omits capacity and event-date evidence required by a bounded scan.                                           | Unresolved; detail evidence is required.                                             |
| NZ EPA – RMA Proposals          | The page routes current proposals to the consultations section rather than listing records inline.                                                               | Unresolved; linked/category content is required.                                     |
| NZ EPA – Public Consultations   | The landing page exposes category links, not current proposal records inline.                                                                                    | Unresolved; category content is required unless an explicit empty state is returned. |
| NZ Ministry for the Environment | The page links to listed and unlisted project datasets instead of rendering project details inline.                                                              | Unresolved; linked list content is required.                                         |
| WA EPA                          | Proposal search remained protected/interactive rather than yielding bounded proposal rows.                                                                       | Unresolved or acquisition failure, never a valid zero.                               |

## Bright Data production status

Production currently has no `BRIGHT_DATA_API_KEY`. A zone name without the API
key is insufficient, so the Bright Data fallback cannot run. No secret is
stored in this repository; configure the key only in the Railway secret store
if that provider is re-enabled.
