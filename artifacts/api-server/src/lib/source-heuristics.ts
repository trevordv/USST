import { extractCapacityMw } from "./source-text.ts";

// Keywords that indicate a project is in early stage (not yet generating)
export const EARLY_STAGE_KEYWORDS = [
  // Announcement / proposal
  "announced", "proposed", "proposes", "proposal", "plans to build",
  "new project", "new solar", "new bess", "new battery",
  // Approval / consent
  "planning approval", "resource consent", "development approval", "da approved",
  "approved", "approval", "receives approval", "gets approval", "granted",
  "permit", "permits", "consent", "consented",
  "planning permit", "planning consent",
  // Application / referral
  "application", "applies", "applied", "lodged", "lodges",
  "referral", "referred", "da lodged", "eis lodged",
  "environmental impact", "eis", "epbc referral",
  // Development stages
  "under development", "under construction", "in development",
  "planning", "feasibility", "pre-development", "early stage",
  "to build", "will build", "breaking ground", "scoping",
  // Investment / commitment signals
  "commits", "committed", "invest", "investment", "selected",
  "awarded", "awarded contract", "reaches financial close",
  "financial close", "reaches fc",
  // Construction commencement
  "commences", "commence", "begins construction", "begin construction",
  "construction begins", "construction commences", "starts construction",
  "breaks ground", "groundbreaking",
];

// Keywords that indicate a project is generating (exclude these)
export const EXCLUDE_KEYWORDS = [
  "fully operational", "now generating", "commissioned",
  "now online", "now operating", "energised", "energized",
  "connected to grid", "switched on", "now generating power",
];

// Capacity extraction lives in source-text.ts (thousands separators, MWh/GWh
// rejection, statistic/battery/wind context scoring). Kept as a local alias so
// every parser shares one implementation.
export function extractCapacity(text: string): number | null {
  return extractCapacityMw(text);
}

// Common AU/NZ solar states and regions for location inference
export const AU_LOCATIONS = [
  "NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT",
  "New South Wales", "Victoria", "Queensland", "South Australia",
  "Western Australia", "Tasmania", "Northern Territory",
];
export const NZ_LOCATIONS = [
  "Auckland", "Wellington", "Canterbury", "Otago", "Waikato",
  "Bay of Plenty", "Manawatu", "Manawatū", "Hawke's Bay", "Hawke’s Bay", "Marlborough",
  "Northland", "Southland", "Taranaki", "Gisborne", "Nelson", "Tasman", "West Coast",
];

const LOCATION_PATTERNS = new Map<string, RegExp[]>();
function locationPatterns(country: "AU" | "NZ"): RegExp[] {
  let patterns = LOCATION_PATTERNS.get(country);
  if (!patterns) {
    patterns = (country === "AU" ? AU_LOCATIONS : NZ_LOCATIONS).map(
      (name) => new RegExp(`(?<![A-Za-z])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`),
    );
    LOCATION_PATTERNS.set(country, patterns);
  }
  return patterns;
}

/**
 * Earliest state/region named in the text. Whole-word matching stops "USA" or
 * "ISA" being read as South Australia; choosing the earliest mention (rather
 * than the first entry of a fixed list) keeps the project's own location ahead
 * of incidental later references.
 */
export function extractLocation(text: string, country: "AU" | "NZ"): string | null {
  const candidates = country === "AU" ? AU_LOCATIONS : NZ_LOCATIONS;
  let best: { index: number; name: string } | null = null;
  locationPatterns(country).forEach((pattern, position) => {
    const match = pattern.exec(text);
    if (match && (best === null || match.index < best.index)) best = { index: match.index, name: candidates[position] };
  });
  return (best as { index: number; name: string } | null)?.name ?? null;
}

export function isEarlyStage(text: string): boolean {
  const lower = text.toLowerCase();
  const hasExclude = EXCLUDE_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasExclude) return false;
  return EARLY_STAGE_KEYWORDS.some((kw) => lower.includes(kw));
}

