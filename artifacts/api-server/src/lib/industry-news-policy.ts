import { createHash } from "node:crypto";

export type Country = "AU" | "NZ";
export type ContentType = "news" | "linkedin" | "journalist" | "industry";
export type SourceClass = "primary" | "secondary" | "commentary";

export interface SourceDefinition {
  key: string;
  name: string;
  url: string;
  hosts: string[];
  pathPrefixes?: string[];
  countries: Country[];
  geography: string;
  sourceClass: SourceClass;
  coverage: string;
}

export interface CapacityFact {
  value: number;
  unit: "MW" | "MWac" | "MWdc" | "MWp" | "GW" | "MWh" | "GWh";
}

export interface SearchPlan {
  query: string;
  country: Country;
  sourceKeys: string[];
  hint?: ContentType;
}

export interface NewsCandidate {
  title: string;
  summary: string | null;
  sourceName: string;
  sourceUrl: string;
  sourceKey: string;
  sourceClass: SourceClass;
  author: string | null;
  country: Country;
  region: string | null;
  contentType: ContentType;
  publishedDate: string;
  eventDate: string | null;
  category: string;
  secondaryTopics: string[];
  stakeholderGroups: string[];
  lifecycleStage: string | null;
  importance: number;
  developmentStatus: string;
  capacityFacts: CapacityFact[];
  contentHash: string;
}

export interface ScanWindow {
  startAt: Date;
  endAt: Date;
  startDate: string;
  endExclusiveDate: string;
  mode: "custom" | "incremental" | "initial";
}

export const REPORTING_TIMEZONE = "Australia/Sydney";

