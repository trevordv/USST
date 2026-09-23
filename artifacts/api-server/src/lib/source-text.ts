/**
 * Deterministic text helpers shared by every approved-source parser.
 *
 * Everything here is pure (no I/O, no database, no logger) so that the
 * behaviour can be pinned with plain `node --test` regression tests.
 *
 * Why this module exists: the original per-source parsers each used their own
 * ad-hoc regexes. Those regexes silently lost information:
 *   - "1,200 MW" was read as 200 MW,
 *   - "400 MWh" battery energy was read as 400 MW of generation,
 *   - a "10 GW national pipeline" statistic could become a project capacity,
 *   - non-greedy `<div>…</div>` matches cut cards off at the first nested
 *     closing tag, so titles/links/dates were frequently missing,
 *   - article bodies were truncated to the first ~1000 characters, so the
 *     capacity that usually appears in paragraph two or three was never seen.
 */

// ── HTML → text ──────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  deg: "°",
  eacute: "é",
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const NON_CONTENT_BLOCKS =
  /<(script|style|noscript|svg|template|iframe|form|nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi;

/** Convert HTML to readable single-spaced text. Block tags become spaces. */
export function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(NON_CONTENT_BLOCKS, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|div|li|tr|td|th|h[1-6]|section|article|blockquote)>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Same as htmlToText but keeps the markup of inline elements out and does not
 *  strip nav/header/footer — used on already-isolated fragments. */
export function fragmentToText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// ── Balanced element extraction ──────────────────────────────────────────────

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);

export interface ElementBlock {
  tag: string;
  /** The opening tag, e.g. `<div class="post">`. */
  open: string;
  /** Inner HTML with correct nesting (unlike a non-greedy `[\s\S]*?</div>`). */
  inner: string;
  start: number;
  end: number;
}

/**
 * Find balanced elements of the given tag names whose opening tag matches
 * `openFilter`. Handles nested elements of the same tag, which a single regex
 * cannot. Linear time; unmatched openings are skipped rather than throwing.
 */
export function extractElementBlocks(
  html: string,
  tags: readonly string[],
  openFilter?: RegExp,
): ElementBlock[] {
  const tagAlt = tags.map((tag) => tag.toLowerCase()).join("|");
  const tokenRe = new RegExp(`<(/?)(${tagAlt})\\b[^>]*>`, "gi");
  const blocks: ElementBlock[] = [];
  const stacks = new Map<string, Array<{ open: string; contentStart: number; start: number; wanted: boolean }>>();

  for (const match of html.matchAll(tokenRe)) {
    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();
    const index = match.index ?? 0;
    const stack = stacks.get(tag) ?? [];
    stacks.set(tag, stack);
    if (!closing) {
      if (match[0].endsWith("/>") || VOID_TAGS.has(tag)) continue;
      stack.push({
        open: match[0],
        contentStart: index + match[0].length,
        start: index,
        wanted: openFilter ? openFilter.test(match[0]) : true,
      });
    } else {
      const opened = stack.pop();
      if (opened?.wanted) {
        blocks.push({
          tag,
          open: opened.open,
          inner: html.slice(opened.contentStart, index),
          start: opened.start,
          end: index + match[0].length,
        });
      }
    }
  }
  return blocks.sort((a, b) => a.start - b.start);
}

