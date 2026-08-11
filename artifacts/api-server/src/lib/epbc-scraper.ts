/**
 * EPBC Public Portal scraper.
 *
 * Strategy:
 *   1. Query DCCEEW's official ArcGIS EPBC Referrals feature layer.
 *   2. Fall back to OpenAI web search if the structured source is unavailable.
 *
 * Only records where industry type contains "Energy" are kept.
 */

import { logger } from "./logger.ts";

const PORTAL_BASE = "https://epbcpublicportal.environment.gov.au";
const ARCGIS_LAYER_URL =
  "https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/EPBC_Referrals/MapServer/0";
const ARCGIS_PAGE_SIZE = 1_000;
const ARCGIS_OUT_FIELDS = [
  "REFERENCE_NUMBER",
  "NAME",
  "PRIMARY_JURISDICTION",
  "REFERRAL_DECISION",
  "STATUS_DESCRIPTION",
  "STAGE_NAME",
  "REFERRAL_TYPE",
  "YEAR",
  "CATEGORY",
  "REFERRAL_URL",
  "CRM_ID",
  "OBJECTID",
].join(",");

export interface EpbcRecord {
  epbcNumber: string;
  projectName: string;
  proponent: string | null;
  industryType: string | null;
  projectStatus: string | null;
  decisionStatus: string | null;
  state: string | null;
  location: string | null;
  technologyType: string | null;
  sizeMw: number | null;
  referralDate: string | null;
  approvalDate: string | null;
  sourceUrl: string | null;
  rawDescription: string | null;
  isRenewable: boolean;
  isSolar: boolean;
  isApproved: boolean;
  relevanceStatus: string;
}

// ── Classification ────────────────────────────────────────────────────────────

const SOLAR_RE = /\b(solar|photovoltaic|pv)\b/i;
const BESS_RE = /\b(bess|battery|batteries|storage)\b/i;
const WIND_RE = /\b(wind\s*farm|wind\s*turbine|wind\s*energy|wind\s*power)\b/i;
const TRANSMISSION_RE = /\b(transmission|substation|interconnector|powerline|power\s*line)\b/i;
const RENEWABLE_RE = /\b(solar|photovoltaic|pv|wind|bess|battery|hydro|geothermal|renewable)\b/i;

const APPROVED_STATUSES = new Set([
  "approval given",
  "approved",
  "decision made",
  "project approved",
  "approval decision made",
  "approval in force",
  "conditions of approval varied",
  "variation to approval given",
]);

const REJECTED_STATUSES = new Set([
  "withdrawn",
  "project withdrawn",
  "clearly unacceptable",
  "lapsed",
  "project lapsed",
  "expired",
  "refused",
  "not approved",
  "approval refused",
]);

export function classifyEpbc(name: string, description: string | null): {
  technologyType: string;
  isRenewable: boolean;
  isSolar: boolean;
  relevanceStatus: string;
} {
  const text = `${name} ${description ?? ""}`;
  const hasSolar = SOLAR_RE.test(text);
  const hasBess = BESS_RE.test(text);
  const hasWind = WIND_RE.test(text);
  const hasTransmission = TRANSMISSION_RE.test(text);
  const isRenewable = RENEWABLE_RE.test(text);

  let technologyType: string;
  let relevanceStatus: string;

  if (hasSolar && hasBess) {
    technologyType = "Solar + BESS";
    relevanceStatus = "solar";
  } else if (hasSolar) {
    technologyType = "Solar";
    relevanceStatus = "solar";
  } else if (hasWind && hasBess) {
    technologyType = "Wind + BESS";
    relevanceStatus = "wind";
  } else if (hasWind) {
    technologyType = "Wind";
    relevanceStatus = "wind";
  } else if (hasBess) {
    technologyType = "BESS";
    relevanceStatus = "bess";
  } else if (hasTransmission) {
    technologyType = "Transmission";
    relevanceStatus = "transmission";
  } else if (isRenewable) {
    technologyType = "Renewable (unclassified)";
    relevanceStatus = "needs_review";
  } else {
    technologyType = "Unknown";
    relevanceStatus = "needs_review";
  }

  return { technologyType, isRenewable, isSolar: hasSolar, relevanceStatus };
}