export const INDUSTRY_NEWS_SOURCES: SourceDefinition[] = [
  {
    key: "aemo",
    name: "AEMO",
    url: "https://www.aemo.com.au/",
    hosts: ["aemo.com.au", "www.aemo.com.au"],
    countries: ["AU"],
    geography: "Australia NEM",
    sourceClass: "primary",
    coverage: "Grid connections and market operations",
  },
  {
    key: "cer",
    name: "Clean Energy Regulator",
    url: "https://cer.gov.au/",
    hosts: ["cer.gov.au", "www.cleanenergyregulator.gov.au"],
    countries: ["AU"],
    geography: "Australia",
    sourceClass: "primary",
    coverage: "Large-scale investment and certificates",
  },
  {
    key: "arena",
    name: "ARENA",
    url: "https://arena.gov.au/",
    hosts: ["arena.gov.au", "www.arena.gov.au"],
    countries: ["AU"],
    geography: "Australia",
    sourceClass: "primary",
    coverage: "Funding and technology demonstrations",
  },
  {
    key: "epbc",
    name: "EPBC Public Portal",
    url: "https://epbcpublicportal.environment.gov.au/all-referrals/",
    hosts: ["epbcpublicportal.environment.gov.au"],
    countries: ["AU"],
    geography: "Australia",
    sourceClass: "primary",
    coverage: "Federal environmental referrals",
  },
  {
    key: "nsw-planning",
    name: "NSW Planning Portal",
    url: "https://www.planningportal.nsw.gov.au/major-projects",
    hosts: ["planningportal.nsw.gov.au", "www.planningportal.nsw.gov.au"],
    countries: ["AU"],
    geography: "NSW",
    sourceClass: "primary",
    coverage: "State-significant development",
  },
  {
    key: "victoria",
    name: "Victorian Government",
    url: "https://www.vic.gov.au/",
    hosts: [
      "vic.gov.au",
      "www.vic.gov.au",
      "planning.vic.gov.au",
      "www.planning.vic.gov.au",
    ],
    countries: ["AU"],
    geography: "VIC",
    sourceClass: "primary",
    coverage: "Planning and project milestones",
  },
  {
    key: "queensland",
    name: "Queensland State Development",
    url: "https://www.statedevelopment.qld.gov.au/",
    hosts: ["statedevelopment.qld.gov.au", "www.statedevelopment.qld.gov.au"],
    countries: ["AU"],
    geography: "QLD",
    sourceClass: "primary",
    coverage: "Planning, grid and project milestones",
  },
  {
    key: "sa-energy",
    name: "SA Department for Energy and Mining",
    url: "https://energymining.sa.gov.au/",
    hosts: ["energymining.sa.gov.au"],
    countries: ["AU"],
    geography: "SA",
    sourceClass: "primary",
    coverage: "Energy tenders and release areas",
  },
  {
    key: "wa-government",
    name: "WA Government",
    url: "https://www.wa.gov.au/",
    hosts: ["wa.gov.au", "www.wa.gov.au"],
    countries: ["AU"],
    geography: "WA",
    sourceClass: "primary",
    coverage: "Planning, transmission and project milestones",
  },
  {
    key: "wa-epa",
    name: "EPA Western Australia",
    url: "https://www.epa.wa.gov.au/",
    hosts: ["epa.wa.gov.au", "www.epa.wa.gov.au"],
    countries: ["AU"],
    geography: "WA",
    sourceClass: "primary",
    coverage: "Environmental referrals",
  },
  {
    key: "northam",
    name: "Shire of Northam",
    url: "https://www.northam.wa.gov.au/publicnotices/",
    hosts: ["northam.wa.gov.au", "www.northam.wa.gov.au"],
    countries: ["AU"],
    geography: "WA",
    sourceClass: "primary",
    coverage: "Local development applications and public notices",
  },
  {
    key: "coorow",
    name: "Shire of Coorow",
    url: "https://www.coorow.wa.gov.au/publicnotices/",
    hosts: ["coorow.wa.gov.au", "www.coorow.wa.gov.au"],
    countries: ["AU"],
    geography: "WA",
    sourceClass: "primary",
    coverage: "Local development applications and public notices",
  },
  {
    key: "nt-planning",
    name: "NT Development Applications",
    url: "https://www.ntlis.nt.gov.au/planning",
    hosts: ["ntlis.nt.gov.au", "www.ntlis.nt.gov.au"],
    countries: ["AU"],
    geography: "NT",
    sourceClass: "primary",
    coverage: "Territory development applications",
  },
  {
    key: "tas-epa",
    name: "Tasmania EPA",
    url: "https://epa.tas.gov.au/business-industry/assessment/proposals-assessed-by-the-epa",
    hosts: ["epa.tas.gov.au", "www.epa.tas.gov.au"],
    countries: ["AU"],
    geography: "TAS",
    sourceClass: "primary",
    coverage: "Environmental assessment proposals",
  },
  {
    key: "ea-nz",
    name: "Electricity Authority Te Mana Hiko",
    url: "https://www.ea.govt.nz/",
    hosts: ["ea.govt.nz", "www.ea.govt.nz"],
    countries: ["NZ"],
    geography: "New Zealand",
    sourceClass: "primary",
    coverage: "Market rules and investment pipeline",
  },
  {
    key: "transpower",
    name: "Transpower",
    url: "https://www.transpower.co.nz/",
    hosts: ["transpower.co.nz", "www.transpower.co.nz"],
    countries: ["NZ"],
    geography: "New Zealand",
    sourceClass: "primary",
    coverage: "Grid connections and transmission",
  },
  {
    key: "fasttrack-nz",
    name: "Fast-track New Zealand",
    url: "https://www.fasttrack.govt.nz/",
    hosts: ["fasttrack.govt.nz", "www.fasttrack.govt.nz"],
    countries: ["NZ"],
    geography: "New Zealand",
    sourceClass: "primary",
    coverage: "Consenting decisions",
  },
  {
    key: "nzx",
    name: "NZX Announcements",
    url: "https://announcements.nzx.com/",
    hosts: ["announcements.nzx.com"],
    countries: ["NZ"],
    geography: "New Zealand",
    sourceClass: "primary",
    coverage: "Corporate disclosures and finance",
  },
  {
    key: "contact",
    name: "Contact Energy",
    url: "https://contact.co.nz/",
    hosts: ["contact.co.nz", "www.contact.co.nz"],
    countries: ["NZ"],
    geography: "New Zealand",
    sourceClass: "primary",
    coverage: "Company and project announcements",
  },
  {
    key: "genesis",
    name: "Genesis Energy",
    url: "https://www.genesisenergy.co.nz/",
    hosts: ["genesisenergy.co.nz", "www.genesisenergy.co.nz"],
    countries: ["NZ"],
    geography: "New Zealand",
    sourceClass: "primary",
    coverage: "Company and project announcements",
  },
  {
    key: "pv-mag-au",
    name: "PV Magazine Australia",
    url: "https://www.pv-magazine-australia.com/",
    hosts: ["pv-magazine-australia.com", "www.pv-magazine-australia.com"],
    countries: ["AU", "NZ"],
    geography: "Australia and New Zealand",
    sourceClass: "secondary",
    coverage: "Solar, storage, finance and EPC",
  },
  {
    key: "reneweconomy",
    name: "RenewEconomy",
    url: "https://reneweconomy.com.au/",
    hosts: ["reneweconomy.com.au", "www.reneweconomy.com.au"],
    countries: ["AU", "NZ"],
    geography: "Australia and New Zealand",
    sourceClass: "secondary",
    coverage: "Policy, grids and projects",
  },
  {
    key: "energy-storage-news",
    name: "Energy-Storage.news",
    url: "https://www.energy-storage.news/",
    hosts: ["energy-storage.news", "www.energy-storage.news"],
    countries: ["AU", "NZ"],
    geography: "Australia and New Zealand",
    sourceClass: "secondary",
    coverage: "Storage and hybrid projects",
  },
  {
    key: "pv-tech",
    name: "PV Tech",
    url: "https://www.pv-tech.org/",
    hosts: ["pv-tech.org", "www.pv-tech.org"],
    countries: ["AU", "NZ"],
    geography: "Australia and New Zealand",
    sourceClass: "secondary",
    coverage: "Utility solar technology and projects",
  },
  {
    key: "abc",
    name: "ABC News",
    url: "https://www.abc.net.au/news/",
    hosts: ["abc.net.au", "www.abc.net.au"],
    countries: ["AU"],
    geography: "Australia",
    sourceClass: "secondary",
    coverage: "Regional and national reporting",
  },
  {
    key: "renewmap",
    name: "RenewMap",
    url: "https://renewmap.com.au/",
    hosts: ["renewmap.com.au", "www.renewmap.com.au"],
    countries: ["AU", "NZ"],
    geography: "Australia and New Zealand",
    sourceClass: "secondary",
    coverage: "Project status and discovery signals",
  },
  {
    key: "linkedin",
    name: "LinkedIn",
    url: "https://www.linkedin.com/",
    hosts: ["linkedin.com", "www.linkedin.com"],
    countries: ["AU", "NZ"],
    geography: "Australia and New Zealand",
    sourceClass: "commentary",
    coverage: "Public company and professional commentary",
  },
  {
    key: "planted",
    name: "Planted Solar",
    url: "https://www.plantedsolar.com/",
    hosts: ["plantedsolar.com", "www.plantedsolar.com", "jobs.ashbyhq.com"],
    pathPrefixes: [
      "https://plantedsolar.com/",
      "https://www.plantedsolar.com/",
      "https://jobs.ashbyhq.com/plantedsolar/",
    ],
    countries: ["AU"],
    geography: "Australia / international",
    sourceClass: "primary",
    coverage: "Australian supplier market-entry evidence",
  },
];

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "from",
  "in",
  "into",
  "new",
  "of",
  "on",
  "the",
  "to",
  "with",
  "says",
  "announces",
  "australia",
  "australian",
  "zealand",
]);
const SOLAR_RE = /\b(?:solar|photovoltaic|pv)\b/i;
const ADJACENT_RE =
  /\b(?:bess|battery|storage|grid|transmission|curtailment|electricity|renewable|ppa|power purchase|inverter|module|tracker|finance|acquisition|planning|approval|consent|referral|tender)\b/i;
