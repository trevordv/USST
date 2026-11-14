---
name: AltEnergy AU data sources
description: How AltEnergy's three authenticated sections work and how to scrape them
---

# AltEnergy Data Source Architecture

**Why:** Each section of altenergy.com.au uses a completely different data structure — guessing based on one section wastes time.

## Login
- URL: `https://altenergy.com.au/login` (Laravel app, NOT WordPress)
- Flow: GET `/login` → extract `<meta name="csrf-token">` → POST `_token`, `email`, `password`, `submit=Login`
- Success indicator: 302 redirect (no `wordpress_logged_in` cookie — that warning is a false alarm from old code)
- Session cookie: `laravel_session` (55-min TTL, auto-re-login on expiry)

## /newsandviews — Article cards
- Structure: `<div class="news-block-four">` blocks
- Date format: `Published Date: 2026-June-12, Friday` → parse with MONTH_MAP dict
- Article URL pattern: `/newsandviews/show/{id}/{slug}`
- ~124 articles per listing page

## /kilowatt_subcribers — Structured project database (THE GOLDMINE)
- Structure: `var project = [...]` JSON embedded inline in page HTML (~2,279 records)
- Parse with regex: `var project\s*=\s*(\[[\s\S]*?\]);\s*(?:var|\/\/|$)`
- Fields: `project_name`, `capacity`, `developer`, `owner`, `location`, `state`, `country`, `energy_id`, `type`, `status`, `contact_name`, `contact_phone`, `contact_email`, `epc_lead_contractor`, `updated_at`, `new_updates`
- Energy IDs used by the scraper: 1=solar-pv, 2=wind, 3=wind-offshore,
  4=unverified solar-related legacy mapping (requires explicit solar text),
  5=standalone BESS, 9=solar-thermal, 10=bioenergy. Unknown IDs are rejected.
  The live Bourke record uses solar-pv ID 1, so Issue #23 requires no energy-ID
  expansion. The shared hard gate still rejects standalone BESS, wind,
  missing/sub-5 MW capacity, and non-AU/NZ records.
- Type field: `"In Development"` = active project
- Project detail URLs: `/projectdata/show/{id}`
- **No individual article fetch needed** — all data is in the inline JSON

## /watt_news — Weekly newsletters  
- Listing structure: `<div class="pdf-block-watts-new">` blocks
- Article URLs: `/watt_news/show/{slug}` (e.g. `watts-news,-12-june-2026`)
- Date in title: "Watts News, 12 June 2026" → parse `DD Month YYYY`
- Content: contains "NEW PROJECT:", "PROJECT UPDATE:", "PROJECT MILESTONE:" labeled sections
- PDF links also available but HTML content is sufficient

## /megawatt_subscribers
- Returns 0 project records — either requires higher tier or uses different variable name
- Not worth scraping in current form

## How to apply
- Always use all three sources in `scrapeAltEnergy()`
- For kilowatt DB, use the reason-coded classifier in `altenergy-project-db.ts`.
  It accepts eligible development statuses and rejects generating/operational,
  cancelled, withdrawn, wind-only and standalone-BESS records.
- `/kilowatt_subcribers` is a current inventory, not an event feed. Every scan
  evaluates every current record against the hard eligibility gates regardless
  of `updated_at`. Eligible records are linked with
  `date_evidence=altenergy_inventory_observation`; `updated_at` is provenance
  only and must never become the project's `announced_date` or an event-window
  exclusion reason.
- `/newsandviews` and `/watt_news` are event/news sources and continue to obey
  the requested scan date window.

## Issue #23 live diagnosis (2026-08-21)
- `Bourke 2B Solar Farm` (`id=1444`) is solar-pv (`energy_id=1`), Proposed / In
  Development, NSW, AUS, capacity `4.99` MW, updated `2026-01-09 01:25:40`.
  Its authoritative description explicitly calls it a `5 MW AC` solar farm,
  so Issue #25 accepts it at an eligibility capacity of 5 MW while preserving
  the raw structured 4.99 MW value as provenance.
- `Gunnedah Solar Farm` (`id=346`) is solar-pv (`energy_id=1`), Approved / In
  Development, NSW, AUS, capacity `27` MW, updated `2026-01-06 05:48:28`.
  It is eligible and must be linked as a current inventory observation even in
  an August bounded scan. If already persisted, it remains `is_new=false` and
  its historical `announced_date` is preserved.
- `Gunnedah 2 Solar Farm` (`id=522`) is solar-pv (`energy_id=1`), Generating,
  NSW, AUS, capacity `144` MW, updated `2026-01-06 23:10:51`; it remains
  correctly excluded by the hard status rule.

## 4.99 MW inventory analysis (live snapshot 2026-08-21)
- The current database has 22 AU/NZ solar development records at exactly
  `4.99` MW after applying the technology, country, and active-lifecycle gates.
- Bourke 2B is the only one whose description explicitly calls the solar farm
  `5 MW AC`. Three descriptions explicitly say `4.99 MW`; ten describe a
  larger DC/thermal installation (commonly 6.4 MW DC), consistent with a
  4.99 MW AC/export rating rather than a data-entry rounding rule.
- The update/source fields contain lifecycle notes and timestamps but no
  additional generic nominal-5-MW evidence. Issue #25 therefore accepts only
  records with explicit qualifying AC/project evidence; it does not round or
  normalize the other 4.99 MW records. The strict `>= 5 MW` rule remains.

## Issue #25 capacity-evidence precedence
- Parse the raw structured `capacity` first and preserve it separately in the
  classifier decision.
- A structured value at or above 5 MW remains authoritative and unchanged.
- When the structured value is below 5 MW, only explicit source wording such
  as `5 MW AC` or `5 MW solar farm` may supply the eligibility capacity.
- Do not use larger DC-only figures, BESS/component capacities, inference, or
  rounding to qualify a below-threshold structured value.