export function classifyApproval(
  projectStatus: string | null,
  decisionStatus: string | null
): boolean {
  const combined = `${projectStatus ?? ""} ${decisionStatus ?? ""}`.toLowerCase();
  for (const s of APPROVED_STATUSES) {
    if (combined.includes(s)) return true;
  }
  return false;
}

export function extractMw(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:MW|megawatt)/i);
  if (!match) return null;
  const val = parseFloat(match[1].replace(/,/g, ""));
  return isNaN(val) ? null : val;
}

// ── Direct API ────────────────────────────────────────────────────────────────

interface PortalReferral {
  referralNumber?: string;
  epbcNumber?: string;
  title?: string;
  projectTitle?: string;
  projectName?: string;
  proposer?: string;
  proponent?: string;
  industryType?: string;
  referralStatus?: string;
  projectStatus?: string;
  decisionStatus?: string;
  primaryJurisdiction?: string;
  state?: string;
  location?: string;
  description?: string;
  referralDate?: string;
  decisionDate?: string;
  approvalDate?: string;
  referralUrl?: string;
  url?: string;
  recordYear?: number;
}

export interface ArcGisReferralAttributes {
  REFERENCE_NUMBER?: string | null;
  NAME?: string | null;
  PRIMARY_JURISDICTION?: string | null;
  REFERRAL_DECISION?: string | null;
  STATUS_DESCRIPTION?: string | null;
  STAGE_NAME?: string | null;
  REFERRAL_TYPE?: string | null;
  YEAR?: number | null;
  CATEGORY?: string | null;
  REFERRAL_URL?: string | null;
  CRM_ID?: string | null;
  OBJECTID?: number | null;
}

interface ArcGisFeature {
  attributes?: ArcGisReferralAttributes;
}

interface ArcGisQueryResponse {
  features?: ArcGisFeature[];
  exceededTransferLimit?: boolean;
  error?: {
    code?: number;
    message?: string;
    details?: string[];
  };
}

type FetchImplementation = typeof fetch;