const UTILITY_RE =
  /\b(?:utility[ -]?scale|large[ -]?scale|solar farm|solar park|grid[ -]?connected|mw(?:ac|dc|p)?|gw|mwh|gwh|nem|developer|epc|project|transmission|market operator)\b/i;
const RESIDENTIAL_RE =
  /\b(?:residential|household|home solar|rooftop installer)\b/i;
const AU_RE =
  /\b(?:Australia|Australian|NSW|New South Wales|Victoria|Queensland|South Australia|Western Australia|Tasmania|Northern Territory|ACT|NEM|AEMO)\b/i;
const NZ_RE =
  /\b(?:New Zealand|Aotearoa|North Island|South Island|Auckland|Waikato|Canterbury|Transpower|NZX)\b/i;

function datePartsInSydney(date: Date): Record<string, number> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", {
      timeZone: REPORTING_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

export function sydneyMidnightUtc(dateText: string): Date {
  const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid scan date: ${dateText}`);
  const target = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  let guess = new Date(target);
  for (let i = 0; i < 3; i++) {
    const parts = datePartsInSydney(guess);
    const rendered = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    guess = new Date(guess.valueOf() + target - rendered);
  }
  return guess;
}

export function dateInSydney(date: Date): string {
  const parts = datePartsInSydney(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function addCalendarDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function resolveIndustryNewsWindow(options: {
  startDate?: string;
  endDate?: string;
  previousEnd?: Date | null;
  now?: Date;
}): ScanWindow {
  const now = options.now ?? new Date();
  if (options.startDate || options.endDate) {
    const startDate =
      options.startDate ?? addCalendarDays(options.endDate!, -7);
    const endExclusiveDate = addCalendarDays(
      options.endDate ?? dateInSydney(now),
      1,
    );
    const startAt = sydneyMidnightUtc(startDate);
    const endAt = sydneyMidnightUtc(endExclusiveDate);
    if (startAt >= endAt)
      throw new Error(
        "Industry News start date must be on or before the end date",
      );
    return { startAt, endAt, startDate, endExclusiveDate, mode: "custom" };
  }
  const startAt =
    options.previousEnd && options.previousEnd < now
      ? options.previousEnd
      : new Date(now.valueOf() - 7 * 24 * 60 * 60 * 1_000);
  return {
    startAt,
    endAt: now,
    startDate: dateInSydney(startAt),
    endExclusiveDate: addCalendarDays(dateInSydney(now), 1),
    mode: options.previousEnd ? "incremental" : "initial",
  };
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    result.push(items.slice(i, i + size));
  return result;
}

export function buildSearchPlans(window: ScanWindow): SearchPlan[] {
  const plans: SearchPlan[] = [];
  for (const country of ["AU", "NZ"] as const) {
    const sources = INDUSTRY_NEWS_SOURCES.filter((source) =>
      source.countries.includes(country),
    );
    for (const group of chunks(sources, 4)) {
      const sites = group
        .flatMap((source) => source.hosts.slice(0, 1))
        .map((host) => `site:${host}`)
        .join(" OR ");
      const place =
        country === "AU" ? "Australia solar" : '"New Zealand" solar';
      plans.push({
        country,
        sourceKeys: group.map((source) => source.key),
        hint: group.every((source) => source.sourceClass === "commentary")
          ? "linkedin"
          : undefined,
        query: `(${sites}) ${place} (project OR grid OR policy OR market OR finance OR EPC OR storage) after:${window.startDate} before:${window.endExclusiveDate}`,
      });
    }
  }
  return plans;
}

export function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()])
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return null;
  }
}

export function sourceForUrl(value: string): SourceDefinition | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    return (
      INDUSTRY_NEWS_SOURCES.find((source) => {
        if (!source.hosts.includes(host)) return false;
        return (
          !source.pathPrefixes ||
          source.pathPrefixes.some((prefix) => parsed.href.startsWith(prefix))
        );
      }) ?? null
    );
  } catch {
    return null;
  }
}

export function parsePublicationDate(
  value: unknown,
  now = new Date(),
): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const relative = raw.match(
    /^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i,
  );
  if (relative) {
    const date = new Date(now);
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    if (unit === "minute") date.setMinutes(date.getMinutes() - amount);
    if (unit === "hour") date.setHours(date.getHours() - amount);
    if (unit === "day") date.setDate(date.getDate() - amount);
    if (unit === "week") date.setDate(date.getDate() - amount * 7);
    if (unit === "month") date.setMonth(date.getMonth() - amount);
    if (unit === "year") date.setFullYear(date.getFullYear() - amount);
    return date;
  }
  const date = new Date(raw);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export function extractCapacityFacts(text: string): CapacityFact[] {
  const facts: CapacityFact[] = [];
  const seen = new Set<string>();
  const pattern =
    /\b(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(GW|MWac|MWdc|MWp|MW|GWh|MWh)\b/gi;
  for (const match of text.matchAll(pattern)) {
    const rawUnit = match[2];
    const unit =
      rawUnit.toLowerCase() === "gw"
        ? "GW"
        : rawUnit.toLowerCase() === "gwh"
          ? "GWh"
          : rawUnit.toLowerCase() === "mwh"
            ? "MWh"
            : rawUnit.toLowerCase() === "mwac"
              ? "MWac"
              : rawUnit.toLowerCase() === "mwdc"
                ? "MWdc"
                : rawUnit.toLowerCase() === "mwp"
                  ? "MWp"
                  : "MW";
    const value = Number(match[1].replace(/,/g, ""));
    const key = `${value}:${unit}`;
    if (Number.isFinite(value) && !seen.has(key)) {
      seen.add(key);
      facts.push({ value, unit });
    }
  }
  return facts;
}

function regionFor(text: string, country: Country): string | null {
  if (country === "NZ") {
    if (/\bNorth Island\b/i.test(text)) return "North Island";
    if (/\bSouth Island\b/i.test(text)) return "South Island";
    return null;
  }
  const regions: Array<[RegExp, string]> = [
    [/\b(?:NSW|New South Wales)\b/i, "NSW"],
    [/\b(?:VIC|Victoria)\b/i, "VIC"],
    [/\b(?:QLD|Queensland)\b/i, "QLD"],
    [/\b(?:SA|South Australia)\b/i, "SA"],
    [/\b(?:WA|Western Australia)\b/i, "WA"],
    [/\b(?:TAS|Tasmania)\b/i, "TAS"],
    [/\b(?:NT|Northern Territory)\b/i, "NT"],
    [/\bACT\b|Australian Capital Territory/i, "ACT"],
  ];
  return regions.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function categoryFor(text: string): string {
  if (/\b(?:grid|transmission|connection|curtailment)\b/i.test(text))
    return "Grid Connections, Transmission and Curtailment";
  if (
    /\b(?:finance|investment|acquisition|merger|\bM&A\b|PPA|power purchase)\b/i.test(
      text,
    )
  )
    return "Finance, Investment, M&A and PPAs";
  if (
    /\b(?:policy|regulation|government|tender|scheme|legislation)\b/i.test(text)
  )
    return "Government Policy and Regulation";
  if (
    /\b(?:module|inverter|tracker|robot|technology|supply chain|equipment)\b/i.test(
      text,
    )
  )
    return "Solar Technology, Equipment and Supply Chains";
  if (/\b(?:BESS|battery|storage|hybrid)\b/i.test(text))
    return "BESS and Hybrid Solar Developments";
  if (/\b(?:EPC|contractor|developer|owner|operator)\b/i.test(text))
    return "Developers, Owners and EPC Contractors";
  if (/\b(?:market|price|economics|forecast|research)\b/i.test(text))
    return "Electricity Markets and Industry Economics";
  return "Solar Projects and Development";
}

function lifecycleFor(text: string): string | null {
  const stages: Array<[RegExp, string]> = [
    [/\b(?:operational|commissioned|opened|energised)\b/i, "operational"],
    [
      /\b(?:under construction|construction (?:starts|begins|commences)|notice to proceed)\b/i,
      "construction",
    ],
    [/\b(?:financial close|final investment decision|\bFID\b)\b/i, "financed"],
    [/\b(?:approved|approval granted|consent granted)\b/i, "approved"],
    [
      /\b(?:application|referral|public consultation|proposed|proposal|seeking approval)\b/i,
      "proposed",
    ],
  ];
  return stages.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function topicsFor(text: string): string[] {
  const topics: Array<[RegExp, string]> = [
    [/\bsolar\b|photovoltaic|\bPV\b/i, "solar"],
    [/\bBESS\b|battery|storage/i, "storage"],
    [/grid|transmission|connection|curtailment/i, "grid"],
    [/finance|investment|acquisition|PPA/i, "finance"],
    [
      /policy|regulation|planning|approval|consent|referral/i,
      "policy-and-planning",
    ],
    [
      /module|inverter|tracker|robot|equipment|supply chain/i,
      "technology-and-supply-chain",
    ],
  ];
  return topics
    .filter(([pattern]) => pattern.test(text))
    .map(([, topic]) => topic);
}

function stakeholdersFor(text: string): string[] {
  const groups: Array<[RegExp, string]> = [
    [/developer|proponent|owner/i, "developers-and-owners"],
    [/\bEPC\b|contractor|construction/i, "EPCs-and-contractors"],
    [/investor|finance|fund|acquisition/i, "investors-and-financiers"],
    [/module|inverter|tracker|supplier|equipment/i, "technology-suppliers"],
    [/grid|transmission|AEMO|Transpower/i, "network-and-market-operators"],
    [/government|regulator|planning|minister/i, "government-and-regulators"],
  ];
  return groups
    .filter(([pattern]) => pattern.test(text))
    .map(([, group]) => group);
}

function importanceFor(text: string, capacityFacts: CapacityFact[]): number {
  const mw = capacityFacts
    .filter((fact) => !fact.unit.endsWith("Wh"))
    .reduce(
      (max, fact) =>
        Math.max(max, fact.unit === "GW" ? fact.value * 1000 : fact.value),
      0,
    );
  if (
    mw >= 1000 ||
    /market-wide|record|national|legislation|capacity investment scheme/i.test(
      text,
    )
  )
    return 5;
  if (
    mw >= 250 ||
    /financial close|final investment decision|major acquisition|transmission/i.test(
      text,
    )
  )
    return 4;
  if (mw >= 50 || /approved|construction|PPA|grid connection/i.test(text))
    return 3;
  return 2;
}

function contentTypeFor(
  source: SourceDefinition,
  author: string | null,
): ContentType {
  if (source.key === "linkedin") return "linkedin";
  if (source.sourceClass === "primary" || source.sourceClass === "secondary")
    return "industry";
  return author ? "journalist" : "news";
}

function cleanSummary(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/[#*_`<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > 700 ? `${text.slice(0, 697).trimEnd()}...` : text;
}

