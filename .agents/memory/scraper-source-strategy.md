---
name: Scraper source strategy
description: Which scraping approaches work for each source category; lessons from diagnosing 30 sources all returning 0.
---

## What works

- **RSS feeds** — best for news sites (RenewEconomy, PV Magazine, ESD News, ARENA, Smart Energy Council). WordPress category feeds (`/category/solar/feed/`) return structured title + description with capacity in the article heading.
- **AltEnergy project DB** — returns 646 in-development solar projects when no date filter is applied. Filter: `earlyStageRecord` check on `type`/`status` fields. Without startDate/endDate the full set is returned.
- **HTML parser (parseHtmlPage)** — catches structured `<article>` / `<h2>` + capacity pattern on static pages. Returns 0 for JS-rendered portals but fails fast (15 s timeout).

## What does NOT work

- **Firecrawl on government portals** — every AU/NZ government portal URL (EPBC, DCCEEW, Planning VIC, Planning Alerts, CEC, QLD Planning, NZ Ministry) consistently **times out at 30 s** and returns 0. These sites are JS-rendered or rate-limited. Do not add `firecrawl: true` to government URLs.
- **Firecrawl on news category listing pages** — returns article titles only (no capacity in card excerpts), so `extractCapacity()` returns null and all sections are dropped.
- **Generic site RSS feeds for news sources** — `/feed/` returns all-category posts, most unrelated to solar. Use the category-specific feed URL instead (e.g. `/category/projects/solar-projects/feed/`).

## parseFirecrawlMarkdown gates

- Heading-split: uses **exclude-only** (EXCLUDE_KEYWORDS) — do NOT require `isEarlyStage()` positive match. Government portal language ("under assessment", "referred") isn't in the keyword list.
- Table parser and bullet-list parser share the same exclude-only rule.

## Performance

- All sources run in parallel via `Promise.allSettled()` at the top level.
- Within a source, `extraUrls` also run in parallel (fixed from sequential `await` loop).
- Result: scan completes in ~54 seconds for 31 sources.

## Why: key lesson

Firecrawl is appropriate only for sites confirmed to render useful markdown (e.g. Smart Energy Council news page). Government portals are either dynamic search apps (EPBC, planning portals) or static info pages with no per-project MW data inline. Either way they return 0 — but with Firecrawl they waste 30 s per URL vs failing immediately with plain HTML.
