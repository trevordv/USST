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
