---
name: LUVI data source
description: LUVI's project tracker publishes a password-encrypted development pipeline that can be decoded server-side
---

LUVI's protected pipeline is a base64-encoded JSON payload XOR-encrypted with the pipeline password. The useful fields include category, type, subtype, status, state, location, owner, and capacity; the current pipeline contains development statuses such as Proposed, Approved, Committed, and Committed (FID).

**Why:** The browser tracker does not expose the protected development records as ordinary HTML, so parsing the page alone returns no project rows.

**How to apply:** Fetch the pipeline payload, decrypt it using the configured LUVI password, then apply the product's solar-component and ≥5 MW gates. Treat the result as a current snapshot because records do not include per-project announcement dates.