function dateFilterYear(value?: string): number | null {
  const match = value?.match(/^(\d{4})/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  return Number.isFinite(year) ? year : null;
}

export function buildArcGisWhereClause(startDate?: string, endDate?: string): string {
  const clauses = ["1=1"];
  const startYear = dateFilterYear(startDate);
  const endYear = dateFilterYear(endDate);
  if (startYear !== null) clauses.push(`YEAR >= ${startYear}`);
  if (endYear !== null) clauses.push(`YEAR <= ${endYear}`);
  return clauses.join(" AND ");
}

function portalDetailUrl(epbcNumber: string): string {
  return `${PORTAL_BASE}/public-register/referral-detail/${epbcNumber.replace(/\//g, "-")}`;
}

function arcGisFeatureToPortalReferral(feature: ArcGisFeature): PortalReferral | null {
  const attributes = feature.attributes;
  const epbcNumber = attributes?.REFERENCE_NUMBER?.trim();
  const projectName = attributes?.NAME?.trim();
  if (!attributes || !epbcNumber || !projectName) return null;

  const description = [
    attributes.CATEGORY ? `Category: ${attributes.CATEGORY}` : null,
    attributes.REFERRAL_TYPE ? `Referral type: ${attributes.REFERRAL_TYPE}` : null,
    attributes.STATUS_DESCRIPTION ? `Status: ${attributes.STATUS_DESCRIPTION}` : null,
    attributes.STAGE_NAME ? `Stage: ${attributes.STAGE_NAME}` : null,
    attributes.REFERRAL_DECISION ? `Decision: ${attributes.REFERRAL_DECISION}` : null,
    attributes.CRM_ID ? `CRM ID: ${attributes.CRM_ID}` : null,
  ].filter((value): value is string => Boolean(value)).join(". ");

  return {
    referralNumber: epbcNumber,
    projectName,
    industryType: attributes.CATEGORY ?? undefined,
    projectStatus: attributes.STATUS_DESCRIPTION ?? attributes.STAGE_NAME ?? undefined,
    referralStatus: attributes.STAGE_NAME ?? undefined,
    decisionStatus: attributes.REFERRAL_DECISION ?? undefined,
    primaryJurisdiction: attributes.PRIMARY_JURISDICTION ?? undefined,
    state: attributes.PRIMARY_JURISDICTION ?? undefined,
    location: attributes.PRIMARY_JURISDICTION ?? undefined,
    description: description || undefined,
    referralDate: attributes.YEAR != null ? `${Math.trunc(attributes.YEAR)}-01-01` : undefined,
    referralUrl: portalDetailUrl(epbcNumber),
    recordYear: attributes.YEAR == null ? undefined : Math.trunc(attributes.YEAR),
  };
}

export function mapArcGisFeatureToEpbcRecord(
  attributes: ArcGisReferralAttributes,
): EpbcRecord | null {
  return normaliseRecord({ attributes } as ArcGisFeature);
}

function normaliseRecord(feature: ArcGisFeature): EpbcRecord | null;
function normaliseRecord(raw: PortalReferral): EpbcRecord | null;
function normaliseRecord(input: PortalReferral | ArcGisFeature): EpbcRecord | null {
  const raw: PortalReferral | null = "attributes" in input
    ? arcGisFeatureToPortalReferral(input as ArcGisFeature)
    : input as PortalReferral;
  if (!raw) return null;

  const epbcNumber = raw.referralNumber ?? raw.epbcNumber ?? "";
  if (!epbcNumber) return null;

  const projectName = raw.projectTitle ?? raw.title ?? raw.projectName ?? "";
  if (!projectName) return null;

  const industryType = raw.industryType ?? null;

  // Only ingest energy-related records. This preserves the existing EPBC
  // business rule while querying the complete official feature layer.
  if (industryType && !/energy|electricity|generation|supply|power/i.test(industryType)) {
    return null;
  }

  const description = raw.description ?? null;
  const { technologyType, isRenewable, isSolar, relevanceStatus } = classifyEpbc(projectName, description);
  const isApproved = classifyApproval(raw.projectStatus ?? raw.referralStatus ?? null, raw.decisionStatus ?? null);
  const sizeMw = extractMw(description) ?? extractMw(projectName);

  return {
    epbcNumber,
    projectName,
    proponent: raw.proposer ?? raw.proponent ?? null,
    industryType,
    projectStatus: raw.projectStatus ?? raw.referralStatus ?? null,
    decisionStatus: raw.decisionStatus ?? null,
    state: raw.primaryJurisdiction ?? raw.state ?? null,
    location: raw.location ?? null,
    technologyType,
    sizeMw,
    referralDate: raw.referralDate ?? null,
    approvalDate: raw.approvalDate ?? raw.decisionDate ?? null,
    sourceUrl: raw.referralUrl ?? raw.url ?? portalDetailUrl(epbcNumber),
    rawDescription: description,
    isRenewable,
    isSolar,
    isApproved,
    relevanceStatus,
  };
}

async function fetchArcGisPage(
  offset: number,
  startDate: string | undefined,
  endDate: string | undefined,
  fetchImplementation: FetchImplementation,
): Promise<ArcGisQueryResponse> {
  const params = new URLSearchParams({
    where: buildArcGisWhereClause(startDate, endDate),
    outFields: ARCGIS_OUT_FIELDS,
    returnGeometry: "false",
    orderByFields: "OBJECTID ASC",
    resultOffset: String(offset),
    resultRecordCount: String(ARCGIS_PAGE_SIZE),
    f: "json",
  });
  const res = await fetchImplementation(`${ARCGIS_LAYER_URL}/query?${params}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; SolarScout/1.0)",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`ArcGIS HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) throw new Error("Non-JSON response");
  const data = (await res.json()) as ArcGisQueryResponse;
  if (data.error) {
    throw new Error(
      `ArcGIS query error ${data.error.code ?? "unknown"}: ${data.error.message ?? "Unknown error"}`,
    );
  }
  return data;
}

export async function fetchArcGisEpbcRecords(
  startDate?: string,
  endDate?: string,
  fetchImplementation: FetchImplementation = fetch,
): Promise<EpbcRecord[]> {
  const recordsByNumber = new Map<string, EpbcRecord>();
  let offset = 0;

  for (let page = 0; page < 50; page++) {
    const data = await fetchArcGisPage(offset, startDate, endDate, fetchImplementation);
    const features = data.features ?? [];
    for (const feature of features) {
      const record = normaliseRecord(feature);
      if (record) recordsByNumber.set(record.epbcNumber, record);
    }

    logger.info(
      { page, offset, features: features.length, records: recordsByNumber.size },
      "EPBC: ArcGIS page processed",
    );

    if (!data.exceededTransferLimit || features.length === 0) break;
    offset += features.length;
  }

  return [...recordsByNumber.values()];
}

// ── ChatGPT web-search fallback ───────────────────────────────────────────────

interface GptReferral {
  epbc_number?: string;
  project_name?: string;
  proponent?: string;
  technology?: string;
  state?: string;
  capacity_mw?: number | null;
  status?: string;
  notice_date?: string;
  comment_close_date?: string;
}

type GptOpenAI = {
  responses: {
    create: (opts: {
      model: string;
      tools: { type: string }[];
      input: string;
      max_output_tokens: number;
    }) => Promise<{ output_text?: string; output?: { type: string; text?: string }[] }>;
  };
};

const JSON_SCHEMA_EXAMPLE = `[
  {
    "epbc_number": "2024/10123",
    "project_name": "Example Solar Farm",
    "proponent": "Acme Energy Pty Ltd",
    "technology": "Solar",
    "state": "NSW",
    "capacity_mw": 150,
    "status": "Referral Decision — Open for Public Comment",
    "notice_date": "2024-03-15",
    "comment_close_date": "2024-04-05"
  }
]`;

function buildSearchPrompt(focus: string, today: string): string {
  return `Today is ${today}. Your task: find EPBC Act referrals for solar energy and solar+BESS projects from the Australian EPBC Public Portal.

Search focus: ${focus}

Search the EPBC portal (epbcpublicportal.environment.gov.au), government registers, and news sources to compile a comprehensive list. Look at:
- The "All Referrals" table filtered by Energy industry type
- Individual referral detail pages for solar/PV projects
- Public notice pages (open for comment, assessment notices)
- Any accessible government lists of EPBC renewable energy referrals

Include ALL statuses: under assessment, open for public comment, approved, conditions varied, completed. Do NOT limit to only recent projects.

Return ONLY a valid JSON array (no prose, no markdown fences):
${JSON_SCHEMA_EXAMPLE}

Rules:
- epbc_number: format YYYY/NNNNN
- capacity_mw: MW number extracted from description, null if not stated
- technology: "Solar", "Solar + BESS", "BESS", "Wind", "Wind + BESS", or "Other"
- state: AU state/territory abbreviation (NSW, VIC, QLD, SA, WA, TAS, NT, ACT) or "NZ"
- Exclude non-energy projects (mining, roads, agriculture, housing)
- Return [] if nothing found for this focus`;
}

function extractJsonArray(text: string): GptReferral[] {
  // Strip markdown fences
  text = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? (parsed as GptReferral[]) : [];
  } catch {
    return [];
  }
}

