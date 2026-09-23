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

`scan_source_health` records one row per scan/source with acquisition method, provider attempts, outcome, safe failure category, candidate and qualifying counts, timing, content fingerprint, and Firecrawl usage. The scan-detail page groups sources into healthy direct, Firecrawl, Apify, Bright Data, valid zero, degraded, blocked and failed states.

The table is backend-only: RLS is enabled, public roles are revoked, and only the server service role is granted access. Apply the migration through the normal reviewed Supabase deployment process before deploying the application commit.

Recommended operational checks after deployment:

- Confirm integration diagnostics report Firecrawl configuration presence without exposing the value.
- Run one bounded scan and inspect the source-health panel plus Railway logs for method, pages, duration, cache reuse and safe outcome.
- Alert on repeated `auth-failed`, `rate-limited`, `timeout`, `unsafe-final-url`, or provider-error outcomes.
- Do not run an uncontrolled full-site crawl; expand source targets or page/depth limits only through reviewed code changes.
