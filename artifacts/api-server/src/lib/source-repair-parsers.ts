export interface SourceRepairCandidate {
  name: string;
  description: string;
  capacityMw: number | null;
  developer: string | null;
  location: string | null;
  status: "announced" | "under_development";
  sourceUrl: string;
  announcedDate: string | null;
}

const CAPACITY_RE = /(\d+(?:\.\d+)?)\s*(mw|gw|megawatt|gigawatt)/i;

function stripMarkup(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractCapacity(value: string): number | null {
  const match = value.match(CAPACITY_RE);
  if (!match) return null;
  const capacity = Number(match[1]);
  return match[2].toLowerCase().startsWith("g") ? capacity * 1_000 : capacity;
}

function determineStatus(value: string): "announced" | "under_development" {
  return /approved|committed|assessment|construction|development|planning|consent/i.test(
    value,
  )
    ? "under_development"
    : "announced";
}

/**
 * Parse official pages that present project cards, headings, or table rows.
 * The shared eligibility gate still decides whether a candidate may be stored.
 */
export function parseOfficialProjectHtml(
  html: string,
  pageUrl: string,
): SourceRepairCandidate[] {
  const sections = [
    ...html.matchAll(/<(?:tr|article)[^>]*>([\s\S]*?)<\/(?:tr|article)>/gi),
    ...html.matchAll(
      /<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>([\s\S]*?)(?=<h[2-4][^>]*>|$)/gi,
    ),
  ];
  const results: SourceRepairCandidate[] = [];
  const seen = new Set<string>();

  for (const section of sections) {
    const raw = section.slice(1).filter(Boolean).join(" ");
    const text = stripMarkup(raw);
    if (!/\b(?:solar|photovoltaic|pv)\b/i.test(text)) continue;
    const capacityMw = extractCapacity(text);
    if (capacityMw == null) continue;

    const heading = raw.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i)?.[1];
    const cells = [...raw.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((match) => stripMarkup(match[1]))
      .filter(Boolean);
    const link = raw.match(/href=["']([^"']+)["']/i)?.[1];
    const name = stripMarkup(
      heading ?? cells[0] ?? text.split(/[.!?]/)[0],
    ).slice(0, 180);
    if (name.length < 5) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let sourceUrl = pageUrl;
    if (link) {
      try {
        sourceUrl = new URL(link, pageUrl).href;
      } catch {
        /* retain the official page URL */
      }
    }
    results.push({
      name,
      description: text.slice(0, 600),
      capacityMw,
      developer: cells.length > 1 ? cells[1] : null,
      location: cells.length > 2 ? (cells.at(-1) ?? null) : null,
      status: determineStatus(text),
      sourceUrl,
      announcedDate: null,
    });
  }
  return results;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function finiteNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse AEMO's official Generator Information worksheet rows. */
export function parseAemoGenerationRows(
  rows: readonly (readonly unknown[])[],
  workbookUrl: string,
  announcedDate: string,
): SourceRepairCandidate[] {
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => normalizeHeader(cell) === "site name"),
  );
  if (headerIndex < 0)
    throw new Error("AEMO Generator Information header row not found");
  const headers = rows[headerIndex].map(normalizeHeader);
  const indexOf = (name: string) => headers.indexOf(name);
  const siteIndex = indexOf("site name");
  const ownerIndex = indexOf("site owner");
  const regionIndex = indexOf("region");
  const maxSiteCapacityIndex = indexOf("max site capacity (ac)");
  const technologyIndex = indexOf("technology type");
  const detailIndex = indexOf("technology detail");
  const aggregatedCapacityIndex = indexOf(
    "aggregated nameplate capacity (mw ac)",
  );
  const commitmentIndex = indexOf("commitment status");
  if (
    [siteIndex, technologyIndex, commitmentIndex].some((index) => index < 0)
  ) {
    throw new Error("AEMO Generator Information required columns not found");
  }

  const regionNames: Record<string, string> = {
    NSW1: "NSW",
    QLD1: "QLD",
    SA1: "SA",
    TAS1: "TAS",
    VIC1: "VIC",
  };
  const bySite = new Map<string, SourceRepairCandidate>();

  for (const row of rows.slice(headerIndex + 1)) {
    const siteName = String(row[siteIndex] ?? "").trim();
    const technology = String(row[technologyIndex] ?? "").trim();
    const detail = String(row[detailIndex] ?? "").trim();
    const commitment = String(row[commitmentIndex] ?? "").trim();
    if (
      !siteName ||
      !/solar|photovoltaic|\bpv\b/i.test(`${technology} ${detail}`)
    )
      continue;
    if (!/publicly announced|committed|anticipated|proposed/i.test(commitment))
      continue;
    if (/in service|commission/i.test(commitment)) continue;

    const capacityMw =
      finiteNumber(row[maxSiteCapacityIndex]) ??
      finiteNumber(row[aggregatedCapacityIndex]);
    const owner = String(row[ownerIndex] ?? "").trim() || null;
    const regionCode = String(row[regionIndex] ?? "").trim();
    const description = `${technology}${detail ? ` — ${detail}` : ""}; ${commitment}; ${capacityMw ?? "unknown"} MW`;
    const existing = bySite.get(siteName.toLowerCase());
    if (!existing || (capacityMw ?? 0) > (existing.capacityMw ?? 0)) {
      bySite.set(siteName.toLowerCase(), {
        name: siteName,
        description,
        capacityMw,
        developer: owner,
        location: (regionNames[regionCode] ?? regionCode) || null,
        status: /committed/i.test(commitment)
          ? "under_development"
          : "announced",
        sourceUrl: `${workbookUrl}#site=${encodeURIComponent(siteName)}`,
        announcedDate,
      });
    }
  }
  return [...bySite.values()];
}

export type SourceResponseProblem =
  | "blocked"
  | "timeout"
  | "http-error"
  | "invalid-content";

export function classifySourceResponse(
  status: number,
  contentType: string,
  body: string,
): SourceResponseProblem | null {
  const lower = body.toLowerCase();
  if (
    status === 401 ||
    status === 403 ||
    [
      "just a moment",
      "enable javascript and cookies to continue",
      "request unsuccessful",
      "azure waf",
      "cf-chl-",
    ].some((marker) => lower.includes(marker))
  )
    return "blocked";
  // Normal public pages also load /_Incapsula_Resource scripts. Only the
  // challenge iframe is a blocking signal; a vendor name is not one.
  if (/<iframe\b[^>]*src=["'][^"']*\/_incapsula_resource/i.test(body)) return "blocked";
  if (status < 200 || status >= 300) return "http-error";
  if (
    /image\//i.test(contentType) ||
    (!body.trim() && !/octet-stream/i.test(contentType))
  ) {
    return "invalid-content";
  }
  return null;
}