async function runGptSearch(gpt: GptOpenAI, prompt: string): Promise<GptReferral[]> {
  try {
    const response = await gpt.responses.create({
      model: "gpt-5.4",
      tools: [{ type: "web_search_preview" }],
      input: prompt,
      max_output_tokens: 8192,
    });
    let text = response.output_text ?? "";
    if (!text && Array.isArray(response.output)) {
      for (const block of response.output) {
        if (block.type === "message" && block.text) { text = block.text; break; }
      }
    }
    return extractJsonArray(text);
  } catch (err) {
    logger.warn({ err }, "EPBC ChatGPT sub-query failed, skipping");
    return [];
  }
}

/** Split a date range into ~12-month bands for targeted searching. */
function buildYearBands(startDate?: string, endDate?: string): string[] {
  const start = startDate ? new Date(startDate) : new Date("2018-01-01");
  const end   = endDate   ? new Date(endDate)   : new Date();

  const bands: string[] = [];
  const cur = new Date(start.getFullYear(), 0, 1); // snap to year start

  while (cur <= end) {
    const bandStart = cur.getFullYear();
    cur.setFullYear(cur.getFullYear() + 1);
    const bandEnd = Math.min(cur.getFullYear() - 1, end.getFullYear());
    bands.push(bandStart === bandEnd ? `${bandStart}` : `${bandStart} to ${bandEnd}`);
    if (cur > end) break;
  }
  return bands.length ? bands : ["all years"];
}

