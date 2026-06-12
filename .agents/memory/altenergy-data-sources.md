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
- Energy IDs: 1=solar-pv, 2=wind, 3=wind-offshore, 4=?, 9=solar-thermal, 10=bioenergy
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
- For kilowatt DB, filter: `SOLAR_ENERGY_IDS` (1,4,9) or `WIND_ENERGY_IDS` (2,3), type includes "In Development"
- For date range on DB records, filter by `updated_at` field (format: "YYYY-MM-DD HH:MM:SS")
