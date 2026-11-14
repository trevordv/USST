export const WATTS_NEWS_UPDATE_EVIDENCE = "altenergy_watts_news_update" as const;

const PROJECT_CATEGORIES = new Set([
  "NEW PROJECT",
  "PROJECT UPDATE",
  "PROJECT MILESTONE",
  "OPPORTUNITY",
]);

const GENERIC_NEWS_TERMS = /\b(policy|market report|weekly wrap|industry news|webinar|conference|jobs?|prices?|government announces|renewable energy target)\b/i;
const PROJECT_SHAPE = /\b(solar(?: farm| park| project)?|photovoltaic|pv|renewable energy (?:project|precinct)|energy precinct)\b/i;
const CLOSED_LIFECYCLE = /\b(generating|operational|commercially operational|commissioned|cancelled|canceled|withdrawn)\b/i;

export interface WattsNewsSection {
  title: string;
  category: string | null;
  text: string;
  sourceUrl: string;
}

export interface WattsNewsProjectEvidence {
  name: string;
  description: string;
  developer: string | null;
  location: string | null;
  country: "AU" | "NZ";
  status: "announced" | "under_development";
  solarCapacityMw: number | null;
  bessPowerMw: number | null;
  bessEnergyMwh: number | null;
  technologyResolved: boolean;
  activeLifecycle: boolean;
  sourceUrl: string;
  newsletterDate: string;
  category: string | null;
}

export interface CanonicalProjectCandidate {
  id: number;
  name: string;
  description?: string | null;
  capacityMw?: number | string | null;
  developer?: string | null;
  location?: string | null;
  country?: string | null;
  sourceUrl?: string | null;
  sourceName?: string | null;
  status?: string | null;
}

export interface CanonicalMatch {
  project: CanonicalProjectCandidate;
  reason: "exact-name" | "normalized-alias-with-corroboration";
  score: number;
}

export interface CanonicalFieldUpdatePlan {
  updates: {
    capacityMw?: string;
    developer?: string;
    location?: string;
    description?: string;
    status?: "announced" | "under_development";
  };
  decisions: Record<string, string>;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function normalizeCategory(value: string): string | null {
  const normalized = value.replace(/\s*[:|–—-].*$/, "").trim().toUpperCase();
  return PROJECT_CATEGORIES.has(normalized) ? normalized : null;
}

function projectTitleFromHeading(heading: string): string | null {
  const labelled = heading.match(/^(?:NEW PROJECT|PROJECT UPDATE|PROJECT MILESTONE|OPPORTUNITY)\s*[:|–—-]\s*(.+)$/i)?.[1];
  let title = labelled?.trim() ?? heading.trim();
  if (title.includes("|")) {
    const parts = title.split("|").map((part) => part.trim()).filter(Boolean);
    const shaped = [...parts].reverse().find((part) => PROJECT_SHAPE.test(part));
    if (shaped) title = shaped;
  }
  title = title.replace(/^(?:new opportunities? now open|opportunity)\s*[:|–—-]\s*/i, "").trim();
  if (!PROJECT_SHAPE.test(title)) return null;
  if (GENERIC_NEWS_TERMS.test(title)) return null;
  return title;
}

function anchorFor(attrs: string, inner: string, title: string): string {
  const href = inner.match(/href=["']([^"']+)["']/i)?.[1];
  if (href?.startsWith("#")) return href.slice(1);
  const id = attrs.match(/\bid=["']([^"']+)["']/i)?.[1];
  if (id) return id;
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}

/**
 * Extract bounded project-article sections from newsletter headings. Category
 * labels are context only; a section still needs a project-shaped heading, so
 * generic policy/news articles are not promoted merely for mentioning solar.
 */
export function parseWattNewsSections(html: string, newsletterUrl: string): WattsNewsSection[] {
  const sanitized = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const headings = [...sanitized.matchAll(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    attrs: match[2],
    inner: match[3],
    text: cleanHtml(match[3]),
  }));

  const sections: WattsNewsSection[] = [];
  let category: string | null = null;
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index];
    const headingCategory = normalizeCategory(heading.text);
    if (headingCategory && projectTitleFromHeading(heading.text) == null) {
      category = headingCategory;
      continue;
    }
    const title = projectTitleFromHeading(heading.text);
    if (!title) continue;
    const inlineCategory = normalizeCategory(heading.text);
    const end = headings[index + 1]?.start ?? sanitized.length;
    const body = cleanHtml(sanitized.slice(heading.end, end)).slice(0, 5000);
    const fullText = `${title} ${body}`.trim();
    if (GENERIC_NEWS_TERMS.test(title) || (!/\b(solar|photovoltaic|pv)\b/i.test(fullText) && !/renewable energy (?:project|precinct)/i.test(title))) {
      continue;
    }
    const anchor = anchorFor(heading.attrs, heading.inner, title);
    sections.push({
      title,
      category: inlineCategory ?? category,
      text: fullText,
      sourceUrl: `${newsletterUrl}#${encodeURIComponent(anchor)}`,
    });
  }
  return sections;
}

