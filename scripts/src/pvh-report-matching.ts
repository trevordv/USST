/**
 * Pure matching logic for importing the PVH quarterly report (Green Energy
 * Markets solar PV project lists) into USST. USST is the source of truth:
 * existing projects are only ever *enriched* (blank fields filled), never
 * overwritten, and any uncertain match is sent to review instead of inserted.
 */

export const REPORT_SOURCE_NAME = "PVH Q2 Report (Green Energy Markets)";
export const REPORT_SOURCE_BASE_URL = "https://www.greenmarkets.com.au/";

export interface ReportProject {
  sheet: string;
  name: string;
  altNames: string[];
  state: string | null;
  owner: string | null;
  locality: string | null;
  epc: string | null;
  capacityMw: number | null;
  reportStatus: string;
  battery: string | null;
  usstStatus: "announced" | "under_development";
  pipeline: boolean;
}

export interface UsstProject {
  id: number;
  name: string;
  description: string | null;
  capacityMw: string | number | null;
  developer: string | null;
  epc: string | null;
  location: string | null;
  country: string;
  status: string;
  sourceName: string | null;
}

const AU_STATES = ["NSW", "QLD", "VIC", "SA", "WA", "TAS", "NT", "ACT"];
const STATE_WORDS: Record<string, string> = {
  "new south wales": "NSW", queensland: "QLD", victoria: "VIC", "south australia": "SA",
  "western australia": "WA", tasmania: "TAS", "northern territory": "NT", "australian capital territory": "ACT",
};

/** Pipeline statuses imported as new projects (operational, withdrawn, not active and rejected are not). */
export function classifyReportStatus(raw: unknown): { pipeline: boolean; usstStatus: "announced" | "under_development"; label: string } {
  const label = String(raw ?? "").trim();
  const lower = label.toLowerCase();
  if (lower === "yet to be approved") return { pipeline: true, usstStatus: "announced", label };
  if (["approved", "under construction", "in commissioning", "ppa not committed", "underwritten"].includes(lower)) {
    return { pipeline: true, usstStatus: "under_development", label };
  }
  return { pipeline: false, usstStatus: "under_development", label: label || "Unknown" };
}

/** Readable company name: drop trustee wording and fix ALL-CAPS legal names. */
export function cleanOwner(value: unknown): string | null {
  let text = clean(value);
  if (!text) return null;
  text = text.replace(/\s+(?:as|atf)\s+(?:the\s+)?trustee\s+for\b.*$/i, "").trim();
  if (text === text.toUpperCase() && /[A-Z]{3}/.test(text)) {
    text = text.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
      .replace(/\bPty\b/g, "Pty").replace(/\bLtd\b/g, "Ltd").replace(/\b(Agl|Apa|Edf|Res|Acen|Bp|Cwp|Ark|Ngr)\b/g, (m) => m.toUpperCase());
  }
  return text;
}

function clean(value: unknown): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text && !/^(not disclosed|n\/a|na|tbd|tba|-|none)$/i.test(text) ? text : null;
}

/** Split "Beelbee Solar Farm (Darling Downs II) - QLD" into a primary name and alternate names. */
export function splitReportName(raw: string): { name: string; altNames: string[] } {
  let name = raw.replace(/\s+/g, " ").trim();
  // Trailing state codes ("- QLD", "ACT", "- Vic") and the operational sheet's
  // technology suffix ("Stubbo - Solar", "Wollar Solar Farm-Solar"), in any order.
  const stateSuffix = new RegExp(`\\s*[-–]?\\s*\\b(?:${AU_STATES.join("|")})\\s*$`, "i");
  for (let pass = 0; pass < 3; pass++) {
    name = name.replace(stateSuffix, "").replace(/\s*[-–]\s*(?:solar|pv|solar pv)\s*$/i, "").trim();
  }
  const altNames: string[] = [];
  name = name.replace(/\(([^)]+)\)/g, (_, inner: string) => {
    const alt = inner.trim();
    if (/^(stage\s+\w+|expansion)$/i.test(alt)) return ` ${alt} `;
    if (alt && !/^(hybrid|solar|pv|bess)$/i.test(alt)) altNames.push(alt);
    return " ";
  }).replace(/\s+/g, " ").trim();
  if (name === name.toUpperCase()) name = name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return { name, altNames };
}

