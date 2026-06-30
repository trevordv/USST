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

// ── Firecrawl fallback ────────────────────────────────────────────────────────

interface FirecrawlResponse {
  success: boolean;
  markdown?: string;
  html?: string;
}

async function scrapeViaFirecrawl(): Promise<PortalReferral[]> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set");

  const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url: `${PORTAL_BASE}/all-referrals/`,
      formats: ["markdown"],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`Firecrawl HTTP ${resp.status}`);

  const result = (await resp.json()) as FirecrawlResponse;
  if (!result.success) throw new Error("Firecrawl scrape failed");

  const text = result.markdown ?? result.html ?? "";
  const records: PortalReferral[] = [];

  // Simple table row extraction — EPBC portal renders rows as lines with | separators
  const lines = text.split("\n");
  for (const line of lines) {
    const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
    if (parts.length < 3) continue;
    // Skip header lines
    if (parts[0].toLowerCase().includes("epbc") && parts[0].toLowerCase().includes("number")) continue;

    const epbcMatch = parts[0].match(/\d{4}\/\d+/);
    if (!epbcMatch) continue;

    records.push({
      referralNumber: epbcMatch[0],
      title: parts[1] ?? "",
      proposer: parts[2] ?? "",
      projectStatus: parts[3] ?? "",
      primaryJurisdiction: parts[4] ?? "",
    });
  }

  return records;
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
    logger.warn({ err: apiErr }, "EPBC: direct API failed, falling back to Firecrawl");
    try {
      raws = await scrapeViaFirecrawl();
      logger.info({ count: raws.length }, "EPBC: Firecrawl fallback succeeded");
    } catch (fcErr) {
      logger.error({ err: fcErr }, "EPBC: both API and Firecrawl failed");
      throw fcErr;
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
