# Brave Search integration

USST uses Brave Web Search as a bounded, server-side research aid. It is not a
project-ingestion source and is not part of the approved scan-source registry.

## Contact enrichment

The admin-authorized contact-enrichment job uses Brave only after deterministic
known-domain scraping has failed. For developer groups without a known domain,
USST searches for likely official company/contact pages, verifies that the
result resembles the known company, and visits a small number of those pages
before existing Apify and Lusha fallbacks.

Brave-discovered pages are fetched through a guarded public-URL helper. It
rejects unsafe protocols, URL credentials, localhost, private/reserved IP
literals, and hostnames resolving to private/reserved addresses. Every redirect
target is revalidated, redirects are capped at three, requests time out after
ten seconds, and response bodies are capped at 1 MB. Each outbound connection is
DNS-pinned to an address from that request's validated lookup while the original
hostname remains in the URL for Host, TLS SNI, and certificate validation;
redirect hosts receive a fresh validation and pin.

## Project and developer research

The reusable `researchWithBrave` service supports explicit
`project_corroboration`, `developer_website_discovery`, and `contact_research`
purposes without duplicating the Brave HTTP client.

`POST /projects/{id}/research` lets an administrator request one bounded Brave
search for an existing project's name, developer, location, capacity, and AU/NZ
context. The endpoint first confirms that the project exists, then uses its own
costly-operation admission/cooldown slot. It returns at most five normalized
evidence records containing title, URL, domain, snippet, timestamp, query hash,
and purpose. It performs no project insert or update.

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
- A project-research request makes at most one Brave call and returns five
  results at most.
- Both invoking routes remain admin-only and protected by existing costly-job
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

No Supabase schema or database migration is required. Contact-enrichment
provenance is retained in bounded structured server logs; project-research
provenance is returned with the evidence and is not persisted as project data.
