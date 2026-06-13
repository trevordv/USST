# Solar Project Scout

A sales intelligence tool for the Australian and New Zealand utility-scale solar market. It continuously scans ~40 industry news sites, government portals, and developer pipelines to discover new solar and BESS projects (≥5MW) in early development, then presents them in a filterable, exportable directory with optional contact enrichment.

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

## Product

- **Dashboard** — Live overview showing total projects, aggregate capacity, country/status breakdown, and recent announcements (last 7 days).
- **Projects Directory** — Filterable table with search, date range, country, scan lineage, and "has contact" filters. One-click CSV export.
- **Scan History** — Lists every scan run with date, sources scanned, projects found, and new projects. Each completed scan shows a "View X new" button that jumps to the filtered projects page.
- **Manual CRUD** — Add, edit, or delete individual projects. Useful for corrections or entries the scraper missed.
- **Contact Enrichment** — Batch button on the projects page that attempts to find missing developer contact details (name, email, phone) via web scraping and Apify Google Search.

## User preferences

- Target: AU/NZ utility-scale solar and BESS projects ≥5MW. No wind.
- Clean data is paramount — no news articles, no operational updates, no non-AU/NZ projects.
- Data sources scanned include:
  - News: Renew Economy, AltEnergy (newsandviews, project DB, watt_news), ARENA, Clean Energy Council, PV Magazine Australia, Energy Magazine Australia, RNZ Business, EECA NZ, ESD News, SolarQuarter Australia, Green Review, BusinessDesk NZ, ABC News
  - Government: Clean Energy Regulator, QLD Coordinator-General, NSW Planning Portal, Tasmania EPA, ReCFIT Tasmania, Transgrid, Powerlink Queensland, Transpower NZ, NZ EPA Fast-track, NZ Electricity Authority
  - Developers: LightsourceBP, Neoen, Edify Energy, Iberdrola, OX2, Flow Power, ACEN, RATCH, Harmony Energy, Meridian Energy, Genesis Energy, Far North Solar Farm, NZ Clean Energy

## Gotchas

- **Always run `codegen` after editing `openapi.yaml`** — The frontend depends on generated hooks. Missing a codegen step will break client-side type checking.
- **Typecheck `libs` before apps** — `pnpm run typecheck` does this automatically, but if you see cross-package import errors, run `pnpm run typecheck:libs` first.
- **Scraper noise is an arms race** — New article headlines and press-release titles will slip through. When they do, add the exact phrase to `NOISY_PROJECT_RE` in `scraper.ts` and redeploy.
- **Apify rate limits** — The contact enrichment endpoint uses `apify~google-search-scraper`. Running it on a large batch may hit rate limits. Use date-range filtering to reduce scope.
- **Do not run `pnpm dev` at the workspace root** — Replit apps run via individual artifact workflows. Use `restart_workflow` instead.
- **AltEnergy requires login credentials** — The scraper uses `ALTENERGY_USERNAME` and `ALTENERGY_PASSWORD` (WordPress/Laravel session). These must be set in the environment.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See the `artifacts` skill for creating or updating artifact definitions
- See the `workflows` skill for managing long-running dev servers