const GENERIC = new Set([
  "solar", "farm", "farms", "park", "project", "projects", "plant", "station", "power", "facility", "development",
  "pv", "bess", "battery", "storage", "energy", "renewable", "renewables", "hub", "hybrid", "and", "the", "precinct",
  "photovoltaic", "array", "generation", "generator", "zone", "the",
]);

/** Distinctive identity key: lower-case words without generic asset words. Null when too vague. */
export function identityKey(name: string | null | undefined): string | null {
  const words = (name ?? "").toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ").split(" ").filter((word) => word && !GENERIC.has(word));
  const key = words.join(" ");
  // Three letters suffices ("Hay", "Ayr", "Moe"): matches still need the same state and compatible MW.
  return key.replace(/\s/g, "").length >= 3 ? key : null;
}

export function stateOf(location: string | null | undefined): string | null {
  const text = location ?? "";
  for (const code of AU_STATES) if (new RegExp(`\\b${code}\\b`).test(text)) return code;
  const lower = text.toLowerCase();
  for (const [word, code] of Object.entries(STATE_WORDS)) if (lower.includes(word)) return code;
  return null;
}

const OWNER_GENERIC = new Set(["pty", "ltd", "limited", "group", "holdings", "australia", "australian", "co", "company", "corporation", "inc", "trust", "the", "of", "and"]);

/** Developers agree when their names share a distinctive word ("Leeson Group" ~ "BNRG Leeson"). */
export function sameOwner(a: string | null | undefined, b: string | null | undefined): boolean {
  const words = (value: string | null | undefined) => new Set((identityKey(value) ?? "").split(" ").filter((word) => word.length >= 3 && !OWNER_GENERIC.has(word)));
  const left = words(a);
  return [...words(b)].some((word) => left.has(word));
}

export function capacityCompatible(a: number | string | null | undefined, b: number | string | null | undefined): boolean {
  const x = Number(a);
  const y = Number(b);
  if (a == null || b == null || !Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) return true;
  return Math.min(x, y) / Math.max(x, y) >= 0.65;
}

/** Parse every sheet of the report workbook (rows as arrays, header on row 2). */
export function parseReportRows(sheets: Array<{ name: string; rows: unknown[][] }>): ReportProject[] {
  const out: ReportProject[] = [];
  for (const sheet of sheets) {
    const header = (sheet.rows[1] ?? []).map((cell) => String(cell ?? "").trim().toLowerCase());
    const col = (...names: string[]) => header.findIndex((cell) => names.some((name) => cell.startsWith(name)));
    const iName = col("project name"); const iState = col("state"); const iOwner = col("project owner");
    const iLocality = col("locality"); const iCap = col("capacity"); const iEpc = col("construction firm");
    const iStatus = col("year operational/status", "development approval");
    const iBattery = col("battery details", "battery storage"); const iBatteryFlag = col("battery proposed");
    if (iName < 0 || iStatus < 0) continue;
    for (const row of sheet.rows.slice(2)) {
      const rawName = clean(row[iName]);
      if (!rawName) continue;
      const { name, altNames } = splitReportName(rawName);
      const status = classifyReportStatus(row[iStatus]);
      const capacity = Number(row[iCap]);
      const state = clean(row[iState]);
      const stateCode = state?.toUpperCase();
      const batteryDetail = iBattery >= 0 ? clean(row[iBattery]) : null;
      const batteryFlag = iBatteryFlag >= 0 ? clean(row[iBatteryFlag]) : null;
      out.push({
        sheet: sheet.name,
        name,
        altNames,
        state: stateCode && AU_STATES.includes(stateCode) ? stateCode : STATE_WORDS[state?.toLowerCase() ?? ""] ?? state,
        owner: cleanOwner(row[iOwner]),
        locality: clean(row[iLocality]),
        epc: iEpc >= 0 ? clean(row[iEpc]) : null,
        capacityMw: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
        reportStatus: status.label,
        battery: batteryDetail && !/^y(es)?$/i.test(batteryDetail) ? batteryDetail : batteryDetail || batteryFlag ? "Yes" : null,
        usstStatus: status.usstStatus,
        pipeline: status.pipeline,
      });
    }
  }
  return out;
}