/**
 * Use OpenAI Responses API with web_search_preview across multiple parallel
 * targeted queries (by state and year range) to maximise EPBC coverage.
 * Results are deduplicated by EPBC number.
 */
async function scrapeViaChatGpt(startDate?: string, endDate?: string): Promise<PortalReferral[]> {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  const gpt = openai as unknown as GptOpenAI;
  const today = new Date().toISOString().slice(0, 10);

  const states = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"];
  const yearBands = buildYearBands(startDate, endDate);

  // Human-readable date range description for the prompts
  const rangeLabel = startDate || endDate
    ? `between ${startDate ?? "any date"} and ${endDate ?? "today"}`
    : "across all years";

  const queries: string[] = [];

  // Per-state queries scoped to the requested date range
  for (const state of states) {
    queries.push(buildSearchPrompt(
      `Solar and solar+BESS projects in ${state} referred under the EPBC Act, noticed ${rangeLabel}`,
      today,
    ));
  }

  // Year-band sweeps derived from the date range
  for (const band of yearBands) {
    queries.push(buildSearchPrompt(
      `Solar and solar+BESS EPBC referrals from ${band} across all Australian states`,
      today,
    ));
  }

  // Always include a sweep for the very latest (open for comment / under assessment)
  queries.push(buildSearchPrompt(
    `Solar EPBC referrals ${startDate ? `after ${startDate}` : "currently"} open for public comment or under assessment`,
    today,
  ));

  logger.info({ queryCount: queries.length }, "EPBC: running parallel ChatGPT searches");

  // Run all queries in parallel (ChatGPT handles its own rate limiting)
  const resultSets = await Promise.all(queries.map((q) => runGptSearch(gpt, q)));

  // Flatten and deduplicate by EPBC number
  const seen = new Set<string>();
  const unique: GptReferral[] = [];
  for (const batch of resultSets) {
    for (const r of batch) {
      const key = (r.epbc_number ?? "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(r);
    }
  }

  logger.info({ total: unique.length }, "EPBC: ChatGPT deduped results");

  return unique.map((r): PortalReferral => ({
    epbcNumber: r.epbc_number,
    projectName: r.project_name,
    proposer: r.proponent,
    industryType: "Energy",
    projectStatus: r.status,
    state: r.state,
    location: r.state ?? undefined,
    referralDate: r.notice_date,
    description: [
      r.technology,
      typeof r.capacity_mw === "number" ? `${r.capacity_mw} MW` : null,
    ].filter((value): value is string => Boolean(value)).join(" - ") || undefined,
  }));
}

// ── Normalise ─────────────────────────────────────────────────────────────────

function normaliseFallbackRecord(raw: PortalReferral): EpbcRecord | null {
  return normaliseRecord(raw);
}

// ── Public entry point ────────────────────────────────────────────────────────

export interface EpbcFetchDependencies {
  fetchImplementation?: FetchImplementation;
  fallback?: (startDate?: string, endDate?: string) => Promise<EpbcRecord[]>;
  supplementStructuredRecords?: boolean;
}

async function fetchOpenAiFallbackRecords(
  startDate?: string,
  endDate?: string,
): Promise<EpbcRecord[]> {
  const raws = await scrapeViaChatGpt(startDate, endDate);
  return raws
    .map((raw) => normaliseFallbackRecord(raw))
    .filter((record): record is EpbcRecord => record !== null);
}

export function mergeEpbcRecordDetails(
  structuredRecords: EpbcRecord[],
  supplementalRecords: EpbcRecord[],
): EpbcRecord[] {
  const supplementalByNumber = new Map(
    supplementalRecords.map((record) => [record.epbcNumber, record]),
  );
  const merged = structuredRecords.map((record) => {
    const supplemental = supplementalByNumber.get(record.epbcNumber);
    if (!supplemental) return record;
    supplementalByNumber.delete(record.epbcNumber);

    const descriptions = [record.rawDescription, supplemental.rawDescription]
      .filter((value): value is string => Boolean(value));

    return {
      ...record,
      proponent: record.proponent ?? supplemental.proponent,
      sizeMw: record.sizeMw ?? supplemental.sizeMw,
      referralDate: supplemental.referralDate ?? record.referralDate,
      approvalDate: record.approvalDate ?? supplemental.approvalDate,
      sourceUrl: record.sourceUrl ?? supplemental.sourceUrl,
      rawDescription: descriptions.length > 0
        ? [...new Set(descriptions)].join(" - ")
        : null,
      technologyType: record.technologyType === "Unknown"
        ? supplemental.technologyType
        : record.technologyType,
      isRenewable: record.isRenewable || supplemental.isRenewable,
      isSolar: record.isSolar || supplemental.isSolar,
      relevanceStatus: record.relevanceStatus === "needs_review"
        ? supplemental.relevanceStatus
        : record.relevanceStatus,
    };
  });

  return merged;
}

export async function fetchEpbcRecords(
  startDate?: string,
  endDate?: string,
  dependencies: EpbcFetchDependencies = {},
): Promise<EpbcRecord[]> {
  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  const fallback = dependencies.fallback ?? fetchOpenAiFallbackRecords;
  const supplementStructuredRecords =
    dependencies.supplementStructuredRecords ?? Boolean(process.env.OPENAI_API_KEY?.trim());

  try {
    logger.info({ startDate, endDate }, "EPBC: querying official ArcGIS feature layer");
    const records = await fetchArcGisEpbcRecords(startDate, endDate, fetchImplementation);
    logger.info({ count: records.length }, "EPBC: ArcGIS feature layer succeeded");

    if (supplementStructuredRecords && records.length > 0) {
      try {
        const supplementalRecords = await fallback(startDate, endDate);
        const merged = mergeEpbcRecordDetails(records, supplementalRecords);
        logger.info(
          { structured: records.length, supplemental: supplementalRecords.length, merged: merged.length },
          "EPBC: supplemented ArcGIS records with OpenAI details",
        );
        return merged;
      } catch (supplementError) {
        logger.warn(
          { err: supplementError },
          "EPBC: optional OpenAI detail supplementation failed; using ArcGIS records",
        );
      }
    }

    return records;
  } catch (arcGisError) {
    logger.warn(
      { err: arcGisError },
      "EPBC: ArcGIS feature layer failed, falling back to OpenAI web search",
    );
    try {
      const records = await fallback(startDate, endDate);
      logger.info({ count: records.length }, "EPBC: OpenAI web search fallback succeeded");
      return records;
    } catch (fallbackError) {
      logger.error(
        { arcGisError, fallbackError },
        "EPBC: both ArcGIS and OpenAI web search fallback failed",
      );
      throw fallbackError;
    }
  }
}
