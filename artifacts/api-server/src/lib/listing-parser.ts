/**
 * Pure helpers for reading source listing pages (news lists, planning lists).
 *
 * These replace the earlier single regex in `parseHtmlPage`, which:
 *  - stopped a card at the first inner `</div>`, cutting off the title, link
 *    and capacity of any nested card;
 *  - only understood "September 12, 2026", not the Australian "12 September 2026";
 *  - ignored relative links and then collapsed every such card onto the
 *    source's search URL (which URL-based deduplication merges into one).
 */

export interface ListingCard {
  title: string;
  /** Absolute http(s) URL of the card's own page, or null when none is present. */
  url: string | null;
  /** ISO date (YYYY-MM-DD) read from the card, or null when none is present. */
  date: string | null;
  /** Visible text of the whole card. */
  text: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const MONTH_NAMES = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";

function toIsoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Find the first calendar date in free text. Understands ISO (2026-09-12),
 * day-first "12 September 2026" / "12th Sept 2026", month-first "September 12,
 * 2026" and Australian day-first numeric "12/09/2026". Returns null when no
 * valid date is present rather than guessing.
 */
export function parseListingDate(text: string): string | null {
  const found: Array<{ index: number; iso: string }> = [];
  const add = (index: number, iso: string | null) => { if (iso) found.push({ index, iso }); };

  for (const m of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})(?!\d)/g)) {
    add(m.index ?? 0, toIsoDate(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAMES})\\.?,?\\s+(20\\d{2})\\b`, "gi");
  for (const m of text.matchAll(dayFirst)) {
    add(m.index ?? 0, toIsoDate(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1])));
  }
  const monthFirst = new RegExp(`\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, "gi");
  for (const m of text.matchAll(monthFirst)) {
    add(m.index ?? 0, toIsoDate(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2])));
  }
  for (const m of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2})\b/g)) {
    add(m.index ?? 0, toIsoDate(Number(m[3]), Number(m[2]), Number(m[1])));
  }
  if (!found.length) return null;
  found.sort((a, b) => a.index - b.index);
  return found[0].iso;
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ndash: "-", mdash: "-",
  rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: "...",
};

export function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => safeCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => safeCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole);
}

function safeCodePoint(code: number): string {
  try { return String.fromCodePoint(code); } catch { return " "; }
}

/** Visible text of an HTML fragment. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

export function resolveHttpUrl(href: string | undefined | null, baseUrl: string): string | null {
  if (!href) return null;
  const trimmed = decodeEntities(href).trim();
  if (!trimmed || trimmed.startsWith("#") || /^(?:javascript|mailto|tel|data):/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

const CARD_TAGS = ["article", "div", "section", "li"] as const;
const CARD_CLASS_RE = /(?:post|article|entry|item|result|card|teaser|project)/i;
const MAX_HTML_CHARS = 2_500_000;
const MAX_CANDIDATES = 3_000;

/** Index just past the close tag that balances the opening tag ending at `from`. */
function findBalancedEnd(html: string, tag: string, from: number): number {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = from;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

const HEADING_RE = /<h[1-4]\b/gi;

/**
 * Extract listing cards. A card is an article (or a div/section/li whose class
 * marks it as a post/item/result) that holds exactly one heading; wrappers
 * holding several headings are treated as lists and skipped in favour of the
 * cards inside them. Nested candidates keep only the outermost card.
 */
export function extractListingCards(html: string, baseUrl: string): ListingCard[] {
  const source = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html;
  const openTag = new RegExp(`<(${CARD_TAGS.join("|")})\\b([^>]*)>`, "gi");
  const ranges: Array<{ start: number; end: number; inner: string }> = [];

  let candidates = 0;
  for (let m = openTag.exec(source); m && candidates < MAX_CANDIDATES; m = openTag.exec(source)) {
    const tag = m[1].toLowerCase();
    const classMatch = m[2].match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const className = classMatch?.[1] ?? classMatch?.[2] ?? "";
    if (tag !== "article" && !CARD_CLASS_RE.test(className)) continue;
    candidates++;
    const innerStart = m.index + m[0].length;
    const end = findBalancedEnd(source, tag, innerStart);
    if (end < 0) continue;
    const inner = source.slice(innerStart, end);
    if ((inner.match(HEADING_RE)?.length ?? 0) !== 1) continue;
    ranges.push({ start: m.index, end, inner });
  }

  // Keep the outermost card of any nested pair.
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: typeof ranges = [];
  let lastEnd = -1;
  for (const range of ranges) {
    if (range.start < lastEnd) continue;
    kept.push(range);
    lastEnd = range.end;
  }

  const cards: ListingCard[] = [];
  for (const { inner } of kept) {
    const heading = inner.match(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]\s*>/i);
    const title = heading ? htmlToText(heading[1]) : "";
    if (!title) continue;
    const headingHref = heading?.[1].match(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const anyHref = inner.match(/<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const url = resolveHttpUrl(headingHref?.[1] ?? headingHref?.[2] ?? anyHref?.[1] ?? anyHref?.[2], baseUrl);
    const text = htmlToText(inner);
    const datetime = inner.match(/<time\b[^>]*\bdatetime\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const date = parseListingDate(datetime?.[1] ?? datetime?.[2] ?? "") ?? parseListingDate(text);
    cards.push({ title, url, date, text });
  }
  return cards;
}

/** The listing's own "next page" link, restricted to the same host. */
export function findNextPageUrl(html: string, currentUrl: string): string | null {
  const candidates: string[] = [];
  for (const m of html.matchAll(/<(?:link|a)\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = tag.match(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const cls = tag.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const isNext = /\bnext\b/i.test(rel?.[1] ?? rel?.[2] ?? "")
      || /(?:^|[\s_-])next(?:[\s_-]|$)/i.test(cls?.[1] ?? cls?.[2] ?? "");
    if (!isNext) continue;
    const href = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const resolved = resolveHttpUrl(href?.[1] ?? href?.[2], currentUrl);
    if (resolved) candidates.push(resolved);
  }
  let current: URL;
  try { current = new URL(currentUrl); } catch { return null; }
  for (const candidate of candidates) {
    const url = new URL(candidate);
    url.hash = "";
    if (url.hostname.replace(/^www\./, "") !== current.hostname.replace(/^www\./, "")) continue;
    if (url.href === new URL(currentUrl).href) continue;
    return url.href;
  }
  return null;
}

/** WordPress-style feed pagination: `/feed/?paged=2`. */
export function feedPageUrl(feedUrl: string, page: number): string | null {
  try {
    const url = new URL(feedUrl);
    if (!/\/feed\/?$/i.test(url.pathname)) return null;
    url.searchParams.set("paged", String(page));
    return url.href;
  } catch {
    return null;
  }
}