/** Why a report row is not imported as a new project, or null when it is eligible. */
export function reportIneligibility(project: ReportProject): string | null {
  if (!project.pipeline) return `status: ${project.reportStatus}`;
  if (project.capacityMw == null) return "capacity not stated";
  if (project.capacityMw < 5) return "below 5 MW";
  if (project.state && !AU_STATES.includes(project.state)) return "outside Australian states and territories";
  const names = [project.name, ...project.altNames];
  if (names.some((name) => /wind\b/i.test(name))) return "wind project";
  if (/\b(?:bess|batter(?:y|ies)|storage)\b/i.test(project.name) &&
      !/\b(?:solar|photovoltaic|pv)\b/i.test(project.name)) return "storage project without a solar component";
  return null;
}

/** Merge rows that describe the same project within the report (e.g. operational sheet + state sheet). */
export function dedupeReport(projects: ReportProject[]): ReportProject[] {
  const kept: ReportProject[] = [];
  for (const project of projects) {
    const key = identityKey(project.name);
    const twin = key ? kept.find((other) => identityKey(other.name) === key && other.state === project.state &&
      capacityCompatible(other.capacityMw, project.capacityMw)) : undefined;
    if (!twin) { kept.push({ ...project, altNames: [...project.altNames] }); continue; }
    // Prefer a pipeline status over a non-pipeline one, and fill blanks.
    if (!twin.pipeline && project.pipeline) { twin.reportStatus = project.reportStatus; twin.usstStatus = project.usstStatus; twin.pipeline = true; }
    twin.owner ??= project.owner; twin.locality ??= project.locality; twin.epc ??= project.epc;
    twin.capacityMw ??= project.capacityMw; twin.battery ??= project.battery;
    for (const alt of project.altNames) if (!twin.altNames.includes(alt)) twin.altNames.push(alt);
  }
  return kept;
}

export type MatchOutcome =
  | { kind: "match"; usst: UsstProject; via: string }
  | { kind: "review"; reason: string; candidates: UsstProject[] }
  | { kind: "missing" };

function reportNameKeys(project: ReportProject): string[] {
  return [project.name, ...project.altNames].map(identityKey).filter((key): key is string => Boolean(key));
}

function isVariantName(key: string, other: string): boolean {
  return key.length >= 6 && (other.startsWith(`${key} `) || key.startsWith(`${other} `));
}

/** Flag report rows whose names, aliases or stage names overlap within one import. */
export function findAmbiguousAdditions(projects: readonly ReportProject[]): Set<ReportProject> {
  const ambiguous = new Set<ReportProject>();
  const names = projects.map(reportNameKeys);
  for (const [index, project] of projects.entries()) {
    for (let other = index + 1; other < projects.length; other++) {
      if (names[index].some((key) => names[other].some((candidate) =>
        key === candidate || isVariantName(key, candidate) || isVariantName(candidate, key)
      ))) {
        ambiguous.add(project);
        ambiguous.add(projects[other]);
      }
    }
  }
  return ambiguous;
}

