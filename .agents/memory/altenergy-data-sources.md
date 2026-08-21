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
- For a bounded scan, `updated_at` (format: "YYYY-MM-DD HH:MM:SS") is source
  update/event evidence. It can create update lineage with
  `date_evidence=altenergy_source_update`, but must never be stored as the
  project's `announced_date`.

## Issue #23 live diagnosis (2026-08-21)
- `Bourke 2B Solar Farm` (`id=1444`) is solar-pv (`energy_id=1`), Proposed / In
  Development, NSW, AUS, capacity `4.99` MW, updated `2026-01-09 01:25:40`.
  It is outside the 2026-08-10..17 scan window and independently fails the
  unchanged 5 MW minimum, so it must remain excluded (`skipped_capacity` in the
  reason-coded classifier).
- `Gunnedah Solar Farm` (`id=346`) is solar-pv (`energy_id=1`), Approved / In
  Development, NSW, AUS, capacity `27` MW, updated `2026-01-06 05:48:28`.
  It is eligible apart from being outside the August bounded window.
- `Gunnedah 2 Solar Farm` (`id=522`) is solar-pv (`energy_id=1`), Generating,
  NSW, AUS, capacity `144` MW, updated `2026-01-06 23:10:51`; it remains
  correctly excluded by the hard status rule.