function toMw(value: string, unit: string): number {
  const number = Number.parseFloat(value);
  return unit.toLowerCase().startsWith("g") ? number * 1000 : number;
}

function firstCapacity(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    pattern.lastIndex = 0;
    if (match) return toMw(match[1], match[2]);
  }
  return null;
}

export function extractWattsNewsCapacities(text: string): {
  solarCapacityMw: number | null;
  bessPowerMw: number | null;
  bessEnergyMwh: number | null;
} {
  const solarCapacityMw = firstCapacity(text, [
    /(\d+(?:\.\d+)?)\s*(MW|GW)\s*(?:AC\s*)?(?:of\s+)?(?:solar|solar\s+PV|photovoltaic|PV)\b/i,
    /\b(?:solar|solar\s+PV|photovoltaic|PV)\b(?:\s+(?:generation|component|capacity|farm|project|stage))*\s*(?:of|is|at|:|-)?\s*(\d+(?:\.\d+)?)\s*(MW|GW)\b/i,
  ]);
  const bessPair = text.match(/(\d+(?:\.\d+)?)\s*MW\s*\/\s*(\d+(?:\.\d+)?)\s*MWh\s*(?:BESS|battery)?/i);
  const bessPowerOnly = text.match(/(\d+(?:\.\d+)?)\s*MW\s*(?:BESS|battery(?:\s+storage)?)/i);
  const bessEnergyOnly = text.match(/(\d+(?:\.\d+)?)\s*MWh\s*(?:BESS|battery(?:\s+storage)?)/i);
  return {
    solarCapacityMw,
    bessPowerMw: bessPair ? Number.parseFloat(bessPair[1]) : bessPowerOnly ? Number.parseFloat(bessPowerOnly[1]) : null,
    bessEnergyMwh: bessPair ? Number.parseFloat(bessPair[2]) : bessEnergyOnly ? Number.parseFloat(bessEnergyOnly[1]) : null,
  };
}