export function candidateFromSearchRow(
  row: Record<string, unknown>,
  plan: SearchPlan,
  window: ScanWindow,
  now = new Date(),
): NewsCandidate | null {
  const metadata =
    row.metadata &&
    typeof row.metadata === "object" &&
    !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const rawUrl = [row.url, row.link, row.sourceURL].find(
    (value) => typeof value === "string",
  ) as string | undefined;
  const sourceUrl = rawUrl ? canonicalUrl(rawUrl) : null;
  const source = sourceUrl ? sourceForUrl(sourceUrl) : null;
  const title =
    typeof row.title === "string" ? row.title.replace(/\s+/g, " ").trim() : "";
  if (!sourceUrl || !source || !plan.sourceKeys.includes(source.key) || !title)
    return null;
  const summary = cleanSummary(
    row.description ?? row.snippet ?? row.markdown ?? metadata.description,
  );
  const text = `${title} ${summary ?? ""}`;
  if (
    (!SOLAR_RE.test(text) &&
      !(
        ADJACENT_RE.test(text) &&
        /\b(?:renewable|grid|electricity|solar)\b/i.test(text)
      )) ||
    !UTILITY_RE.test(text)
  )
    return null;
  if (
    RESIDENTIAL_RE.test(text) &&
    !/utility[ -]?scale|large[ -]?scale|solar farm|solar park|\bMW/i.test(text)
  )
    return null;
  if (
    plan.country === "AU" &&
    !AU_RE.test(text) &&
    !source.countries.every((country) => country === "AU")
  )
    return null;
  if (
    plan.country === "NZ" &&
    !NZ_RE.test(text) &&
    !source.countries.every((country) => country === "NZ")
  )
    return null;
  const rawDate = [
    row.publishedDate,
    row.published_date,
    row.date,
    row.datePublished,
    row.publishedAt,
    metadata.publishedDate,
    metadata.publishedTime,
    metadata.date,
    metadata.datePublished,
  ].find((value) => typeof value === "string" && value.trim());
  const publishedAt = parsePublicationDate(rawDate, now);
  if (!publishedAt) return null;
  const publishedDate = dateInSydney(publishedAt);
  if (
    publishedDate < window.startDate ||
    publishedDate >= window.endExclusiveDate ||
    publishedAt >= window.endAt
  )
    return null;
  const authorValue = [row.author, row.byline, metadata.author].find(
    (value) => typeof value === "string" && value.trim(),
  );
  const author =
    typeof authorValue === "string" ? authorValue.trim().slice(0, 160) : null;
  const rawEventDate = [row.eventDate, row.event_date, metadata.eventDate].find(
    (value) => typeof value === "string" && value.trim(),
  );
  const eventAt = parsePublicationDate(rawEventDate, now);
  const capacityFacts = extractCapacityFacts(text);
  const lifecycleStage = lifecycleFor(text);
  return {
    title: title.slice(0, 500),
    summary,
    sourceName: source.name,
    sourceUrl,
    sourceKey: source.key,
    sourceClass: source.sourceClass,
    author,
    country: plan.country,
    region: regionFor(text, plan.country),
    contentType: contentTypeFor(source, author),
    publishedDate,
    eventDate: eventAt ? dateInSydney(eventAt) : null,
    category: categoryFor(text),
    secondaryTopics: topicsFor(text),
    stakeholderGroups: stakeholdersFor(text),
    lifecycleStage,
    importance: importanceFor(text, capacityFacts),
    developmentStatus: lifecycleStage ?? "reported",
    capacityFacts,
    contentHash: createHash("sha256")
      .update(`${title}\n${summary ?? ""}`)
      .digest("hex"),
  };
}

