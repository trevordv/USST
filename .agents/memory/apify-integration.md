---
name: Apify Google Search integration
description: How Apify is integrated into the solar tracker scan pipeline
---

# Apify Google Search Integration

**Why:** Apify Google Search Scraper broadens project discovery beyond the directly-scraped AU/NZ news sources, catching announcements on news sites, developer blogs, and industry publications.

## Actor
- Actor: `apify~google-search-scraper` (tilde notation, not slash)
- Endpoint: `POST https://api.apify.com/v2/acts/apify~google-search-scraper/runs?token=...`
- Poll status at: `GET https://api.apify.com/v2/actor-runs/{runId}?token=...`
- Fetch results: `GET https://api.apify.com/v2/actor-runs/{runId}/dataset/items?token=...`

## Critical input fields
- `queries`: newline-separated string (not an array)
- `countryCode`: must be lowercase ISO code e.g. `"au"` not `"AU"` (validation error otherwise)
- `languageCode`: `"en"`
- `maxPagesPerQuery`: 1, `resultsPerPage`: 10

## Output shape
Each dataset item has `organicResults[]` with: `title`, `url`, `description`, `lastUpdated`

## Quality filtering required
Raw Google results include many generic/list pages. Must apply:
1. `looksLikeProjectTitle()` — reject titles like "Wind farms", "Projects", "Renewable energy", etc.
2. `SKIP_DOMAINS` set — excludes government planning pages, research/list sites, social media
3. `isEarlyStage()` check — only announced/under development projects
4. Solar keyword check on full text

## How to apply
- Run time: ~25-30 seconds for 7 queries on free plan
- Free plan account: username `trevordv`
- Token stored as `APIFY_API_TOKEN` secret