function extractDeveloper(text: string): string | null {
  const patterns = [
    /\b(?:developer|developed by|proponent|owner)\s*(?:is|:|-|by)?\s*([A-Z][A-Za-z0-9&.' -]{2,70}?)(?=[,.;]|\s+(?:is|has|will|plans|proposes)\b)/i,
    /\bby\s+([A-Z][A-Za-z0-9&.' -]{2,60}?(?:Energy|Renewables|Power|Solar|Group|Pty Ltd))\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

function extractLocation(text: string): string | null {
  const near = text.match(/\bnear\s+([A-Z][A-Za-z .'-]{2,40})(?=[,.;]|\s+in\s+|\s+(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b)/i)?.[1];
  const state = text.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT|New Zealand)\b/i)?.[1];
  return [near?.trim(), state?.toUpperCase()].filter(Boolean).join(", ") || null;
}

export function extractWattNewsProject(section: WattsNewsSection, newsletterDate: string): WattsNewsProjectEvidence {
  const capacities = extractWattsNewsCapacities(section.text);
  const activeLifecycle = !CLOSED_LIFECYCLE.test(section.text);
  const underDevelopment = /\b(planning|assessment|approved|development|construction|progressing|opportunity)\b/i.test(section.text);
  return {
    name: section.title,
    description: section.text.slice(0, 900),
    developer: extractDeveloper(section.text),
    location: extractLocation(section.text),
    country: /\bNew Zealand|\bNZ\b/i.test(section.text) ? "NZ" : "AU",
    status: underDevelopment ? "under_development" : "announced",
    ...capacities,
    technologyResolved: /\b(solar|photovoltaic|solar\s+PV)\b/i.test(section.text),
    activeLifecycle,
    sourceUrl: section.sourceUrl,
    newsletterDate,
    category: section.category,
  };
}

function normalizedIdentity(value: string): string {
  return value.toLowerCase()
    .replace(/\b(?:nsw|vic|qld|sa|wa|tas|nt|act|australia|new zealand)\b/g, " ")
    .replace(/\bstage\s+(?:one|two|three|\d+|[ivx]+)\b/g, " ")
    .replace(/\b(?:solar farm|solar project|renewable energy project|energy precinct|solar and battery storage project)\b/g, " ")
    .replace(/\b(?:the|project)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedExact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stateCode(value?: string | null): string | null {
  return value?.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i)?.[1].toUpperCase() ?? null;
}

function corroborationScore(event: WattsNewsProjectEvidence, candidate: CanonicalProjectCandidate): number {
  let score = 0;
  const eventDeveloper = event.developer?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const candidateDeveloper = candidate.developer?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (eventDeveloper && candidateDeveloper && (eventDeveloper === candidateDeveloper || eventDeveloper.includes(candidateDeveloper) || candidateDeveloper.includes(eventDeveloper))) score += 3;
  const eventState = stateCode(event.location);
  if (eventState && eventState === stateCode(candidate.location)) score += 2;
  const capacity = Number(candidate.capacityMw);
  if (event.solarCapacityMw != null && Number.isFinite(capacity) && Math.abs(capacity - event.solarCapacityMw) <= Math.max(10, event.solarCapacityMw * 0.3)) score += 1;
  return score;
}

/** Strong canonical identity matching; loose substring similarity is never sufficient. */
export function findCanonicalWattsNewsMatch(
  event: WattsNewsProjectEvidence,
  candidates: readonly CanonicalProjectCandidate[],
): CanonicalMatch | null {
  const exact = normalizedExact(event.name);
  const alias = normalizedIdentity(event.name);
  const matches = candidates.flatMap((candidate): CanonicalMatch[] => {
    if (candidate.country && candidate.country !== event.country) return [];
    const corroboration = corroborationScore(event, candidate);
    if (normalizedExact(candidate.name) === exact) {
      return [{ project: candidate, reason: "exact-name", score: 10 + corroboration }];
    }
    if (alias.length >= 4 && normalizedIdentity(candidate.name) === alias && corroboration >= 1) {
      return [{ project: candidate, reason: "normalized-alias-with-corroboration", score: 5 + corroboration }];
    }
    return [];
  });
  return matches.sort((a, b) => b.score - a.score || a.project.id - b.project.id)[0] ?? null;
}

/**
 * Dated, explicit Watts News evidence can improve an AltEnergy/news canonical
 * row. Government, planning, AEMO and EPBC fields are retained as stronger
 * official evidence. Announcement history is intentionally not an updateable
 * field in this plan.
 */
export function planWattsNewsCanonicalUpdates(
  event: WattsNewsProjectEvidence,
  canonical: CanonicalProjectCandidate,
): CanonicalFieldUpdatePlan {
  const strongerOfficialSource = /\b(?:AEMO|EPBC|government|planning|authority)\b|\.gov(?:\.au|t\.nz)?/i.test(
    `${canonical.sourceName ?? ""} ${canonical.sourceUrl ?? ""}`,
  );
  const addsMissingSolarEvidence = /\b(?:solar|photovoltaic|solar\s+PV)\b/i.test(event.description)
    && !/\b(?:solar|photovoltaic|solar\s+PV)\b/i.test(`${canonical.name} ${canonical.description ?? ""}`);
  const updates: CanonicalFieldUpdatePlan["updates"] = {};
  const decisions: Record<string, string> = {};
  if (event.solarCapacityMw != null && !strongerOfficialSource && Number(canonical.capacityMw) !== event.solarCapacityMw) {
    updates.capacityMw = String(event.solarCapacityMw);
    decisions.capacityMw = `updated explicit dated Watts News solar capacity ${canonical.capacityMw} -> ${event.solarCapacityMw}`;
  } else {
    decisions.capacityMw = strongerOfficialSource ? "retained stronger official source" : "retained unchanged or non-explicit value";
  }
  if (event.developer && (!canonical.developer || canonical.developer.toLowerCase() === event.developer.toLowerCase())) {
    updates.developer = event.developer;
    decisions.developer = canonical.developer ? "retained corroborated developer" : "filled explicit dated developer";
  } else {
    decisions.developer = event.developer ? "retained conflicting canonical developer for review" : "retained because event has no explicit developer";
  }
  if (event.location && (!canonical.location || event.location.length > canonical.location.length) && !strongerOfficialSource) {
    updates.location = event.location;
    decisions.location = "improved with more specific dated location";
  } else {
    decisions.location = strongerOfficialSource ? "retained stronger official source" : "retained existing or non-explicit location";
  }
  if (!strongerOfficialSource && (addsMissingSolarEvidence || event.description.length > (canonical.description?.length ?? 0))) {
    updates.description = describeWattsNewsEvidence(event);
    decisions.description = addsMissingSolarEvidence
      ? "updated with explicit missing solar-component evidence"
      : "updated with richer dated source evidence";
  } else {
    decisions.description = strongerOfficialSource ? "retained stronger official source" : "retained existing richer description";
  }
  if (!strongerOfficialSource && canonical.status !== event.status) {
    updates.status = event.status;
    decisions.status = `updated ${canonical.status ?? "unknown"} -> ${event.status}`;
  } else {
    decisions.status = strongerOfficialSource ? "retained stronger official source" : "retained unchanged status";
  }
  return { updates, decisions };
}

export function describeWattsNewsEvidence(evidence: WattsNewsProjectEvidence): string {
  const parts = [evidence.description];
  if (evidence.bessPowerMw != null || evidence.bessEnergyMwh != null) {
    parts.push(`BESS evidence: ${evidence.bessPowerMw ?? "unknown"} MW / ${evidence.bessEnergyMwh ?? "unknown"} MWh.`);
  }
  return parts.join(" ").slice(0, 1200);
}
