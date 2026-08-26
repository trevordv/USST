# Brave Search integration

USST uses Brave Web Search as a bounded, server-side research aid. It is not a
project-ingestion source and is not part of the approved scan-source registry.

## Where it is used

The admin-authorized contact-enrichment job uses Brave only after deterministic
known-domain scraping has failed. For developer groups without a known domain,
USST searches for likely official company/contact pages, verifies that the
result resembles the known company, and visits a small number of those pages
before existing Apify and Lusha fallbacks.

The current integration does not send Brave results to OpenAI. If that is added
later, only minimal snippets and URLs may be sent, claims must cite those URLs,
and deterministic eligibility/source validation must remain authoritative.

Brave results provide discovery evidence, not factual proof. When a result is
selected, structured logs retain its purpose, URL, title, domain, search time,
and a one-way hash of the normalized query. Raw search queries are not logged.

## Where it is not used

Brave cannot create a project or bypass the approved-source registry. It does
not run in the project scan/ingestion loop. Every project continues to require
an approved source and the existing AU/NZ, solar or solar+BESS, >=5 MW, and
active-lifecycle gates. Wind-only, standalone-BESS, operational, cancelled,
and withdrawn projects remain excluded.

## Cost and abuse controls

- Searches default to five results and are capped at ten.
- Queries are limited to 300 normalized characters.
- No pagination is used.
- Requests have a 7.5-second timeout and use `AbortController`.
- Identical normalized searches use a ten-minute in-memory TTL cache.
- Concurrent identical searches share one request.
- The cache is bounded to 200 entries.
- A contact-enrichment run searches at most 25 unresolved developer groups.
- The invoking route remains admin-only and protected by the existing costly-job
  admission/cooldown controls.

## Secret handling and fallback

`BRAVE_SEARCH_API_KEY` is read only by the API server and sent only through the
Brave-required `X-Subscription-Token` header. It must never use a `VITE_` prefix.
The client does not return or log the key, headers, cookies, or upstream bodies.

Missing credentials, invalid credentials, rate limiting, timeouts, upstream
errors, network failures, and malformed responses return no Brave results and
allow the existing enrichment workflow to continue. Configure the key securely
in Railway after review; never put a real value in `.env.example`, source,
GitHub, logs, or chat.

No Supabase schema or database migration is required. Provenance is retained in
bounded structured server logs rather than persisted as project evidence.