const CONTENT_CLASS_RE =
  /class=["'][^"']*\b(?:entry-content|post-content|article-content|article-body|post-body|story-body|blog-content|blog-details|post-details|lower-box|content-body|single-content|the-content|td-post-content|node__content|field--name-body)\b[^"']*["']/i;

/**
 * Extract the readable main text of an article page. Prefers explicit content
 * containers, then <article>, then <main>, and finally the whole document
 * (minus navigation chrome). The result is not truncated below `maxChars`,
 * unlike the previous 1,000-character slices that hid capacity figures.
 */
export function extractMainText(html: string, maxChars = 12_000): string {
  const candidates: string[] = [];
  const contentBlocks = extractElementBlocks(html, ["div", "section", "article"], CONTENT_CLASS_RE);
  if (contentBlocks.length) {
    // Longest block wins: it is the outermost/most complete content wrapper.
    candidates.push(contentBlocks.reduce((best, block) => (block.inner.length > best.inner.length ? block : best)).inner);
  }
  const articleBlocks = extractElementBlocks(html, ["article"]);
  if (articleBlocks.length) {
    candidates.push(articleBlocks.reduce((best, block) => (block.inner.length > best.inner.length ? block : best)).inner);
  }
  const mainBlocks = extractElementBlocks(html, ["main"]);
  if (mainBlocks.length) candidates.push(mainBlocks[0].inner);
  candidates.push(html);

  for (const candidate of candidates) {
    const text = htmlToText(candidate);
    if (text.length >= 200 || candidate === html) return text.slice(0, maxChars);
  }
  return "";
}

// ── Capacity extraction ──────────────────────────────────────────────────────

export interface CapacityMention {
  valueMw: number;
  index: number;
  raw: string;
  score: number;
}

// Number: 1,200 | 1200 | 1.2 | 12.5. Unit: MW/GW/megawatt(s)/gigawatt(s), optional
// AC/DC/p suffix. `\b` after the unit rejects MWh/GWh (energy, not power).
const CAPACITY_MENTION_RE =
  /(?<![\d.,])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:-|–)?\s*(gw|mw|gigawatts?|megawatts?)(?:\s?(?:ac|dc|p))?\b(?!\s?h\b)/gi;

