/**
 * Checks that values returned by the AI source fallback are present in the
 * bounded source content the model was given. A capacity or announcement date
 * that cannot be found in that content is treated as unknown rather than
 * trusted, so the normal quality and date gates decide (missing capacity is
 * dropped; an unknown date is excluded from bounded scans).
 */

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function normalizeContent(content: string): string {
  return content.toLowerCase().replace(/ /g, " ").replace(/\s+/g, " ");
}

function numberPattern(value: number): string {
  const variants = new Set<string>();
  const fixed = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
  variants.add(fixed.replace(".", "\\."));
  const [whole, fraction] = fixed.split(".");
  if (whole.length > 3) {
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    variants.add(`${grouped}${fraction ? `\\.${fraction}` : ""}`);
  }
  // "100" may be written "100.0"
  if (Number.isInteger(value)) variants.add(`${fixed}\\.0+`);
  return `(?<![\\d.,])(?:${[...variants].join("|")})(?![\\d])`;
}

/** True when `capacityMw` appears in the content as MW (or the equivalent GW). */
export function capacityAppearsInContent(capacityMw: number, content: string): boolean {
  if (!Number.isFinite(capacityMw) || capacityMw <= 0) return false;
  const text = normalizeContent(content);
  const mw = new RegExp(`${numberPattern(capacityMw)}\\s*(?:-\\s*)?(?:mw|megawatts?)`, "i");
  if (mw.test(text)) return true;
  const gw = capacityMw / 1000;
  if (gw >= 0.1) {
    const gwRe = new RegExp(`${numberPattern(gw)}\\s*(?:-\\s*)?(?:gw|gigawatts?)`, "i");
    if (gwRe.test(text)) return true;
  }
  return false;
}

/**
 * True when the ISO date (YYYY-MM-DD) appears in the content in a common
 * written form: ISO, "5 August 2026", "5 Aug 2026", "August 5, 2026",
 * "05/08/2026" or "5/8/2026" (Australian day-first order).
 */
export function dateAppearsInContent(isoDate: string, content: string): boolean {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, mm, dd] = match;
  const day = String(Number(dd));
  const monthIndex = Number(mm) - 1;
  const month = MONTHS[monthIndex];
  if (!month) return false;
  const short = month.slice(0, 3);
  const monthNames = `(?:${month}|${short}\\.?${month === "september" ? "|sept\\.?" : ""})`;
  const text = normalizeContent(content);
  const patterns = [
    `${year}-${mm}-${dd}`,
    `(?<!\\d)0?${day}(?:st|nd|rd|th)?\\s+${monthNames}\\s*,?\\s+${year}`,
    `${monthNames}\\s+0?${day}(?:st|nd|rd|th)?\\s*,?\\s+${year}`,
    `(?<!\\d)0?${day}[/.-]0?${Number(mm)}[/.-]${year}`,
  ];
  return patterns.some((pattern) => new RegExp(pattern, "i").test(text));
}
