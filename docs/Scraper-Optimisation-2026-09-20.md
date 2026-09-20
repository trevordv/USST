# Scraper optimisation — 20 September 2026

Branch: `claude/scraper-optimisation` → target `migration/railway-supabase`.
Scope: `artifacts/api-server/src/lib` deterministic extraction only.

## Why scans returned little information

| # | Defect | Effect |
| --- | --- | --- |
| 1 | `source_url` was the project identity everywhere. Listing-page cards, OpenAI-fallback rows and multi-farm articles share one URL. | Only the first project per page survived `addUnique`, and a project rejected earlier marked the URL as a rejected sentinel for the rest of the scan. |
| 2 | RSS parser read `<description>` only, page one only, and ignored `content:encoded`. | The MW figure is rarely in the excerpt, so most solar articles were dropped as `missing-capacity`. |
| 3 | HTML card regex `<div class="post">…</div>` ends at the first nested `</div>`. | Title, link or date fell outside the snippet; cards skipped or mis-titled. |
| 4 | Capacity regex read `1,200 MW` as 200, `400 MWh` as 400 MW and accepted national statistics. | Wrong or inflated capacity, false positives at the 5 MW gate. |
| 5 | AltEnergy article body: same nested-div regex, truncated to 1,000 characters, fetched one at a time. | Capacity in paragraph two or three never seen. |
| 6 | Developer extraction fell back to the first capitalised phrase ending in Solar/Energy/Power. | Project names and regulators stored as developers. |
| 7 | Undated feed items, cards, Browse.AI rows and AI-fallback rows were stamped with the scan day. | Contradicted `Scan-Date-Window-Policy.md`; stale items looked new. |
| 8 | `Browse.AI` parser read capacity only from text with a unit and ignored bare-number capacity columns. | NZ robot rows would be dropped once configured. |

## What changed

- `source-text.ts` — entity-aware HTML→text, balanced-tag extraction, main-article
  text, capacity scoring (thousands separators, GW, AC/DC/p suffix, MWh rejected,
  battery/wind/statistic context), project-name derivation, text dates.
- `feed-items.ts` — RSS 2.0 and Atom parsing with `content:encoded`, honest dates,
  `?paged=N` URLs.
- `news-parsers.ts` — feed and HTML-card parsers built on the above.
- `article-enrichment.ts` — bounded same-host article read for candidates with no
  capacity (30 per source, 4 concurrent, block/challenge responses respected).
- `project-identity.ts` — stable `#<project-slug>` identity for shared URLs.
- `source-heuristics.ts` — cue-based developer extraction, whole-word/earliest
  location matching.
- `scraper.ts` — feed paging (10 pages bounded / 4 unbounded, stops once older than
  the window), enrichment step, identity assignment, sentinel removal, same-source
  name fallback for pre-existing bare-URL rows, AltEnergy body fix + parallel reads,
  Browse.AI capacity/date fixes, AI-fallback undated handling.
- `source-repair-parsers.ts`, `source-extraction-outcome.ts` — shared capacity/text
  helpers; HTML structure check accepts the card shapes the new parser reads.

## Not changed (deliberately)

Approved source list, eligibility rules (AU/NZ, solar or solar+BESS, ≥5 MW),
OpenAI fallback prompt/model/2,500-token cap (pinned by tests and AI-Cost-Control),
API contract, schema, authentication, contact enrichment.

## Validation

`pnpm run typecheck`, `pnpm run build` and `pnpm -r --if-present test` pass
(231 API tests including 43 new). **Not validated against live sources**: the
authoring environment's egress policy blocked the approved hosts. Verify with a
bounded authenticated scan and compare per-source counts and the
`Article enrichment complete` log line.

## Remaining external blockers (not code)

- Browse.AI key and four NZ robot IDs are not configured in Railway.
- Publisher 403s (AEMO workbook, Energy Magazine direct path) need publisher-approved
  access; no challenge circumvention was added.
- Sources in `openai-first` mode only attempt a direct fetch when Bright Data is
  configured. Enabling a free direct-first attempt would cut AI spend but can reduce
  unbounded-scan coverage; needs a measured decision.
