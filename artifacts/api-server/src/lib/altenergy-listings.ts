/**
 * Deterministic parsers for AltEnergy's authenticated listing pages.
 *
 * Dates are returned as YYYY-MM-DD or null. An unreadable date is never
 * replaced with the scan day: doing so made old articles look newly announced,
 * passed bounded scan windows that include today, and persisted a false
 * announcement date (docs/Scan-Date-Window-Policy.md).
 */

const MONTH_MAP: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

function validIsoDate(year: string, month: string, day: string): string | null {
  const iso = `${year}-${month}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * Parse AltEnergy's date format ("2026-June-12") or any unambiguous
 * "12 June 2026" / ISO form. Returns null when the date cannot be read.
 */
export function parseAltEnergyDate(raw: string): string | null {
  const ymd = raw.match(/(\d{4})-([A-Za-z]+)-(\d{1,2})/);
  if (ymd) {
    const month = MONTH_MAP[ymd[2].toLowerCase()];
    return month ? validIsoDate(ymd[1], month, ymd[3]) : null;
  }
  const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return validIsoDate(iso[1], iso[2], iso[3]);
  return parseDayMonthYear(raw);
}

/** "12 June 2026" → "2026-06-12"; null when absent or not a real date. */
export function parseDayMonthYear(text: string): string | null {
  const match = text.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!match) return null;
  const month = MONTH_MAP[match[2].toLowerCase()];
  return month ? validIsoDate(match[3], month, match[1]) : null;
}

/**
 * Parse the AltEnergy news listing page HTML.
 * Extracts article cards from `<div class="news-block-four">` blocks.
 */
export function parseAltEnergyListing(html: string): Array<{ title: string; url: string; date: string | null }> {
  const results: Array<{ title: string; url: string; date: string | null }> = [];

  const blockRe = /<div[^>]*class="[^"]*news-block-four[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;

  for (const block of html.matchAll(blockRe)) {
    const inner = block[1];

    const linkMatch = inner.match(/href="(https?:\/\/altenergy\.com\.au\/newsandviews\/show\/[^"]+)"/i);
    if (!linkMatch) continue;
    const url = linkMatch[1];

    const titleMatch = inner.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i);
    const title = (titleMatch?.[1] ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) continue;

    // "Published Date: 2026-June-12"
    const dateMatch = inner.match(/Published\s+Date:\s*([\d]+-[A-Za-z]+-[\d]+)/i);
    const date = dateMatch ? parseAltEnergyDate(dateMatch[1]) : null;

    results.push({ title, url, date });
  }

  return results;
}

/**
 * Parse the watt_news listing page to extract newsletter URLs and the issue
 * date from the title (or nearby text). Uses two strategies to tolerate
 * AltEnergy HTML structure changes. Undated issues are returned with null.
 */
export function parseWattNewsListing(html: string): Array<{ url: string; date: string | null }> {
  const seen = new Set<string>();
  const results: Array<{ url: string; date: string | null }> = [];

  const addResult = (url: string, date: string | null) => {
    if (seen.has(url)) return;
    seen.add(url);
    results.push({ url, date });
  };

  // Strategy 1: original pdf-block-watts-new div structure
  const blockRe = /<div[^>]*class="[^"]*pdf-block-watts-new[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
  for (const block of html.matchAll(blockRe)) {
    const inner = block[1];
    const linkMatch = inner.match(/href="(https?:\/\/altenergy\.com\.au\/watt_news\/show\/[^"]+)"/i);
    if (!linkMatch) continue;
    const titleMatch = inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const title = titleMatch?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
    addResult(linkMatch[1], parseDayMonthYear(title));
  }

  // Strategy 2: any /watt_news/show/ link with a date in nearby text
  const allLinkRe = /href="(https?:\/\/altenergy\.com\.au\/watt_news\/show\/[^"]+)"/gi;
  for (const linkMatch of html.matchAll(allLinkRe)) {
    const url = linkMatch[1];
    if (seen.has(url)) continue;
    const idx = linkMatch.index ?? 0;
    const context = html.slice(Math.max(0, idx - 200), idx + 300).replace(/<[^>]+>/g, " ");
    addResult(url, parseDayMonthYear(context));
  }

  return results;
}