const SOLAR_NEAR_RE = /\b(?:solar|photovoltaic|pv|farm|park|array|project)\b/i;
const BATTERY_NEAR_RE = /\b(?:battery|batteries|bess|storage|mwh|gwh)\b/i;
// Industry-wide statistics or portfolio totals — never a single project's rating.
const STATISTIC_NEAR_RE =
  /\b(?:cumulative|nationwide|installed base|so far|to date|worldwide|globally|(?:national|industry|sector)[- ](?:total|capacity|pipeline|wide)|across (?:australia|new zealand|the country|the nem)|in (?:australia|new zealand)(?:'s|’s)? (?:total|renewable)|pipeline of|portfolio of)\b/i;
const BATTERY_DIRECT_TAIL_RE =
  /^\s*(?:\/\s*[\d.,]+\s*(?:mwh|gwh)\s*)?[-\s]*(?:big\s+)?(?:battery|batteries|bess|(?:energy\s+)?storage)\b/i;
const BATTERY_DIRECT_HEAD_RE = /\b(?:battery|bess|storage)\s+(?:of|rated at|capacity of|with|at)?\s*(?:up to\s+)?$/i;
const WIND_NEAR_RE = /\b(?:wind|turbines?)\b/i;

function windowAround(text: string, index: number, length: number, before: number, after: number): string {
  return text.slice(Math.max(0, index - before), Math.min(text.length, index + length + after));
}

export function findCapacityMentions(text: string): CapacityMention[] {
  const mentions: CapacityMention[] = [];
  for (const match of text.matchAll(CAPACITY_MENTION_RE)) {
    const index = match.index ?? 0;
    const raw = match[0];
    let value = Number.parseFloat(match[1].replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) continue;
    if (/^g/i.test(match[2])) value *= 1_000;
    // Solar farms above 20 GW do not exist in AU/NZ pipelines; larger numbers
    // are aggregate statistics or unit typos.
    if (value > 20_000) continue;

    const wide = windowAround(text, index, raw.length, 90, 90);
    const near = windowAround(text, index, raw.length, 35, 45);
    let score = 0;
    if (SOLAR_NEAR_RE.test(near)) score += 3;
    if (/\bsolar\b/i.test(near)) score += 2;
    if (STATISTIC_NEAR_RE.test(wide)) score -= 10;
    if (WIND_NEAR_RE.test(near) && !/\bsolar\b/i.test(near)) score -= 10;
    // A rating that is directly qualified as battery/storage ("a 100 MW
    // battery", "100 MW / 200 MWh") is storage power, not solar generation,
    // even when the sentence also names the solar farm.
    const tail = text.slice(index + raw.length, index + raw.length + 24);
    const head = text.slice(Math.max(0, index - 22), index);
    if (BATTERY_DIRECT_TAIL_RE.test(tail) || BATTERY_DIRECT_HEAD_RE.test(head)) score -= 10;
    mentions.push({ valueMw: value, index, raw, score });
  }
  return mentions;
}

/**
 * Best single-project capacity in MW, or null when the text only contains
 * statistics, storage ratings or energy (MWh) figures.
 */
export function extractCapacityMw(text: string): number | null {
  const mentions = findCapacityMentions(text).filter((mention) => mention.score > -5);
  if (!mentions.length) return null;
  let best = mentions[0];
  for (const mention of mentions) {
    if (mention.score > best.score) best = mention;
  }
  return best.valueMw;
}

// ── Project-name derivation ─────────────────────────────────────────────────

const NAME_SUFFIX =
  "(?:Solar\\s+(?:Farm|Park|Project|Power\\s+Station|Power\\s+Plant|Hub|Plant|Precinct|Energy\\s+Project)|Solar\\s+and\\s+(?:Battery|BESS)\\s+(?:Farm|Project|Hub)|Renewable\\s+Energy\\s+(?:Hub|Park|Project|Precinct|Zone)|Energy\\s+(?:Hub|Park|Precinct)|Hybrid\\s+(?:Project|Farm))";
const NAME_RUN_RE = new RegExp(`((?:[A-Z][A-Za-z0-9'’.\\-]*\\s+){1,4})(${NAME_SUFFIX})`, "gi");
const LEADING_NOISE_RE =
  /^(?:(?:New|Proposed|Planned|Massive|Giant|Huge|Another|First|Australia['’]s|Queensland['’]s|Victoria['’]s|NSW['’]s|Plans|Approval|Approves|Approved|Proposal|Green|Light|Australian|Large|Big|Major|The|A)\s+)+/i;
const POSSESSIVE_PREFIX_RE = /^[A-Z][A-Za-z0-9.\-]*['’]s\s+/;
const HEADLINE_ACTOR_RE = /^[A-Z][A-Za-z0-9&'.\-]*\s+(?:advances?|develops?|proposes?|plans?|backs?|unveils?|acquires?|sells?)\s+/i;

/**
 * Derive a project name (e.g. "Culcairn Solar Farm") from a news headline such
 * as "Neoen's 400 MW Culcairn Solar Farm wins approval". Returns null when the
 * headline does not contain a proper-noun + project-suffix run, in which case
 * callers keep the original headline. Deliberately conservative: it requires a
 * place/developer word in front of the suffix so "Solar Farm" alone never
 * qualifies.
 */
export function deriveProjectNames(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of cleaned.matchAll(NAME_RUN_RE)) {
    const prefixWords = match[1].trim().split(/\s+/);
    // Drop everything up to and including a unit token ("400 MW Culcairn ...").
    let lastUnit = -1;
    prefixWords.forEach((word, position) => {
      if (/^(?:mw|gw|mwh|gwh|mwp|mwac|mwdc|bess|pv)$/i.test(word)) lastUnit = position;
    });
    const afterUnit = prefixWords.slice(lastUnit + 1);
    const firstProper = afterUnit.findIndex((word) => /^[A-Z]/.test(word));
    const prefix = afterUnit
      .slice(firstProper >= 0 ? firstProper : 0)
      .join(" ")
      .replace(POSSESSIVE_PREFIX_RE, "")
      .replace(HEADLINE_ACTOR_RE, "")
      .replace(LEADING_NOISE_RE, "")
      .trim();
    if (!prefix) continue;
    const candidate = `${prefix} ${match[2].replace(/\s+/g, " ")}`;
    if (candidate.length < 8 || candidate.length > 80) continue;
    const key = normalizeProjectName(candidate);
    if (!seen.has(key)) {
      seen.add(key);
      names.push(candidate);
    }
  }
  return names;
}

export function deriveProjectName(headline: string): string | null {
  const names = deriveProjectNames(headline);
  return names.reduce<string | null>((best, candidate) =>
    best == null || candidate.length > best.length ? candidate : best, null);
}

/** Stable lowercase identity for a project name (punctuation-insensitive). */
export function normalizeProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** URL-safe slug used to keep multiple projects on one listing page distinct. */
export function projectSlug(name: string): string {
  return normalizeProjectName(name).replace(/\s+/g, "-").slice(0, 80);
}

// ── Dates in page text ───────────────────────────────────────────────────────

const MONTHS: Record<string, string> = {
  january: "01", jan: "01", february: "02", feb: "02", march: "03", mar: "03", april: "04", apr: "04",
  may: "05", june: "06", jun: "06", july: "07", jul: "07", august: "08", aug: "08",
  september: "09", sep: "09", sept: "09", october: "10", oct: "10", november: "11", nov: "11", december: "12", dec: "12",
};
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const DATE_ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const DATE_DMY_NUM_RE = /\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/;
const DATE_DMY_RE = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_ALT})\\.?,?\\s+(\\d{4})\\b`, "i");
const DATE_MDY_RE = new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "i");

function validIsoDate(year: string, month: string, day: string): string | null {
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * First explicit calendar date in a text fragment, as YYYY-MM-DD, or null.
 * Understands ISO dates, Australian numeric day-first dates, "12 June 2026"
 * and "June 12, 2026". Never falls back
 * to today's date: an undated item is unknown, not new (see
 * docs/Scan-Date-Window-Policy.md).
 */
export function parseTextDate(text: string): string | null {
  const iso = text.match(DATE_ISO_RE);
  if (iso) {
    const valid = validIsoDate(iso[1], iso[2], iso[3]);
    if (valid) return valid;
  }
  const numericDmy = text.match(DATE_DMY_NUM_RE);
  if (numericDmy) {
    const valid = validIsoDate(numericDmy[3], numericDmy[2], numericDmy[1]);
    if (valid) return valid;
  }
  const dmy = text.match(DATE_DMY_RE);
  if (dmy) {
    const valid = validIsoDate(dmy[3], MONTHS[dmy[2].toLowerCase()], dmy[1]);
    if (valid) return valid;
  }
  const mdy = text.match(DATE_MDY_RE);
  if (mdy) {
    const valid = validIsoDate(mdy[3], MONTHS[mdy[1].toLowerCase()], mdy[2]);
    if (valid) return valid;
  }
  return null;
}

/** Hostname without a leading "www." for same-site comparisons. */
export function siteHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Discovered pages may be fetched only from an exact approved HTTPS host. */
export function isApprovedDiscoveredUrl(url: string, approvedHosts: ReadonlySet<string>): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:"
      && !parsed.username && !parsed.password && !parsed.port
      && approvedHosts.has(siteHost(parsed.href) ?? "");
  } catch {
    return false;
  }
}

/** Find an explicitly marked next listing page, without leaving the current host. */
export function nextListingPageUrl(html: string, pageUrl: string): string | null {
  const host = siteHost(pageUrl);
  if (!host) return null;
  for (const tag of html.match(/<(?:a|link)\b[^>]*>/gi) ?? []) {
    const rel = tag.match(/\brel=["']([^"']+)["']/i)?.[1] ?? "";
    const classes = tag.match(/\bclass=["']([^"']+)["']/i)?.[1] ?? "";
    if (!/(?:^|\s)next(?:\s|$)/i.test(rel) && !/(?:^|\s)next(?:\s|$)/i.test(classes)) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    const resolved = href ? resolveHttpUrl(href, pageUrl) : null;
    if (resolved && resolved !== pageUrl && isApprovedDiscoveredUrl(resolved, new Set([host]))) return resolved;
  }
  return null;
}

/** Resolve an href against a page URL; null for non-http(s), anchors and mailto. */
export function resolveHttpUrl(href: string, pageUrl: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || /^(?:mailto|tel|javascript):/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, pageUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