export function determineStatus(text: string): "announced" | "under_development" {
  const lower = text.toLowerCase();
  if (
    lower.includes("under development") ||
    lower.includes("under construction") ||
    lower.includes("development approval") ||
    lower.includes("planning approval") ||
    lower.includes("resource consent")
  ) {
    return "under_development";
  }
  return "announced";
}

const COMPANY = "((?:[A-Z][A-Za-z0-9&'’.\\-]*)(?:\\s+(?:[A-Z][A-Za-z0-9&'’.\\-]*|&)){0,4})";
const DEVELOPER_CUES: RegExp[] = [
  // "developer: Acme Energy", "proponent Acme Energy"
  new RegExp(`\\b(?:[Dd]eveloper|[Pp]roponent|[Aa]pplicant|[Oo]wner)(?:\\s+is|\\s+was|:)?\\s+${COMPANY}`),
  // "developed by Acme Energy", "proposed by Acme"
  new RegExp(`\\b(?:[Dd]eveloped|being developed|[Pp]roposed|[Pp]lanned|[Oo]wned|[Bb]acked|[Ll]ed|[Bb]uilt|[Ss]ponsored)\\s+by\\s+(?:the\\s+)?${COMPANY}`),
  // Headline possessive: "Neoen's 400 MW Culcairn Solar Farm ..."
  new RegExp(`(?:^|[.!?:]\\s+)${COMPANY}['’]s\\s+(?:\\d[\\d,.]*\\s*(?:MW|GW)\\s+)?[A-Z]`),
  // Sentence subject: "Origin Energy has lodged plans for ..."
  new RegExp(`(?:^|[.!?:]\\s+|,\\s+)${COMPANY}\\s+(?:has|have|had|is|are|will|plans?|proposes?|lodges?|lodged|unveils?|unveiled|announces?|announced|submits?|submitted|secures?|secured|receives?|received|gets|wins|files?|filed)\\b`),
];
const AGENCY_RE =
  /\b(?:Commission|Department|Government|Council|Minister|Ministry|Authority|Regulator|EPA|Agency|Planning|Parliament|Court|Tribunal|University|Institute|Committee|Board|Panel|Treasury)\b/;
const PROJECT_NAME_TAIL_RE = /\b(?:Solar|Wind|Battery|Energy|Renewable|Hybrid)\s+(?:Farm|Park|Project|Hub|Precinct|Zone|Plant|Station|Development)\s*$/i;
const NOT_A_COMPANY_START_RE =
  /^(?:The|This|That|These|Those|A|An|It|Its|They|We|Our|New|Australia|Australian|Queensland|Victoria|Victorian|Tasmania|Tasmanian|Western|South|North|Northern|Southern|NSW|QLD|VIC|WA|SA|NT|ACT|TAS|Solar|Wind|Battery|Renewable|Renewables|Clean|Green|Large|Major|Proposed|Planned|Approved|Another|Several|Two|Three|Four|Five|One)\b/;

function plausibleDeveloper(candidate: string): string | null {
  const name = candidate.split(/[.;]\s/)[0].replace(/[\s.,;:'’-]+$/, "").trim();
  if (name.length < 3 || name.length > 60) return null;
  if (NOT_A_COMPANY_START_RE.test(name)) return null;
  if (AGENCY_RE.test(name)) return null;
  if (PROJECT_NAME_TAIL_RE.test(name)) return null;
  return name;
}

/**
 * Developer/proponent named by an explicit cue ("developed by X", "developer X",
 * "X's … Solar Farm", "X has lodged …"). Returns null rather than guessing:
 * the earlier fallback pattern returned the first capitalised phrase ending in
 * "Solar"/"Energy"/"Power", which was routinely the project name ("Culcairn
 * Solar") or a regulator ("Independent Planning Commission"), polluting the
 * developer column that contact enrichment and outreach depend on.
 */
export function extractDeveloper(text: string): string | null {
  for (const cue of DEVELOPER_CUES) {
    const match = cue.exec(text);
    if (!match) continue;
    const developer = plausibleDeveloper(match[1]);
    if (developer) return developer;
  }
  return null;
}
