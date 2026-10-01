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
- **Permanent filters on the API** — The `GET /projects` endpoint always applies: no wind in name, AU/NZ only, must have a capacity value, and ≥5 MW. User filters (date, country, search, scanId, hasContact) are layered on top.
- **Capacity gate at ingest** — Projects with no extractable capacity (`null` or `undefined` MW) are dropped during the scan and never inserted. The scraper logs this as a quality rejection.
- **Strict source whitelist** — The scraper only scans the approved source list below. No broad Google Search, no developer page scraping, no unlisted sites. The `sourcesScanned` counter in the scan history reflects exactly these approved sources.
- **LUVI development pipeline** — LUVI's password-protected pipeline is decrypted server-side from its published encrypted JSON snapshot. Only Australian Energy records in Proposed, Approved, Committed, or Committed (FID) status with a solar component and ≥5 MW are imported.

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
| **Government** | Clean Energy Regulator – large-scale data | https://cer.gov.au/markets/reports-and-data/large-scale-renewable-energy-data |
| | AEMO – Generation Information | https://www.aemo.com.au/energy-systems/electricity/national-electricity-market-nem/nem-forecasting-and-planning/forecasting-and-planning-data/generation-information |
| | Capacity Investment Scheme | https://www.dcceew.gov.au/energy/renewable/capacity-investment-scheme/closed-cis-tenders |
| | DCCEEW – Renewable energy & EPBC approvals | https://www.dcceew.gov.au/environment/epbc/advice/renewable-energy-projects |
| | National Renewable Energy Priority List | https://www.dcceew.gov.au/energy/renewable/priority-list |
| | EPBC Act Referrals | https://epbcpublicportal.environment.gov.au |
| | EPBC Act – All Referrals | https://epbcpublicportal.environment.gov.au/all-referrals/ |
| | EPBC Act – All Notices | https://epbcpublicportal.environment.gov.au/all-notices/ |
| | EPBC Referrals Spatial Database | https://data.gov.au/data/dataset/referrals-spatial-database |
| | NSW Planning Portal | https://www.planningportal.nsw.gov.au |
| | NSW Planning – Renewable Energy | https://www.planning.nsw.gov.au |
| | Planning Victoria | https://www.planning.vic.gov.au |
| | VIC DEECA – Environmental Assessments | https://www.planning.vic.gov.au/environmental-assessments/browse-projects |
| | QLD Planning – Renewable Energy | https://www.planning.qld.gov.au/planning-issues-and-interests/renewable-energy |
| | QLD Coordinator-General | https://www.coordinatorgeneral.qld.gov.au |
| | SA – Energy & Mining | https://www.energymining.sa.gov.au |
| | WA EPA | https://www.epa.wa.gov.au |
| | NT Development Applications | https://www.ntlis.nt.gov.au |
| | Tasmania EPA | https://epa.tas.gov.au |
| **Industry / Data** | Planning Alerts Australia | https://www.planningalerts.org.au |
| | Clean Energy Council – Large-scale Solar | https://cleanenergycouncil.org.au/advocacy/large-scale-solar |
| | Clean Energy Council – Project Tracker | https://cleanenergycouncil.org.au/resources/project-tracker |
| | Clean Energy Council – Industry Snapshot | https://cleanenergycouncil.org.au/advocacy/industry-snapshot |
| | Clean Energy Council – Clean Energy Australia Report | https://cleanenergycouncil.org.au/news-resources/clean-energy-australia-report-2026 |
| | Smart Energy Council | https://smartenergy.org.au |
| **News** | Energy Magazine | https://www.energymagazine.com.au |
| **NZ** | NZ Electricity Authority | https://www.ea.govt.nz |
| | Transpower NZ | https://www.transpower.co.nz |
| | NZ Fast-track Approvals (current regime) | https://www.fasttrack.govt.nz/projects/ |
| | NZ EPA – Fast-track Projects (legacy COVID-era/NBEA) | https://www.epa.govt.nz/fast-track-consenting/fast-track-projects/ |
| | NZ EPA – RMA Proposals of National Significance | https://www.epa.govt.nz/industry-areas/rma-proposals/ |
| | NZ EPA – Public Consultations | https://www.epa.govt.nz/public-consultations/ |
| | NZ Ministry for the Environment – Fast-track | https://environment.govt.nz/acts-and-regulations/acts/fast-track-approvals/fast-track-projects/ |
| **Industry / Data** | LUVI Project Tracker | https://luvi.com.au/projects?category=Energy&status=Proposed%2CApproved%2CCommitted%2CCommitted+%28FID%29 |

