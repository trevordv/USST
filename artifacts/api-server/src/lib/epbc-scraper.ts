/**
 * EPBC Public Portal scraper.
 *
 * Strategy:
 *   1. Try the portal's undocumented JSON API (Spring Boot pagination format).
 *   2. Fall back to Firecrawl if the API is unavailable.
 *
 * Only records where industry type contains "Energy" are kept.
 */

import { logger } from "./logger";

const PORTAL_BASE = "https://epbcpublicportal.environment.gov.au";
const API_BASE = `${PORTAL_BASE}/api`;

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
}

interface PortalPage {
  content?: PortalReferral[];
  results?: PortalReferral[];
  items?: PortalReferral[];
  referrals?: PortalReferral[];
  totalElements?: number;
  totalPages?: number;
  size?: number;
  number?: number;
}

function extractItems(data: unknown): PortalReferral[] {
  if (!data || typeof data !== "object") return [];
  const d = data as PortalPage;
  return (d.content ?? d.results ?? d.items ?? d.referrals ?? (Array.isArray(data) ? (data as PortalReferral[]) : []));
}

async function fetchApiPage(page: number, size: number): Promise<{ items: PortalReferral[]; totalPages: number }> {
  const url = `${API_BASE}/referrals?size=${size}&page=${page}&sort=referralDate,desc`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; SolarScout/1.0)",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) throw new Error("Non-JSON response");
  const data = (await res.json()) as PortalPage;
  const items = extractItems(data);
  const totalPages = (data as PortalPage).totalPages ?? (items.length < size ? 1 : 99);
  return { items, totalPages };
}

async function scrapeViaApi(): Promise<PortalReferral[]> {
  const PAGE_SIZE = 200;
  const all: PortalReferral[] = [];
  let page = 0;

  const first = await fetchApiPage(page, PAGE_SIZE);
  all.push(...first.items);
  const { totalPages } = first;

  for (page = 1; page < Math.min(totalPages, 50); page++) {
    const { items } = await fetchApiPage(page, PAGE_SIZE);
    all.push(...items);
    if (items.length < PAGE_SIZE) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  return all;
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

/**
 * Use OpenAI Responses API with web_search_preview across multiple parallel
 * targeted queries (by state and year range) to maximise EPBC coverage.
 * Results are deduplicated by EPBC number.
 */
async function scrapeViaChatGpt(): Promise<PortalReferral[]> {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  const gpt = openai as unknown as GptOpenAI;
  const today = new Date().toISOString().slice(0, 10);

  // Build a matrix of searches: states × year ranges
  const states = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"];
  const yearBands = [
    "2018 to 2020",
    "2021 to 2022",
    "2023 to 2024",
    "2025 to present",
  ];

  const queries: string[] = [];

  // Per-state queries for recent years (highest value)
  for (const state of states) {
    queries.push(buildSearchPrompt(
      `Solar and solar+BESS projects in ${state} referred under the EPBC Act (all years, any status)`,
      today,
    ));
  }

  // Year-band sweeps to catch anything missed by the state queries
  for (const band of yearBands) {
    queries.push(buildSearchPrompt(
      `Solar and solar+BESS EPBC referrals from ${band} across all Australian states`,
      today,
    ));
  }

  // Broad "open for comment / under assessment" sweep to catch the very latest
  queries.push(buildSearchPrompt(
    "Solar EPBC referrals currently open for public comment or under assessment (most recent)",
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
  }));
}

// ── Normalise ─────────────────────────────────────────────────────────────────

function normaliseRecord(raw: PortalReferral): EpbcRecord | null {
  const epbcNumber = raw.referralNumber ?? raw.epbcNumber ?? "";
  if (!epbcNumber) return null;

  const projectName = raw.projectTitle ?? raw.title ?? raw.projectName ?? "";
  if (!projectName) return null;

  const industryType = raw.industryType ?? null;

  // Only ingest energy-related records
  if (industryType && !/energy|electricity|generation|supply|power/i.test(industryType)) {
    return null;
  }

  const description = raw.description ?? null;
  const { technologyType, isRenewable, isSolar, relevanceStatus } = classifyEpbc(projectName, description);
  const isApproved = classifyApproval(raw.projectStatus ?? raw.referralStatus ?? null, raw.decisionStatus ?? null);
  const sizeMw = extractMw(description) ?? extractMw(projectName);

  const referralNum = epbcNumber.replace(/\//g, "-");
  const sourceUrl = raw.referralUrl ?? raw.url ?? `${PORTAL_BASE}/public-register/referral-detail/${referralNum}`;

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
    sourceUrl,
    rawDescription: description,
    isRenewable,
    isSolar,
    isApproved,
    relevanceStatus,
  };
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function fetchEpbcRecords(): Promise<EpbcRecord[]> {
  let raws: PortalReferral[] = [];

  try {
    logger.info("EPBC: trying direct API");
    raws = await scrapeViaApi();
    logger.info({ count: raws.length }, "EPBC: direct API succeeded");
  } catch (apiErr) {
    logger.warn({ err: apiErr }, "EPBC: direct API failed, falling back to ChatGPT web search");
    try {
      raws = await scrapeViaChatGpt();
      logger.info({ count: raws.length }, "EPBC: ChatGPT web search succeeded");
    } catch (gptErr) {
      logger.error({ err: gptErr }, "EPBC: both direct API and ChatGPT web search failed");
      throw gptErr;
    }
  }

  const records: EpbcRecord[] = [];
  for (const raw of raws) {
    const record = normaliseRecord(raw);
    if (record) records.push(record);
  }

  logger.info({ total: raws.length, kept: records.length }, "EPBC: normalised records");
  return records;
}
