import {
  extractCapacity,
  extractLocation,
  EXCLUDE_KEYWORDS,
} from "./source-heuristics.ts";
import {
  deriveProjectNames,
  findCapacityMentions,
  normalizeProjectName,
} from "./source-text.ts";

export type TargetCountry = "AU" | "NZ";

export interface NamedProjectEvidence {
  name: string;
  capacityMw: number | null;
  country: TargetCountry;
  location: string | null;
}

const GENERIC_ARTICLE_RE =
  /\b(?:market (?:share|statistics?|outlook)|renewables? share|record high in (?:the )?nem|industry (?:article|analysis|outlook|statistics?|survey)|anti[- ]dumping|tariffs?|policy (?:change|debate|reform)|chief executive|\bceo\b|technology (?:story|overview)|corporate acquisition)\b/i;
const COMPANY_ACQUISITION_RE =
  /\bacquires?\b[^.]{0,80}\b(?:company|consultancy|business)\b/i;
const MULTI_UNNAMED_RE =
  /\b(?:two|three|four|five|multiple|several)\b[^.]{0,60}\b(?:solar|renewable)\s+(?:projects?|farms?|sites?)\b/i;
const TARGET_AU_RE =
  /\b(?:Australia|Australian|NSW|New South Wales|Victoria|Victorian|Queensland|QLD|South Australia|Western Australia|Tasmania|Northern Territory|ACT)\b/i;
const TARGET_NZ_RE =
  /\b(?:New Zealand|Aotearoa|Auckland|Wellington|Canterbury|Otago|Waikato|Bay of Plenty|Manawat[uū]|Hawke['’]s Bay|Marlborough|Northland|Southland|Taranaki|Gisborne|Nelson|Tasman|West Coast)\b/i;
const OUTSIDE_TARGET_RE =
  /\b(?:Tibet|Tibetan|China|Chinese|India|Indian|United States|USA|United Kingdom|Europe|European|Germany|Spain|Italy|France|Japan|Brazil|Chile|South Africa|Indonesia|Vietnam)\b/i;

export function isCompletedOrOperational(text: string): boolean {
  const lower = text.toLowerCase();
  return EXCLUDE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export function isGenericNonProjectArticle(
  title: string,
  text: string,
): boolean {
  const opening = `${title} ${text.slice(0, 1_200)}`;
  return (
    GENERIC_ARTICLE_RE.test(opening) || COMPANY_ACQUISITION_RE.test(opening)
  );
}

export function resolveTargetCountry(
  text: string,
  fallback: TargetCountry,
  requireEvidence = false,
): TargetCountry | null {
  const opening = text.slice(0, 2_500);
  const au = TARGET_AU_RE.test(opening);
  const nz = TARGET_NZ_RE.test(opening);
  const outside = OUTSIDE_TARGET_RE.test(opening);
  if (outside && !au && !nz) return null;
  if (au && !nz) return "AU";
  if (nz && !au) return "NZ";
  if (requireEvidence) return null;
  return fallback;
}

function capacityNearName(
  text: string,
  name: string,
  onlyName: boolean,
): number | null {
  const index = text.toLowerCase().indexOf(name.toLowerCase());
  if (index >= 0) {
    const local = text.slice(
      Math.max(0, index - 120),
      Math.min(text.length, index + name.length + 420),
    );
    const localNameIndex = local.toLowerCase().indexOf(name.toLowerCase());
    const mentions = findCapacityMentions(local).filter(
      (mention) => mention.score > -5,
    );
    if (mentions.length) {
      mentions.sort(
        (a, b) =>
          Math.abs(a.index - localNameIndex) -
            Math.abs(b.index - localNameIndex) || b.score - a.score,
      );
      return mentions[0].valueMw;
    }
  }
  return onlyName ? extractCapacity(text) : null;
}

function canonicalProjectName(name: string): string {
  return name
    .replace(/\bsolar\b/gi, "Solar")
    .replace(/\brenewable energy\b/gi, "Renewable Energy")
    .replace(/\bbess\b/gi, "BESS")
    .replace(/\bbattery\b/gi, "Battery")
    .replace(
      /\b(farm|park|project|hub|plant|precinct|station|development)\b/gi,
      (word) => word[0].toUpperCase() + word.slice(1).toLowerCase(),
    );
}

/**
 * Resolve named assets from news/article evidence. A publication headline is
 * never accepted as a project identity. Generic industry/corporate stories,
 * explicit foreign geography, completed assets and unresolved plural stories
 * are rejected before project persistence.
 */
export function extractNamedProjectEvidence(input: {
  title: string;
  text: string;
  fallbackCountry: TargetCountry;
  requireCountryEvidence?: boolean;
}): NamedProjectEvidence[] {
  const fullText = `${input.title} ${input.text}`.replace(/\s+/g, " ").trim();
  if (isGenericNonProjectArticle(input.title, input.text)) return [];
  if (isCompletedOrOperational(`${input.title} ${input.text.slice(0, 1_200)}`))
    return [];
  const country = resolveTargetCountry(
    fullText,
    input.fallbackCountry,
    input.requireCountryEvidence,
  );
  if (!country) return [];

  const titleNames = deriveProjectNames(input.title);
  const bodyNames = deriveProjectNames(input.text);
  const names = MULTI_UNNAMED_RE.test(input.title)
    ? bodyNames
    : titleNames.length
      ? titleNames
      : bodyNames;
  if (!names.length) return [];
  if (MULTI_UNNAMED_RE.test(input.title) && names.length < 2) return [];

  return names
    .filter((name) => /^[A-Z]/.test(name))
    .map((rawName) => {
      const name = canonicalProjectName(rawName);
      return {
        name,
        capacityMw: capacityNearName(fullText, name, names.length === 1),
        country,
        location: extractLocation(fullText, country),
      };
    })
    .filter(
      (candidate, index, all) =>
        all.findIndex(
          (other) =>
            normalizeProjectName(other.name) ===
            normalizeProjectName(candidate.name),
        ) === index,
    );
}
