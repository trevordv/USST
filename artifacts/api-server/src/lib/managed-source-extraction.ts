export type ManagedZeroClassification = "legitimate-zero" | "unresolved";

const DETAIL_REQUIRED_SOURCES = new Set([
  "QLD Planning – Renewable Energy",
  "NZ Fast-track",
  "NZ EPA – Fast-track Projects",
  "NZ EPA – RMA Proposals",
  "NZ EPA – Public Consultations",
  "NZ Ministry for the Environment",
  "WA EPA",
]);

/**
 * Transport success is not extraction success. These reviewed portals expose
 * records through an iframe, client-side search, category page or linked detail
 * page; an empty generic-markdown parse is unresolved unless the portal itself
 * explicitly reports no current results.
 */
export function classifyManagedZeroResult(
  sourceName: string,
  content: string,
): ManagedZeroClassification {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (
    /\bno (?:current |matching )?(?:projects|applications|results|consultations)\b/i.test(
      normalized,
    )
  ) {
    return "legitimate-zero";
  }
  if (sourceName === "Planning Victoria") return "legitimate-zero"; // guidance page, not a project register
  if (sourceName === "QLD Coordinator-General")
    return /\bsolar\b/i.test(normalized) ? "unresolved" : "legitimate-zero";
  if (DETAIL_REQUIRED_SOURCES.has(sourceName)) return "unresolved";
  if (sourceName === "Energy Magazine" && /\bsolar\b/i.test(normalized))
    return "unresolved";
  return "legitimate-zero";
}
