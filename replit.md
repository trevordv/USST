# Solar Project Scout

A sales intelligence tool for the Australian and New Zealand utility-scale solar market. It scans a curated set of approved industry news sites and government portals to discover new solar and BESS projects (≥5MW) in early development, then presents them in a filterable, exportable directory with optional contact enrichment.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/solar-tracker run dev` — run the frontend dev server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React 19 + Vite + Tailwind CSS + Radix UI + React Query
- Charts: Recharts
- Contact enrichment: Apify Google Search Scraper

## Where things live

| Concern | Source of truth |
|---------|-----------------|
| DB schema | `lib/db/src/schema/projects.ts` |
| API contract | `lib/api-spec/openapi.yaml` |
| API routes | `artifacts/api-server/src/routes/` (projects.ts, scans.ts, health.ts) |
| Scraper / data sources | `artifacts/api-server/src/lib/scraper.ts` |
| Frontend app | `artifacts/solar-tracker/src/` |
| Pages (Dashboard, Projects, Scan History) | `artifacts/solar-tracker/src/pages/` |
| UI components (shadcn style) | `artifacts/solar-tracker/src/components/ui/` |
| Generated API client hooks | `lib/api-client-react/src/` |
| Shared types | `lib/db/src/schema/projects.ts` |

## Architecture decisions

- **Contract-first API** — OpenAPI spec is the source of truth; clients and Zod schemas are generated from it. Always update `openapi.yaml` first, then run codegen.
- **Monorepo with shared libs** — `@workspace/db` owns the schema, `@workspace/api-client-react` owns generated hooks. Artifacts never import from each other.
- **Background scan jobs** — `POST /scans` triggers a long-running scrape. The API returns immediately (202) with a scan ID; the frontend polls `GET /scans/:id` for status.
- **Noise filtering at ingest** — `isNoisyProjectName()` in the scraper drops operational updates, planning articles, fundraising headlines, and non-AU/NZ geography before the record ever reaches the database. This is a deliberate quality gate, not a post-filter.
- **Project-name shape check for news articles** — AltEnergy `newsandviews` titles are article headlines, not project names. Only titles containing a recognisable project suffix (e.g. "Solar Farm", "BESS", "Energy Hub") are kept; article-style headlines are discarded.
- **Contact enrichment as explicit action** — `POST /projects/enrich-contacts` runs domain scraping + Apify search to find developer emails and phones. It is intentionally not automatic to avoid rate-limiting and spam flags.
- **Scan lineage tracking** — `projects.scan_id` ties every project to the scan that discovered it, enabling "View X new" per scan in the history UI.
- **Permanent filters on the API** — The `GET /projects` endpoint always applies: no wind in name, AU/NZ only, ≥5MW (or null capacity). User filters (date, country, search, scanId, hasContact) are layered on top.
- **Strict source whitelist** — The scraper only scans the approved source list below. No broad Google Search, no developer page scraping, no unlisted sites. The `sourcesScanned` counter in the scan history reflects exactly these approved sources.

## Product

- **Dashboard** — Live overview showing total projects, aggregate capacity, country/status breakdown, and recent announcements (last 7 days).
- **Projects Directory** — Filterable table with search, date range, country, scan lineage, and "has contact" filters. One-click CSV export.
- **Scan History** — Lists every scan run with date, sources scanned, projects found, and new projects. Each completed scan shows a "View X new" button that jumps to the filtered projects page.
- **Manual CRUD** — Add, edit, or delete individual projects. Useful for corrections or entries the scraper missed.
- **Contact Enrichment** — Batch button on the projects page that attempts to find missing developer contact details (name, email, phone) via web scraping and Apify Google Search.

## Approved sources (only these are scanned)

| Category | Source | URL |
|----------|--------|-----|
| **News** | AltEnergy – News & Views | https://altenergy.com.au/newsandviews |
| | AltEnergy – Project Database | https://altenergy.com.au/kilowatt_subcribers |
| | AltEnergy – Watts News | https://altenergy.com.au/watt_news |
| | RenewEconomy | https://reneweconomy.com.au |
| | PV Magazine Australia | https://www.pv-magazine-australia.com |
| | EcoGeneration | https://www.ecogeneration.com.au |
| | Utility Magazine | https://utilitymagazine.com.au |
| | ESD News | https://esdnews.com.au |
| | RenewMap | https://renewmap.com.au |
| | ARENA | https://arena.gov.au |
| **Government** | Clean Energy Regulator | https://cer.gov.au |
| | AEMO | https://www.aemo.com.au |
| | Capacity Investment Scheme | https://www.dcceew.gov.au |
| | EPBC Act Referrals | https://epbcpublicportal.environment.gov.au |
| | NSW Planning Portal | https://www.planningportal.nsw.gov.au |
| | NSW Planning – Renewable Energy | https://www.planning.nsw.gov.au |
| | Planning Victoria | https://www.planning.vic.gov.au |
| | QLD Coordinator-General | https://www.coordinatorgeneral.qld.gov.au |
| | SA – Energy & Mining | https://www.energymining.sa.gov.au |
| | WA EPA | https://www.epa.wa.gov.au |
| | NT Development Applications | https://www.ntlis.nt.gov.au |
| | Tasmania EPA | https://epa.tas.gov.au |
| **NZ** | NZ Electricity Authority | https://www.ea.govt.nz |
| | Transpower NZ | https://www.transpower.co.nz |
| | NZ Fast-track | https://www.fasttrack.govt.nz |
| | NZ EPA | https://www.epa.govt.nz |

## User preferences

- Target: AU/NZ utility-scale solar and BESS projects ≥5MW. No wind.
- Clean data is paramount — no news articles, no operational updates, no non-AU/NZ projects.
- The scan must be restricted to **only the approved sources listed above**. No broad Google Search, no developer page scraping, no ad-hoc sites.
- AltEnergy is a subscription site requiring login credentials (`ALTENERGY_USERNAME` / `ALTENERGY_PASSWORD`) to access the project database and news sections.

## Gotchas

- **Always run `codegen` after editing `openapi.yaml`** — The frontend depends on generated hooks. Missing a codegen step will break client-side type checking.
- **Typecheck `libs` before apps** — `pnpm run typecheck` does this automatically, but if you see cross-package import errors, run `pnpm run typecheck:libs` first.
- **Scraper noise is an arms race** — New article headlines and press-release titles will slip through. When they do, add the exact phrase to `NOISY_PROJECT_RE` in `scraper.ts` and redeploy.
- **Apify rate limits** — The contact enrichment endpoint uses `apify~google-search-scraper`. Running it on a large batch may hit rate limits. Use date-range filtering to reduce scope.
- **Do not run `pnpm dev` at the workspace root** — Replit apps run via individual artifact workflows. Use `restart_workflow` instead.
- **AltEnergy requires login credentials** — The scraper uses `ALTENERGY_USERNAME` and `ALTENERGY_PASSWORD` (WordPress/Laravel session). These must be set in the environment.
- **Adding a new source requires explicit approval** — The scraper is locked to the approved source list. If you want to add a new site, update `replit.md` first, then update the `SOURCES` array in `scraper.ts`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See the `artifacts` skill for creating or updating artifact definitions
- See the `workflows` skill for managing long-running dev servers