## User preferences

- Target: AU/NZ **utility-scale solar and hybrid (solar + BESS) projects ≥5MW only**. No standalone BESS/battery-only projects. No wind (or wind + BESS).
- A project must have a solar component (solar-only or solar+BESS hybrid) to be ingested. The `hasSolarComponent()` gate in `scraper.ts` enforces this at ingest.
- List only projects where the capacity is mentioned for example 100MW.
- Clean data is paramount — no news articles, no operational updates, no non-AU/NZ projects.
- The scan must be restricted to **only the approved sources listed above**. No broad Google Search, no developer page scraping, no ad-hoc sites.
- AltEnergy is a subscription site requiring login credentials (`ALTENERGY_USERNAME` / `ALTENERGY_PASSWORD`) to access the project database and news sections.

## Required env vars

| Variable | Required for |
|----------|-------------|
| `DATABASE_URL` | All — Postgres connection |
| `ALTENERGY_USERNAME` / `ALTENERGY_PASSWORD` | AltEnergy authenticated scrape |
| `LUVI_USERNAME` / `LUVI_PASSWORD` | LUVI development pipeline scrape (`LUVI_USERNAME` is retained for account identification; LUVI's current pipeline unlock uses the password) |
| `APIFY_API_TOKEN` | Contact enrichment Phase 2 and bounded secondary scan acquisition for reviewed weak sources |
| `LUSHA_API_KEY` | Contact enrichment Phase 2.5 (Lusha enrich + prospecting) |
| `FIRECRAWL_API_KEY` | Bounded Firecrawl v2 fallback for reviewed weak sources in the existing 34-source registry |
| `SESSION_SECRET` | Express session signing |

## Gotchas

- **Always run `codegen` after editing `openapi.yaml`** — The frontend depends on generated hooks. Missing a codegen step will break client-side type checking.
- **Typecheck `libs` before apps** — `pnpm run typecheck` does this automatically, but if you see cross-package import errors, run `pnpm run typecheck:libs` first.
- **Scraper noise is an arms race** — New article headlines and press-release titles will slip through. When they do, add the exact phrase to `NOISY_PROJECT_RE` in `scraper.ts` and redeploy.
- **Apify rate limits** — The contact enrichment endpoint uses `apify~google-search-scraper`. Running it on a large batch may hit rate limits. Use date-range filtering to reduce scope.
- **Do not run `pnpm dev` at the workspace root** — Replit apps run via individual artifact workflows. Use `restart_workflow` instead.
- **AltEnergy requires login credentials** — The scraper uses `ALTENERGY_USERNAME` and `ALTENERGY_PASSWORD` (WordPress/Laravel session). These must be set in the environment.
- **LUVI requires its pipeline password** — The scraper uses `LUVI_PASSWORD` to decrypt LUVI's published pipeline snapshot. `LUVI_USERNAME` is stored for the account but is not sent because LUVI's current browser flow only uses the password.
- **Adding a new source requires explicit approval** — The scraper is locked to the approved source list. If you want to add a new site, update `replit.md` first, then update the `SOURCES` array in `scraper.ts`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See the `artifacts` skill for creating or updating artifact definitions
- See the `workflows` skill for managing long-running dev servers
