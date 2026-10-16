import type { WorkBook } from "xlsx";

type XlsxApi = {
  read: (data: Buffer, options: { type: "buffer" }) => WorkBook;
  utils: {
    sheet_to_json: <T>(
      sheet: WorkBook["Sheets"][string],
      options: { header: 1; raw: true },
    ) => T[];
  };
};

function isXlsxApi(value: unknown): value is XlsxApi {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<XlsxApi>;
  return (
    typeof candidate.read === "function" &&
    typeof candidate.utils?.sheet_to_json === "function"
  );
}

/**
 * Normalise both native ESM and esbuild's CommonJS interop namespace shapes.
 * The production bundle exposes xlsx under `default`, while local execution
 * may expose its named properties directly.
 */
export function resolveXlsxApi(moduleNamespace: unknown): XlsxApi {
  if (isXlsxApi(moduleNamespace)) return moduleNamespace;
  if (moduleNamespace && typeof moduleNamespace === "object") {
    const defaultExport = (moduleNamespace as { default?: unknown }).default;
    if (isXlsxApi(defaultExport)) return defaultExport;
  }
  throw new TypeError("XLSX runtime module does not expose read() and utils");
}

export async function readAemoGenerationWorkbookRows(
  workbookData: Buffer,
): Promise<unknown[][]> {
  const xlsx = resolveXlsxApi(await import("xlsx"));
  const workbook = xlsx.read(workbookData, { type: "buffer" });
  const sheet = workbook.Sheets["Generator Information"];
  if (!sheet)
    throw new Error("AEMO Generator Information worksheet is missing");
  return xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * Find the newest "NEM Generation Information <Month> <Year>" workbook linked
 * from AEMO's Generation Information page. AEMO publishes a new workbook each
 * quarter, so a pinned URL silently goes stale. Only links on aemo.com.au are
 * accepted. Returns null when no workbook link is found.
 */
export function findLatestAemoWorkbookUrl(html: string, pageUrl: string): string | null {
  let best: { url: string; rank: number } | null = null;
  for (const match of html.matchAll(/href=["']([^"']+\.xlsx[^"']*)["']/gi)) {
    let url: URL;
    try { url = new URL(match[1].replace(/&amp;/g, "&"), pageUrl); } catch { continue; }
    if (url.protocol !== "https:" || !/(^|\.)aemo\.com\.au$/i.test(url.hostname)) continue;
    const name = decodeURIComponent(url.pathname).toLowerCase();
    const found = name.match(/nem[-_ ]generation[-_ ]information[-_ ]([a-z]+)[-_ ](\d{4})\.xlsx$/);
    if (!found) continue;
    const month = MONTHS.indexOf(found[1]);
    if (month < 0) continue;
    const rank = Number(found[2]) * 12 + month;
    if (!best || rank > best.rank) best = { url: url.href, rank };
  }
  return best?.url ?? null;
}