/** Find the USST project a report row refers to. Uncertain results go to review, never to insert. */
export function matchToUsst(project: ReportProject, usst: readonly UsstProject[]): MatchOutcome {
  const keys = reportNameKeys(project);
  if (keys.length === 0) return { kind: "review", reason: "name too generic to match safely", candidates: [] };
  const sameName = usst.filter((row) => row.country === "AU" && keys.includes(identityKey(row.name) ?? "\u0000"));
  const sameState = sameName.filter((row) => !project.state || !stateOf(row.location) || stateOf(row.location) === project.state);
  const compatible = sameState.filter((row) => capacityCompatible(row.capacityMw, project.capacityMw));
  if (compatible.length === 1) return { kind: "match", usst: compatible[0], via: "name" };
  if (compatible.length > 1) {
    const byOwner = compatible.filter((row) => sameOwner(row.developer, project.owner));
    if (byOwner.length === 1) return { kind: "match", usst: byOwner[0], via: "name+developer" };
    return { kind: "review", reason: "several USST projects share this name", candidates: compatible };
  }
  if (sameState.length > 0) return { kind: "review", reason: "same name, capacity differs by more than 35%", candidates: sameState };
  if (sameName.length > 0) return { kind: "review", reason: "same name in a different state", candidates: sameName };
  // Containment: "Bridle Track" vs "Bridle Track Solar & BESS Stage 1" — never auto-matched.
  const contains = usst.filter((row) => {
    const other = identityKey(row.name);
    return row.country === "AU" && other && keys.some((key) => isVariantName(key, other));
  });
  if (contains.length > 0) return { kind: "review", reason: "similar name (possible stage or variant)", candidates: contains };
  return { kind: "missing" };
}

export interface EnrichmentFields { developer?: string; epc?: string; location?: string; description?: string }

function reportDescription(project: ReportProject): string {
  const parts = [
    `${project.capacityMw ?? "?"} MW solar PV project${project.locality ? ` at ${project.locality}` : ""}${project.state ? `, ${project.state}` : ""}`,
    `status (Green Energy Markets): ${project.reportStatus}`,
    project.battery ? `battery: ${project.battery}` : null,
  ].filter(Boolean);
  return `${parts.join("; ")}. Source: PVH Q2 report (Green Energy Markets).`;
}

export function reportLocation(project: ReportProject): string | null {
  return [project.locality, project.state].filter(Boolean).join(", ") || null;
}

/** Fill only blank USST fields. Never replaces anything USST already holds. */
export function planEnrichment(usst: UsstProject, project: ReportProject): EnrichmentFields {
  const fields: EnrichmentFields = {};
  if (!usst.developer?.trim() && project.owner) fields.developer = project.owner;
  if (!usst.epc?.trim() && project.epc) fields.epc = project.epc;
  if (!usst.location?.trim() && reportLocation(project)) fields.location = reportLocation(project)!;
  if (!usst.description?.trim()) fields.description = reportDescription(project);
  return fields;
}

/** Differences worth a human look; reported, never written. */
export function reportDifferences(usst: UsstProject, project: ReportProject): string[] {
  const notes: string[] = [];
  if (!capacityCompatible(usst.capacityMw, project.capacityMw) || (project.capacityMw != null && Number(usst.capacityMw) !== project.capacityMw)) {
    if (project.capacityMw != null && Math.abs(Number(usst.capacityMw) - project.capacityMw) >= 1) notes.push(`capacity USST ${Number(usst.capacityMw)} MW vs report ${project.capacityMw} MW`);
  }
  if (project.pipeline && usst.status !== project.usstStatus) notes.push(`status USST ${usst.status} vs report ${project.reportStatus}`);
  if (!project.pipeline) notes.push(`report status ${project.reportStatus}`);
  if (usst.developer && project.owner && !sameOwner(usst.developer, project.owner)) {
    notes.push(`developer USST "${usst.developer}" vs report "${project.owner}"`);
  }
  return notes;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

/** Row values for a missing pipeline project (passes USST's solar/capacity/region gates). */
export function newProjectValues(project: ReportProject) {
  return {
    name: project.name,
    description: reportDescription(project),
    capacityMw: String(project.capacityMw),
    developer: project.owner,
    epc: project.epc,
    location: reportLocation(project),
    country: "AU",
    status: project.usstStatus,
    sourceUrl: `${REPORT_SOURCE_BASE_URL}#pvh-q2-${slug(`${project.state ?? ""} ${project.name}`)}`,
    sourceName: REPORT_SOURCE_NAME,
    announcedDate: null,
    announcedDateEvidence: "unknown",
  };
}