function significantTokens(title: string): string[] {
  return [
    ...new Set(
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
    ),
  ];
}

export function headlineSimilarity(left: string, right: string): number {
  const a = new Set(significantTokens(left));
  const b = new Set(significantTokens(right));
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((token) => b.has(token)).length;
  return overlap / Math.min(a.size, b.size);
}

function sameEvent(left: NewsCandidate, right: NewsCandidate): boolean {
  if (
    left.country !== right.country ||
    (left.region && right.region && left.region !== right.region)
  )
    return false;
  const days =
    Math.abs(
      new Date(`${left.publishedDate}T00:00:00Z`).valueOf() -
        new Date(`${right.publishedDate}T00:00:00Z`).valueOf(),
    ) / 86_400_000;
  if (days > 31) return false;
  return headlineSimilarity(left.title, right.title) >= 0.58;
}

export function groupEventCandidates(
  items: NewsCandidate[],
): NewsCandidate[][] {
  const groups: NewsCandidate[][] = [];
  for (const item of items) {
    const group = groups.find((candidateGroup) =>
      candidateGroup.some((candidate) => sameEvent(candidate, item)),
    );
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups;
}

export function chooseCanonical(group: NewsCandidate[]): NewsCandidate {
  return [...group].sort((a, b) => {
    const rank = (sourceClass: SourceClass) =>
      sourceClass === "primary" ? 3 : sourceClass === "secondary" ? 2 : 1;
    return (
      rank(b.sourceClass) - rank(a.sourceClass) ||
      (b.summary?.length ?? 0) - (a.summary?.length ?? 0) ||
      b.publishedDate.localeCompare(a.publishedDate)
    );
  })[0];
}

export function evidenceStatusFor(
  group: NewsCandidate[],
):
  | "independently_corroborated"
  | "primary_unconfirmed"
  | "credible_unverified"
  | "commentary" {
  const hosts = new Set(group.map((item) => new URL(item.sourceUrl).hostname));
  if (
    hosts.size > 1 &&
    (group.some((item) => item.sourceClass === "primary") ||
      group.filter((item) => item.sourceClass !== "commentary").length > 1)
  )
    return "independently_corroborated";
  if (group.some((item) => item.sourceClass === "primary"))
    return "primary_unconfirmed";
  if (group.every((item) => item.sourceClass === "commentary"))
    return "commentary";
  return "credible_unverified";
}

export function canonicalEventKey(candidate: NewsCandidate): string {
  const capacity = candidate.capacityFacts[0]
    ? `${candidate.capacityFacts[0].value}${candidate.capacityFacts[0].unit}`
    : "";
  const tokens = significantTokens(candidate.title)
    .sort()
    .slice(0, 12)
    .join("-");
  return createHash("sha256")
    .update(
      [
        candidate.country,
        candidate.region ?? "",
        candidate.lifecycleStage ?? "",
        capacity,
        tokens,
      ].join("|"),
    )
    .digest("hex");
}

export function isLikelyPriorEvent(
  candidate: NewsCandidate,
  prior:
    | {
        title: string;
        country: string;
        region: string | null;
        publishedDate: string;
      }
    | null
    | undefined,
): boolean {
  if (
    !prior ||
    prior.country !== candidate.country ||
    (prior.region && candidate.region && prior.region !== candidate.region)
  )
    return false;
  const days =
    Math.abs(
      new Date(`${prior.publishedDate}T00:00:00Z`).valueOf() -
        new Date(`${candidate.publishedDate}T00:00:00Z`).valueOf(),
    ) / 86_400_000;
  return days <= 45 && headlineSimilarity(candidate.title, prior.title) >= 0.62;
}
