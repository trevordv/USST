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
import { cachedSourceFallback, hashMeaningfulSourceContent, hashSourceContent } from "./ai-source-cache.ts";
import { isEligibleScanProject } from "./project-eligibility.ts";
import { recordOpenAiCacheHit } from "./openai-usage.ts";
import { OpenAiQualityError, runOpenAiEscalation } from "./openai-escalation.ts";

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
  let totalCandidates = 0;
  let offset = 0;

  for (let page = 0; page < 50; page++) {
    const data = await fetchArcGisPage(offset, startDate, endDate, fetchImplementation);
    const features = data.features ?? [];
    for (const feature of features) {
      const record = normaliseRecord(feature);
      if (record) {
        totalCandidates++;
        recordsByNumber.set(record.epbcNumber, record);
      }
    }

    logger.info(
      { page, offset, features: features.length, records: recordsByNumber.size },
      "EPBC: ArcGIS page processed",
    );

    if (!data.exceededTransferLimit || features.length === 0) break;
    offset += features.length;
  }

  logger.info({ totalCandidates, duplicatesRemoved: totalCandidates - recordsByNumber.size },
    "EPBC: official candidates deduplicated");

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

export function buildSearchPrompt(focus: string, today: string): string {
  return `${today ? `Today is ${today}. ` : ""}Your task: find EPBC Act referrals for solar energy and solar+BESS projects from the Australian EPBC Public Portal.

Search focus: ${focus}

Search ONLY the official EPBC portal (epbcpublicportal.environment.gov.au) and official DCCEEW spatial service (gis.environment.gov.au). Look at:
- The "All Referrals" table filtered by Energy industry type
- Individual referral detail pages for solar/PV projects
- Public notice pages (open for comment, assessment notices)
- Official EPBC renewable-energy referral records

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
  if (start === -1 || end === -1) throw new Error("EPBC AI response did not contain a JSON array");
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) throw new Error("EPBC AI response was not an array");
    return parsed.filter((row): row is GptReferral => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  } catch {
    throw new Error("EPBC AI response contained malformed JSON");
  }
}

async function runGptSearch(
  gpt: GptOpenAI, prompt: string, sourceName: string, onAttempt: () => void,
): Promise<GptReferral[]> {
  return runOpenAiEscalation({ context: {
    operation: "epbc_search", sourceName, sourceUrl: ARCGIS_LAYER_URL,
    sourceIdentifier: "EPBC Public Portal",
  }, request: model => {
    onAttempt();
    return gpt.responses.create({
      model, tools: [{ type: "web_search_preview" }], input: prompt, max_output_tokens: 8192,
    });
  }, validate: response => {
    let text = response.output_text ?? "";
    if (!text && Array.isArray(response.output)) {
      for (const block of response.output) {
        if (block.type === "message" && block.text) { text = block.text; break; }
      }
    }
    try { return extractJsonArray(text); }
    catch (error) {
      throw new OpenAiQualityError("malformed_output", error instanceof Error ? error.message : "Invalid EPBC response");
    }
  }, resultCount: rows => rows.length });
}

function isDeterministicallyResolved(record: EpbcRecord): boolean {
  if (record.isSolar) return record.sizeMw !== null;
  return record.relevanceStatus !== "needs_review";
}

function isEligibleEpbcRecord(record: EpbcRecord): boolean {
  return isEligibleScanProject({
    name: record.projectName,
    description: record.rawDescription ?? record.technologyType,
    capacityMw: record.sizeMw,
    country: "AU",
  });
}

export interface EpbcEnrichmentPlan {
  records: EpbcRecord[];
  unresolved: EpbcRecord[];
  totalCandidates: number;
  duplicatesRemoved: number;
  deterministicallyResolved: number;
}

/** Merge prior EPBC detail only after official-number deduplication. */
export function planEpbcEnrichment(
  candidates: readonly EpbcRecord[],
  priorRecords: readonly EpbcRecord[] = [],
): EpbcEnrichmentPlan {
  const unique = [...new Map(candidates.map(record => [record.epbcNumber, record])).values()];
  const records = mergeEpbcRecordDetails(unique, priorRecords);
  const unresolved = records.filter(record => !isDeterministicallyResolved(record));
  return {
    records, unresolved, totalCandidates: candidates.length,
    duplicatesRemoved: candidates.length - unique.length,
    deterministicallyResolved: records.length - unresolved.length,
  };
}

const EPBC_AI_RECORDS_PER_REQUEST = 20;
interface EpbcFallbackResult { records: EpbcRecord[]; cached: number; aiCalls: number }

/** Output-sized batches make the run bound proportional to unresolved records. */
export function epbcAiRequestUpperBound(unresolvedCount: number): number {
  return unresolvedCount > 0 ? Math.ceil(unresolvedCount / EPBC_AI_RECORDS_PER_REQUEST) : 0;
}

/** One bounded request per unresolved batch; no state/year discovery fan-out. */
async function scrapeViaChatGpt(
  startDate?: string,
  endDate?: string,
  unresolved: readonly EpbcRecord[] = [],
): Promise<EpbcFallbackResult> {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  const { pool } = await import("@workspace/db");
  const gpt = openai as unknown as GptOpenAI;
  const today = new Date().toISOString().slice(0, 10);
  const rangeLabel = startDate || endDate
    ? `between ${startDate ?? "any date"} and ${endDate ?? "today"}`
    : "across all years";
  const batches = unresolved.length > 0
    ? Array.from({ length: epbcAiRequestUpperBound(unresolved.length) }, (_, index) =>
      unresolved.slice(index * EPBC_AI_RECORDS_PER_REQUEST, (index + 1) * EPBC_AI_RECORDS_PER_REQUEST))
    : [[]]; // Whole-source failure: one bounded official discovery request.
  logger.info({ unresolved: unresolved.length, maxAiCalls: batches.length }, "EPBC: planned unresolved AI batches");
  let cached = 0;
  let aiCalls = 0;
  const resultSets: GptReferral[][] = [];
  // Deliberately sequential: this replaces the former unbounded parallel fan-out.
  for (const batch of batches) {
    const allowedNumbers = new Set(batch.map(record => record.epbcNumber));
    const focus = batch.length > 0
      ? `Resolve only these deduplicated official EPBC records (${rangeLabel}). Return no other EPBC numbers:\n${JSON.stringify(batch.map(record => ({
        epbc_number: record.epbcNumber, project_name: record.projectName,
        state: record.state, status: record.projectStatus, source_url: record.sourceUrl,
      })))}`
      : `Official solar and solar+BESS EPBC referrals ${rangeLabel}; the structured ArcGIS service is unavailable`;
    // Official unresolved payloads carry their own stable date-window cache key;
    // only a whole-source outage needs volatile current-date search context.
    const prompt = buildSearchPrompt(focus, batch.length > 0 ? "" : today);
    let wasCached = false;
    const sourceName = batch.length ? "EPBC unresolved records" : "EPBC official-source outage";
    const rows = await cachedSourceFallback<GptReferral>(
      pool,
      {
        sourceName,
        sourceUrl: ARCGIS_LAYER_URL,
        contentHash: hashMeaningfulSourceContent(JSON.stringify(batch)),
        contentObserved: batch.length > 0,
        startDate, endDate, model: "gpt-5.6-luna",
        promptHash: hashSourceContent(JSON.stringify({ prompt, escalation: "luna-terra-sol-v1" })),
      },
      async () => runGptSearch(gpt, prompt, sourceName, () => { aiCalls++; }),
      value => {
        if (!Array.isArray(value)) throw new Error("Cached EPBC AI result was not an array");
        return value.filter((row): row is GptReferral => Boolean(row) && typeof row === "object" && !Array.isArray(row));
      },
      (event, fields) => {
        if (event === "ai_source_cache_hit") wasCached = true;
        logger.info({ event, workflow: "epbc", ...fields }, "EPBC AI cache");
      },
    );
    if (wasCached) {
      cached += batch.length || 1;
      await recordOpenAiCacheHit({
        operation: "epbc_search", sourceName, sourceUrl: ARCGIS_LAYER_URL,
        sourceIdentifier: "EPBC Public Portal", model: "gpt-5.6-luna",
      }, rows.length);
    }
    resultSets.push(batch.length
      ? rows.filter(row => allowedNumbers.has((row.epbc_number ?? "").trim()))
      : rows);
  }
  const seen = new Set<string>();
  const unique = resultSets.flat().filter(row => {
    const key = (row.epbc_number ?? "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
  const records = unique.map((r): PortalReferral => ({
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
  })).map(raw => normaliseFallbackRecord(raw)).filter((record): record is EpbcRecord => record !== null);
  return { records, cached, aiCalls };
}

// ── Normalise ─────────────────────────────────────────────────────────────────

function normaliseFallbackRecord(raw: PortalReferral): EpbcRecord | null {
  return normaliseRecord(raw);
}

// ── Public entry point ────────────────────────────────────────────────────────

export interface EpbcFetchDependencies {
  fetchImplementation?: FetchImplementation;
  fallback?: (startDate?: string, endDate?: string, unresolved?: readonly EpbcRecord[]) => Promise<EpbcRecord[] | EpbcFallbackResult>;
  priorRecords?: readonly EpbcRecord[];
  supplementStructuredRecords?: boolean;
}

async function fetchOpenAiFallbackRecords(
  startDate?: string,
  endDate?: string,
  unresolved?: readonly EpbcRecord[],
): Promise<EpbcFallbackResult> {
  return scrapeViaChatGpt(startDate, endDate, unresolved);
}

function fallbackResult(value: EpbcRecord[] | EpbcFallbackResult): EpbcFallbackResult {
  return Array.isArray(value) ? { records: value, cached: 0, aiCalls: 1 } : value;
}

async function loadPriorEpbcRecords(epbcNumbers?: readonly string[]): Promise<EpbcRecord[]> {
  if (epbcNumbers?.length === 0) return [];
  try {
    const { db, epbcProjectsTable } = await import("@workspace/db");
    const { inArray } = await import("drizzle-orm");
    const query = db.select().from(epbcProjectsTable);
    const rows = epbcNumbers
      ? await query.where(inArray(epbcProjectsTable.epbcNumber, [...epbcNumbers]))
      : await query;
    return rows.map(row => ({
      ...row,
      sizeMw: row.sizeMw === null ? null : Number(row.sizeMw),
    }));
  } catch (err) {
    logger.warn({ err }, "EPBC: prior-result lookup failed; continuing with official data");
    return [];
  }
}

export function mergeEpbcRecordDetails(
  structuredRecords: readonly EpbcRecord[],
  supplementalRecords: readonly EpbcRecord[],
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
    const candidates = await fetchArcGisEpbcRecords(startDate, endDate, fetchImplementation);
    const priorRecords = dependencies.priorRecords ??
      (supplementStructuredRecords
        ? await loadPriorEpbcRecords(candidates.map(record => record.epbcNumber))
        : []);
    const plan = planEpbcEnrichment(candidates, priorRecords);
    const records = plan.records;
    logger.info({
      totalCandidates: plan.totalCandidates,
      deterministicallyResolved: plan.deterministicallyResolved,
      duplicatesRemoved: plan.duplicatesRemoved,
      unresolved: plan.unresolved.length,
    }, "EPBC: deterministic resolution complete");

    if (supplementStructuredRecords && plan.unresolved.length > 0) {
      try {
        const supplemental = fallbackResult(await fallback(startDate, endDate, plan.unresolved));
        const merged = mergeEpbcRecordDetails(records, supplemental.records);
        logger.info(
          { totalCandidates: plan.totalCandidates, deterministicallyResolved: plan.deterministicallyResolved,
            duplicatesRemoved: plan.duplicatesRemoved, cached: supplemental.cached,
            unresolved: plan.unresolved.length, aiCalls: supplemental.aiCalls,
            finalEligibleProjects: merged.filter(isEligibleEpbcRecord).length },
          "EPBC: unresolved enrichment complete",
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
      const result = fallbackResult(await fallback(startDate, endDate, []));
      const priorRecords = dependencies.priorRecords ?? await loadPriorEpbcRecords();
      const priorNumbers = new Set(priorRecords.map(record => record.epbcNumber));
      const records = [
        ...mergeEpbcRecordDetails(priorRecords, result.records),
        ...result.records.filter(record => !priorNumbers.has(record.epbcNumber)),
      ];
      logger.info({ count: records.length, cached: result.cached, unresolved: 1,
        deterministicallyResolved: priorRecords.length, duplicatesRemoved: result.records.length + priorRecords.length - records.length,
        aiCalls: result.aiCalls, finalEligibleProjects: records.filter(isEligibleEpbcRecord).length },
        "EPBC: bounded official-source outage fallback succeeded");
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
