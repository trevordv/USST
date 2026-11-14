import { parseHtmlPage, type NewsSource } from "./news-parsers.ts";
import { assertSourceDocument, SourceExtractionError } from "./source-extraction-outcome.ts";
import { classifyManagedZeroResult } from "./managed-source-extraction.ts";

/** Shared by production acquisition and the read-only release probe. */
export function parseScraplingNewsPage(html: string, source: NewsSource,
  startDate?: string, endDate?: string, pageUrl = source.searchUrl) {
  assertSourceDocument(html, "html");
  const items = parseHtmlPage(html, source, startDate, endDate, pageUrl);
  if (items.length || classifyManagedZeroResult(source.name, html) !== "unresolved") return items;

  // A date-filtered zero is not a parser failure. Prove that the same parser
  // read dated candidates, and that every candidate is outside the window.
  if (source.name === "Energy Magazine" && (startDate || endDate)) {
    const unbounded = parseHtmlPage(html, source, undefined, undefined, pageUrl);
    if (unbounded.length && unbounded.every(item => item.announcedDate &&
        ((startDate && item.announcedDate < startDate) || (endDate && item.announcedDate > endDate)))) return items;
  }
  throw new SourceExtractionError("requires-js-or-ai-repair", "Scrapling document still requires project normalisation", "unresolved-project-records");
}
