/**
 * Solar project scraper
 *
 * Fetches content from Australian / New Zealand energy news sources and extracts
 * solar and BESS project announcements (≥5 MW) using keyword and pattern matching.
 *
 * Only the approved sources listed in replit.md are scanned — no broad search,
 * no developer page scraping, no ad-hoc sites.
 *
 * Sources covered:
 *  - News: Renew Economy, AltEnergy, PV Magazine Australia, EcoGeneration,
 *    Utility Magazine, ESD News, RenewMap
 *  - Government: ARENA, CER, AEMO, DCCEEW, EPBC Act, NSW Planning Portal,
 *    NSW Planning, Planning Victoria, QLD Coordinator-General, SA Energy & Mining,
 *    WA EPA, NT Development, Tasmania EPA
 *  - NZ: Electricity Authority, Transpower, NZ Fast-track, NZ EPA
 *  - AltEnergy and LUVI are authenticated and handled separately
 *
 * Apify Google Search is used ONLY for the explicit contact-enrichment feature
 * (POST /projects/enrich-contacts), never during scanning.
 */

import { db, projectsTable, scansTable, scanProjectsTable, contactEnrichmentsTable, pvhContactsTable, type PvhContact } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import {
  getProjectIneligibilityReason,
  hasSolarComponent,
  isEligibleScanProject,
  isWindProject,
  summarizeScanLineage,
  type ScanProjectLineage,
} from "./project-eligibility";
import {
  classifySourceResponse,
  parseAemoGenerationRows,
  parseOfficialProjectHtml,
  type SourceRepairCandidate,
  type SourceResponseProblem,
} from "./source-repair-parsers";
import {
  AEMO_GENERATION_WORKBOOK_URL,
  getSourceRepairStrategy,
  validateSourceRepairStrategies,
} from "./source-repair-strategies";
import { mapWithConcurrency } from "./concurrency";

// ---------------------------------------------------------------------------
// AltEnergy authenticated session
// ---------------------------------------------------------------------------

const ALTENERGY_BASE = "https://altenergy.com.au";
const ALTENERGY_LOGIN_URL = `${ALTENERGY_BASE}/login`;

// LUVI's development pipeline is an XOR-encrypted JSON data file. The site
// itself decrypts it client-side after the user enters the pipeline password.
const LUVI_PROJECTS_URL =
  "https://luvi.com.au/projects?category=Energy&status=Proposed%2CApproved%2CCommitted%2CCommitted+%28FID%29";
const LUVI_PIPELINE_URL = "https://luvi.com.au/data/pipeline.enc?v=20260628a";
const LUVI_PIPELINE_STATUSES = new Set([
  "Proposed",
  "Approved",
  "Committed",
  "Committed (FID)",
]);
const LUVI_SOURCE_NAME = "LUVI Project Tracker";

/** In-memory cookie jar for AltEnergy session cookies */
let altEnergyCookies: string[] = [];
let altEnergyAuthenticated = false;
let altEnergySessionExpiry = 0; // unix ms — re-login after 55 min

/**
 * Logs in to altenergy.com.au (Laravel app).
 *
 * Flow:
 *   1. GET /login  → grab CSRF token from <meta name="csrf-token"> and the
 *                    laravel_session cookie from Set-Cookie
 *   2. POST /login → send email, password, _token with session cookie attached
 *   3. Store the authenticated session cookie returned in the redirect response
 */
async function loginAltEnergy(): Promise<void> {
  altEnergyAuthenticated = false;
  const email = process.env.ALTENERGY_USERNAME;
  const password = process.env.ALTENERGY_PASSWORD;

  if (!email || !password) {
    logger.warn("ALTENERGY_USERNAME or ALTENERGY_PASSWORD not set — skipping authenticated AltEnergy scrape");
    return;
  }

  logger.info("Logging in to AltEnergy...");

  // Step 1: GET login page — extract CSRF token and session cookie
  const loginPageRes = await fetchRaw(ALTENERGY_LOGIN_URL);

  const csrfToken = loginPageRes.text.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/i)?.[1];
  if (!csrfToken) {
    logger.warn("AltEnergy: could not extract CSRF token from login page");
    return;
  }

  // Collect cookies from the GET (laravel_session etc.) — strip attributes
  const getSessionCookies = loginPageRes.cookies
    .map((c) => c.split(";")[0].trim())
    .filter((c) => c.length > 0);

  // Step 2: POST credentials
  const body = new URLSearchParams({
    _token: csrfToken,
    email,
    password,
    submit: "Login",
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(ALTENERGY_LOGIN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Cookie: getSessionCookies.join("; "),
        Referer: ALTENERGY_LOGIN_URL,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "X-CSRF-TOKEN": csrfToken,
      },
      body: body.toString(),
      redirect: "manual", // capture redirect without following — session cookie is on the 302
      signal: controller.signal,
    });

    // Collect all Set-Cookie headers from the POST response
    const postCookies: string[] = [];
    res.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") postCookies.push(value);
    });

    // Merge GET + POST cookies; POST cookies take precedence (same name = last wins)
    const cookieMap = new Map<string, string>();
    for (const raw of [...loginPageRes.cookies, ...postCookies]) {
      const pair = raw.split(";")[0].trim();
      const eqIdx = pair.indexOf("=");
      if (eqIdx > 0) {
        cookieMap.set(pair.slice(0, eqIdx), pair);
      }
    }
    altEnergyCookies = Array.from(cookieMap.values());
    altEnergySessionExpiry = Date.now() + 55 * 60 * 1000; // 55 min

    // A successful Laravel login returns a 302 redirect away from /login
    const location = res.headers.get("location") ?? "";
    const loggedIn = res.status === 302 && !location.includes("/login");

    if (loggedIn) {
      altEnergyAuthenticated = true;
      logger.info({ redirectTo: location }, "AltEnergy login successful");
    } else {
      logger.warn(
        { status: res.status, location, cookieCount: altEnergyCookies.length },
        "AltEnergy login may have failed — no redirect away from login page"
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Low-level fetch that also returns Set-Cookie headers */
async function fetchRaw(url: string, timeoutMs = 15000): Promise<{ text: string; cookies: string[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const cookies: string[] = [];
    res.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") cookies.push(value);
    });
    return { text: await res.text(), cookies };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a URL with the stored AltEnergy session cookies attached */
async function fetchAltEnergy(url: string, timeoutMs = 15000): Promise<string> {
  // Re-login if session has expired or was never established
  if (Date.now() > altEnergySessionExpiry || altEnergyCookies.length === 0) {
    await loginAltEnergy();
  }
  if (!altEnergyAuthenticated) {
    throw new Error("AltEnergy authentication failed");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Cookie: altEnergyCookies.join("; "),
      },
    });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

interface ScrapedProject {
  name: string;
  description: string;
  capacityMw: number | null;
  developer: string | null;
  location: string | null;
  country: "AU" | "NZ";
  status: "announced" | "under_development";
  sourceUrl: string;
  sourceName: string;
  announcedDate: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

interface ScrapeSource {
  name: string;
  country: "AU" | "NZ";
  searchUrl: string;
  feedUrl?: string;
  /** If true, use the authenticated AltEnergy session for all fetches */
  authenticated?: boolean;
  /** Extra URLs to scrape in addition to searchUrl (e.g. category pages) */
  extraUrls?: string[];
  /**
   * If true, use the Firecrawl API (FIRECRAWL_API_KEY) instead of raw fetch+Cheerio.
   * Firecrawl renders JavaScript and returns clean markdown — ideal for government
   * portals and industry sites that don't expose a usable RSS feed or HTML article list.
   */
  firecrawl?: boolean;
  /**
   * Browse.AI robot ID to use for this source.
   * The robot must be pre-configured in the Browse.AI dashboard
   * (https://browse.ai) with an `originUrl` input parameter.
   * When set, the robot is run against searchUrl (and each extraUrl if present).
   * Browse.AI renders full JavaScript and returns structured table data — ideal for
   * government planning portals that block standard scrapers.
   *
   * Required column names in the Browse.AI robot (case-insensitive, partial match):
   *   "name" / "project name" / "title"  → project name
   *   "capacity" / "mw" / "size"         → MW capacity
   *   "status" / "stage" / "phase"       → development status
   *   "state" / "location" / "region"    → location
   *   "developer" / "proponent" / "applicant" → developer
   *   "url" / "link"                     → project detail URL
   */
  browseAiRobotId?: string;
}

type ScanSourceOutcome =
  | "attempted"
  | "success"
  | "empty"
  | "fallback-used"
  | "extraction-failed"
  | "blocked"
  | "timeout"
  | "skipped-missing-credentials"
  | "error";

function logScanSourceOutcome(
  source: string,
  outcome: ScanSourceOutcome,
  details: {
    projectCount?: number;
    durationMs?: number;
    method?: string;
    url?: string;
    reason?: string;
    missing?: string[];
    err?: unknown;
  } = {},
): void {
  const context = { source, outcome, ...details };
  if (["error", "blocked", "timeout", "extraction-failed", "skipped-missing-credentials"].includes(outcome)) {
    logger.warn(context, "Scan source outcome");
  } else {
    logger.info(context, "Scan source outcome");
  }
}

/**
 * Approved source whitelist — only these sources are scanned.
 * See replit.md for the full approved source list.
 */
const SOURCES: ScrapeSource[] = [
  // ── News / Industry ───────────────────────────────────────────────────────
  {
    name: "Renew Economy",
    country: "AU",
    searchUrl: "https://reneweconomy.com.au/?s=solar+project+announced",
    feedUrl: "https://reneweconomy.com.au/feed/",
  },
  {
    name: "PV Magazine Australia",
    country: "AU",
    searchUrl: "https://www.pv-magazine-australia.com/?s=solar+project",
    feedUrl: "https://www.pv-magazine-australia.com/feed/",
  },
  {
    name: "EcoGeneration",
    country: "AU",
    searchUrl: "https://www.ecogeneration.com.au/category/projects/solar-projects/",
    feedUrl: "https://www.ecogeneration.com.au/category/projects/solar-projects/feed/",
  },
  {
    name: "Utility Magazine",
    country: "AU",
    searchUrl: "https://utilitymagazine.com.au/category/electricity/solar/",
    feedUrl: "https://utilitymagazine.com.au/category/electricity/solar/feed/",
  },
  {
    name: "ESD News",
    country: "AU",
    searchUrl: "https://esdnews.com.au/tag/solar/",
    feedUrl: "https://esdnews.com.au/feed/",
  },
  {
    // RenewMap is a JS map app — static fetch won't work; use their resources feed instead
    name: "RenewMap",
    country: "AU",
    searchUrl: "https://renewmap.com.au/resources/",
    feedUrl: "https://renewmap.com.au/feed/",
  },
  // AltEnergy is handled by scrapeAltEnergy() — omit from generic SOURCES
  // so it doesn't go through the generic HTML parser
  {
    name: "ARENA",
    country: "AU",
    searchUrl: "https://arena.gov.au/news/?s=solar+project",
    feedUrl: "https://arena.gov.au/feed/",
    extraUrls: [
      "https://arena.gov.au/news/?s=solar+farm",
    ],
  },
  // ── Government / Regulatory ──────────────────────────────────────────────
  {
    name: "Clean Energy Regulator",
    country: "AU",
    searchUrl: "https://cer.gov.au/markets/reports-and-data/large-scale-renewable-energy-data",
  },
  {
    name: "AEMO",
    country: "AU",
    searchUrl: "https://www.aemo.com.au/energy-systems/electricity/national-electricity-market-nem/nem-forecasting-and-planning/forecasting-and-planning-data/generation-information",
  },
  {
    // DCCEEW pages are government portals — Firecrawl consistently times out on these URLs.
    name: "Capacity Investment Scheme",
    country: "AU",
    searchUrl: "https://www.dcceew.gov.au/energy/renewable/capacity-investment-scheme/closed-cis-tenders",
    extraUrls: [
      "https://www.dcceew.gov.au/environment/epbc/advice/renewable-energy-projects",
      "https://www.dcceew.gov.au/energy/renewable/priority-list",
    ],
  },
  {
    // EPBC portal is a JS-rendered search app — static fetch yields no project rows.
    name: "EPBC Act Referrals",
    country: "AU",
    searchUrl: "https://epbcpublicportal.environment.gov.au/all-referrals/",
  },
  {
    // data.gov.au dataset catalogue page — static HTML, no per-project MW data inline.
    name: "EPBC Referrals Spatial Database",
    country: "AU",
    searchUrl: "https://data.gov.au/data/dataset/referrals-spatial-database",
  },
  {
    name: "NSW Planning Portal",
    country: "AU",
    searchUrl: "https://www.planningportal.nsw.gov.au/major-projects/projects",
  },
  {
    name: "NSW Planning Renewable Energy",
    country: "AU",
    searchUrl: "https://www.planning.nsw.gov.au/the-planning-system/renewable-energy",
  },
  {
    // JS-rendered planning portal — Firecrawl consistently times out.
    name: "Planning Victoria",
    country: "AU",
    searchUrl: "https://www.planning.vic.gov.au/guides-and-resources/guides/all-guides/renewable-energy-facilities/solar-energy-facilities",
  },
  {
    name: "QLD Coordinator-General",
    country: "AU",
    searchUrl: "https://www.coordinatorgeneral.qld.gov.au/projects/find-a-project/current-coordinated-projects",
  },
  {
    name: "SA Energy & Mining",
    country: "AU",
    searchUrl: "https://www.energymining.sa.gov.au/industry/hydrogen-and-renewable-energy/large-scale-generation-and-storage/solar-energy-projects",
  },
  {
    name: "WA EPA",
    country: "AU",
    searchUrl: "https://www.epa.wa.gov.au/proposal-search",
  },
  {
    name: "NT Development Applications",
    country: "AU",
    searchUrl: "https://www.ntlis.nt.gov.au/planning",
  },
  {
    name: "Tasmania EPA",
    country: "AU",
    searchUrl: "https://epa.tas.gov.au/business-industry/assessment/proposals-assessed-by-the-epa",
  },
  // ── Industry / Data Platforms ─────────────────────────────────────────────
  {
    // JS-rendered app — Firecrawl times out; plain HTML also returns nothing useful.
    name: "Planning Alerts Australia",
    country: "AU",
    searchUrl: "https://www.planningalerts.org.au/",
  },
  {
    // CEC pages are JS-rendered membership portals / PDF downloads — Firecrawl consistently
    // times out (30 s) and returns 0 projects even when it does respond. Use plain HTML.
    name: "Clean Energy Council",
    country: "AU",
    searchUrl: "https://cleanenergycouncil.org.au/advocacy/large-scale-solar",
  },
  {
    // QLD Planning is a JS-rendered gov portal — Firecrawl times out consistently.
    name: "QLD Planning – Renewable Energy",
    country: "AU",
    searchUrl: "https://www.planning.qld.gov.au/planning-framework/state-assessment-and-referral-agency/sara-submissions-portal",
  },
  {
    name: "Smart Energy Council",
    country: "AU",
    searchUrl: "https://smartenergy.org.au/news/",
    feedUrl: "https://smartenergy.org.au/feed/",
  },
  {
    name: "Energy Magazine",
    country: "AU",
    searchUrl: "https://www.energymagazine.com.au/?s=solar+project",
    feedUrl: "https://www.energymagazine.com.au/feed/",
  },
  {
    name: "NZ Electricity Authority",
    country: "NZ",
    searchUrl: "https://www.ea.govt.nz/data-and-insights/charts-and-dashboards/generation-investment-pipeline/",
  },
  {
    name: "Transpower NZ",
    country: "NZ",
    searchUrl: "https://www.transpower.co.nz/connections/whats-latest-grid-connections",
  },
  {
    // Cloudflare-protected — requires Browse.AI robot.
    // Set browseAiRobotId once the robot is created at https://app.browse.ai
    // Robot columns: Project Name | Capacity | Status | Region | Developer | URL
    name: "NZ Fast-track",
    country: "NZ",
    searchUrl: "https://www.fasttrack.govt.nz/projects/",
    // browseAiRobotId: "TODO",
  },
  {
    // Legacy COVID-era / NBEA fast-track consenting referrals.
    // Cloudflare-protected — requires Browse.AI robot.
    name: "NZ EPA – Fast-track Projects",
    country: "NZ",
    searchUrl: "https://www.epa.govt.nz/fast-track-consenting/fast-track-projects/",
    // browseAiRobotId: "TODO",
  },
  {
    // Pre-2024 pathway: RMA Proposals of National Significance.
    // Cloudflare-protected — requires Browse.AI robot.
    name: "NZ EPA – RMA Proposals",
    country: "NZ",
    searchUrl: "https://www.epa.govt.nz/industry-areas/rma-proposals/",
    // browseAiRobotId: "TODO",
  },
  {
    // Broader EPA consultations aggregator — catches projects not listed elsewhere.
    // Cloudflare-protected — requires Browse.AI robot.
    name: "NZ EPA – Public Consultations",
    country: "NZ",
    searchUrl: "https://www.epa.govt.nz/public-consultations/",
    // browseAiRobotId: "TODO",
  },
  {
    name: "NZ Ministry for the Environment",
    country: "NZ",
    searchUrl: "https://environment.govt.nz/acts-and-regulations/acts/fast-track-approvals/fast-track-projects/",
  },
];

export const CONFIGURED_SCAN_SOURCE_NAMES = [
  ...SOURCES.map((source) => source.name),
  "AltEnergy Australia",
  LUVI_SOURCE_NAME,
] as const;

// Keywords that indicate a project is in early stage (not yet generating)
const EARLY_STAGE_KEYWORDS = [
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
const EXCLUDE_KEYWORDS = [
  "fully operational", "now generating", "commissioned",
  "now online", "now operating", "energised", "energized",
  "connected to grid", "switched on", "now generating power",
];

// Capacity extraction regex: matches "200 MW", "1.2GW", "500MW", "50 megawatt"
const CAPACITY_RE = /(\d+(?:\.\d+)?)\s*(mw|gw|megawatt|gigawatt)/gi;

// Common AU/NZ solar states and regions for location inference
const AU_LOCATIONS = [
  "NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT",
  "New South Wales", "Victoria", "Queensland", "South Australia",
  "Western Australia", "Tasmania", "Northern Territory",
];
const NZ_LOCATIONS = [
  "Auckland", "Wellington", "Canterbury", "Otago", "Waikato",
  "Bay of Plenty", "Manawatu", "Hawke's Bay", "Marlborough",
  "Northland", "Southland",
];

function extractCapacity(text: string): number | null {
  const matches = [...text.matchAll(CAPACITY_RE)];
  if (!matches.length) return null;

  const match = matches[0];
  let value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith("g")) value *= 1000; // GW → MW

  return value;
}

function extractLocation(text: string, country: "AU" | "NZ"): string | null {
  const candidates = country === "AU" ? AU_LOCATIONS : NZ_LOCATIONS;
  for (const loc of candidates) {
    if (text.includes(loc)) return loc;
  }
  return null;
}

function isEarlyStage(text: string): boolean {
  const lower = text.toLowerCase();
  const hasExclude = EXCLUDE_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasExclude) return false;
  return EARLY_STAGE_KEYWORDS.some((kw) => lower.includes(kw));
}

function determineStatus(text: string): "announced" | "under_development" {
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

function extractDeveloper(text: string): string | null {
  // Look for common company patterns near solar keywords
  const patterns = [
    /(?:by|developer?|developed by|from)\s+([A-Z][A-Za-z\s&]+(?:Energy|Solar|Power|Renewables|Green|Clean|Capital|Group|Ltd|Pty|Inc|Corp|Co\.|Company)?)/,
    /([A-Z][A-Za-z\s&]+(?:Energy|Solar|Power|Renewables|Green|Clean|Capital|Group|Ltd|Pty))/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const candidate = match[1].trim();
      if (candidate.length > 3 && candidate.length < 60) {
        return candidate;
      }
    }
  }
  return null;
}

class SourceRequestError extends Error {
  constructor(
    message: string,
    readonly problem: SourceResponseProblem,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SourceRequestError";
  }
}

async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SolarTrackerBot/1.0; +https://solar-tracker.replit.app)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const text = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    const problem = classifySourceResponse(response.status, contentType, text);
    if (problem) {
      throw new SourceRequestError(
        `Source response rejected: ${problem} (${response.status})`,
        problem,
        response.url || url,
        response.status,
      );
    }
    return text;
  } catch (err) {
    if (err instanceof SourceRequestError) throw err;
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new SourceRequestError("Source request timed out", "timeout", url);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function parseRssFeed(xml: string, source: ScrapeSource, startDate?: string, endDate?: string): ScrapedProject[] {
  const projects: ScrapedProject[] = [];

  // Extract items from RSS
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);

  for (const itemMatch of itemMatches) {
    const item = itemMatch[1];

    const titleMatch = item.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>|<title[^>]*>(.*?)<\/title>/i);
    const linkMatch = item.match(/<link[^>]*>(.*?)<\/link>|<link[^>]*\/>/i);
    const descMatch = item.match(/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description[^>]*>([\s\S]*?)<\/description>/i);
    const pubDateMatch = item.match(/<pubDate[^>]*>(.*?)<\/pubDate>/i);

    const title = (titleMatch?.[1] ?? titleMatch?.[2] ?? "").trim();
    const link = (linkMatch?.[1] ?? "").trim();
    const rawDesc = (descMatch?.[1] ?? descMatch?.[2] ?? "").trim();
    const pubDate = pubDateMatch?.[1]?.trim();

    // Strip HTML tags from description
    const desc = rawDesc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 800);

    if (!title || !link) continue;

    // Check if it's solar-related
    const fullText = `${title} ${desc}`;
    const lower = fullText.toLowerCase();
    if (!lower.includes("solar") && !lower.includes("photovoltaic") && !lower.includes(" pv ")) continue;

    // Exclude clearly operational articles (commissioned, now generating, etc.)
    // Don't require positive early-stage keywords — news articles from trusted
    // solar publications are implicitly project-relevant if they mention solar.
    if (EXCLUDE_KEYWORDS.some((kw) => lower.includes(kw))) continue;

    // Parse date
    let announcedDate: string;
    let dateParsed = false;
    try {
      if (pubDate) {
        const d = new Date(pubDate);
        if (!isNaN(d.getTime())) {
          announcedDate = d.toISOString().slice(0, 10);
          dateParsed = true;
        } else {
          announcedDate = new Date().toISOString().slice(0, 10);
        }
      } else {
        announcedDate = new Date().toISOString().slice(0, 10);
      }
    } catch {
      announcedDate = new Date().toISOString().slice(0, 10);
    }

    // When a date-range filter is active, skip items with no parseable publication date.
    // Without this, the new Date() fallback always passes the startDate check.
    if (!dateParsed && (startDate || endDate)) continue;
    if (startDate && announcedDate < startDate) continue;
    if (endDate && announcedDate > endDate) continue;

    const capacityMw = extractCapacity(fullText);
    const location = extractLocation(fullText, source.country);
    const developer = extractDeveloper(fullText);
    const status = determineStatus(fullText);

    projects.push({
      name: title,
      description: desc,
      capacityMw,
      developer,
      location,
      country: source.country,
      status,
      sourceUrl: link,
      sourceName: source.name,
      announcedDate,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
    });
  }

  return projects;
}

/** Pick the right fetch function based on whether the source needs auth */
async function fetchForSource(source: ScrapeSource, url: string): Promise<string> {
  return source.authenticated ? fetchAltEnergy(url) : fetchWithTimeout(url);
}

// ---------------------------------------------------------------------------
// Dedicated AltEnergy scraper
// ---------------------------------------------------------------------------

const MONTH_MAP: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

/**
 * Parse AltEnergy's date format: "Published Date: 2026-June-12, Friday"
 * Returns "YYYY-MM-DD" or today's date as fallback.
 */
function parseAltEnergyDate(raw: string): string {
  // Format: "2026-June-12"
  const m = raw.match(/(\d{4})-([A-Za-z]+)-(\d{1,2})/);
  if (m) {
    const month = MONTH_MAP[m[2].toLowerCase()];
    if (month) {
      return `${m[1]}-${month}-${m[3].padStart(2, "0")}`;
    }
  }
  // Fallback: try JS Date parse
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch { /* ignore */ }
  return new Date().toISOString().slice(0, 10);
}

/**
 * Parse the AltEnergy news listing page HTML.
 * Extracts article cards from `<div class="news-block-four">` blocks.
 * Returns a list of { title, url, date } entries.
 */
function parseAltEnergyListing(html: string): Array<{ title: string; url: string; date: string }> {
  const results: Array<{ title: string; url: string; date: string }> = [];

  const blockRe = /<div[^>]*class="[^"]*news-block-four[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;

  for (const block of html.matchAll(blockRe)) {
    const inner = block[1];

    // Extract URL from the first <a href> in the block
    const linkMatch = inner.match(/href="(https?:\/\/altenergy\.com\.au\/newsandviews\/show\/[^"]+)"/i);
    if (!linkMatch) continue;
    const url = linkMatch[1];

    // Extract title from <h3> or <h2>
    const titleMatch = inner.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i);
    const title = (titleMatch?.[1] ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) continue;

    // Extract date from "Published Date: 2026-June-12"
    const dateMatch = inner.match(/Published\s+Date:\s*([\d]+-[A-Za-z]+-[\d]+)/i);
    const date = dateMatch ? parseAltEnergyDate(dateMatch[1]) : new Date().toISOString().slice(0, 10);

    results.push({ title, url, date });
  }

  return results;
}

/**
 * Fetch an individual AltEnergy article and extract its full body text.
 */
async function fetchAltEnergyArticleBody(url: string): Promise<string> {
  const html = await fetchAltEnergy(url);
  // The article body is in <div class="lower-box"> or <div class="post-details">
  const bodyMatch = html.match(
    /<div[^>]*class="[^"]*(?:lower-box|post-details|blog-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i
  );
  if (!bodyMatch) return "";
  return bodyMatch[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

/** Solar-related keywords to check in AltEnergy article titles */
const SOLAR_TITLE_KEYWORDS = [
  "solar", "pv", "photovoltaic", "hybrid solar",
  "solar farm", "solar park", "solar project", "solar and battery", "solar bess",
];

// ---------------------------------------------------------------------------
// AltEnergy Project Database (kilowatt_subcribers / megawatt_subscribers)
// — project data is embedded as `var project = [...]` JavaScript in the page
// ---------------------------------------------------------------------------

interface AltEnergyProjectRecord {
  id: number;
  energy_id: number;
  type: string;
  project_name: string;
  country: string;
  capacity: string;
  capacity_mwh: string;
  description: string;
  developer: string;
  owner: string;
  location: string;
  state: string;
  status: string;
  epc_lead_contractor: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  updated_at: string;
  created_at: string;
  new_updates: string | null;
}

/** energy_ids we consider "solar or closely related" */
const SOLAR_ENERGY_IDS = new Set([1, 4, 9]); // solar-pv, solar-thermal, (hybrid)

/** Wind energy IDs — excluded from all scraping */
const WIND_ENERGY_IDS = new Set([2, 3]); // kept for reference only — not ingested

/**
 * Extract the embedded `var project = [...]` JSON from an AltEnergy page.
 */
function parseAltEnergyProjectDb(html: string): AltEnergyProjectRecord[] {
  const match = html.match(/var project\s*=\s*(\[[\s\S]*?\]);\s*(?:var|\/\/|$)/);
  if (!match) return [];
  try {
    return JSON.parse(match[1]) as AltEnergyProjectRecord[];
  } catch {
    return [];
  }
}

/**
 * Parse the watt_news listing page to extract newsletter article URLs.
 * Returns { url, date } pairs where date is parsed from the title.
 * Uses multiple fallback strategies to handle AltEnergy HTML structure changes.
 */
function parseWattNewsListing(html: string): Array<{ url: string; date: string }> {
  const seen = new Set<string>();
  const results: Array<{ url: string; date: string }> = [];

  const addResult = (url: string, dateStr: string) => {
    if (seen.has(url)) return;
    seen.add(url);
    results.push({ url, date: dateStr });
  };

  // Strategy 1: Original pdf-block-watts-new div structure
  const blockRe = /<div[^>]*class="[^"]*pdf-block-watts-new[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
  for (const block of html.matchAll(blockRe)) {
    const inner = block[1];
    const linkMatch = inner.match(/href="(https?:\/\/altenergy\.com\.au\/watt_news\/show\/[^"]+)"/i);
    if (!linkMatch) continue;
    const url = linkMatch[1];
    const titleMatch = inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const title = titleMatch?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
    const dateMatch = title.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    let date = new Date().toISOString().slice(0, 10);
    if (dateMatch) {
      const month = MONTH_MAP[dateMatch[2].toLowerCase()];
      if (month) date = `${dateMatch[3]}-${month}-${dateMatch[1].padStart(2, "0")}`;
    }
    addResult(url, date);
  }

  // Strategy 2: Any href to /watt_news/show/ anywhere on the page, with nearby date text
  const allLinkRe = /href="(https?:\/\/altenergy\.com\.au\/watt_news\/show\/[^"]+)"/gi;
  for (const linkMatch of html.matchAll(allLinkRe)) {
    const url = linkMatch[1];
    if (seen.has(url)) continue;
    // Look for a date within 500 chars around the link
    const idx = linkMatch.index ?? 0;
    const context = html.slice(Math.max(0, idx - 200), idx + 300).replace(/<[^>]+>/g, " ");
    const dateMatch = context.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    let date = new Date().toISOString().slice(0, 10);
    if (dateMatch) {
      const month = MONTH_MAP[dateMatch[2].toLowerCase()];
      if (month) date = `${dateMatch[3]}-${month}-${dateMatch[1].padStart(2, "0")}`;
    }
    addResult(url, date);
  }

  return results;
}

/**
 * Fetch a Watts News article and extract its full HTML body text.
 * The content is in the main article section.
 */
async function fetchWattNewsArticleText(url: string): Promise<string> {
  const html = await fetchAltEnergy(url);
  // Content is in div with class containing "blog-details", "post-details", or similar
  const bodyMatch = html.match(
    /<div[^>]*class="[^"]*(?:post-content|blog-details|content-box|lower-section)[^"]*"[^>]*>([\s\S]*?)<\/section>/i
  ) ?? html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (bodyMatch) {
    return bodyMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);
  }
  // Fallback: strip all HTML and return meaningful text
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 3000);
}

/**
 * Main dedicated scraper for AltEnergy's authenticated sections.
 * Handles three distinct data sources:
 *  1. /newsandviews  — article cards with `news-block-four` structure
 *  2. /kilowatt_subcribers — inline project JSON (`var project = [...]`)
 *  3. /watt_news — weekly newsletters with project update content
 */
export async function scrapeAltEnergy(
  startDate?: string,
  endDate?: string
): Promise<ScrapedProject[]> {
  const missingCredentials = ["ALTENERGY_USERNAME", "ALTENERGY_PASSWORD"]
    .filter((key) => !process.env[key]?.trim());
  if (missingCredentials.length > 0) {
    logScanSourceOutcome("AltEnergy Australia", "skipped-missing-credentials", {
      missing: missingCredentials,
    });
    return [];
  }

  const projects: ScrapedProject[] = [];
  const seenUrls = new Set<string>();

  logger.info("Starting AltEnergy authenticated scrape");

  // ── 1. /newsandviews — article cards ─────────────────────────────────────
  try {
    const html = await fetchAltEnergy("https://altenergy.com.au/newsandviews");
    const cards = parseAltEnergyListing(html);
    logger.info({ cards: cards.length }, "AltEnergy newsandviews listing parsed");

    for (const card of cards) {
      if (seenUrls.has(card.url)) continue;
      if (startDate && card.date < startDate) continue;
      if (endDate && card.date > endDate) continue;

      const titleLower = card.title.toLowerCase();
      if (!SOLAR_TITLE_KEYWORDS.some((kw) => titleLower.includes(kw))) continue;

      // Newsandviews titles are article headlines — only keep ones that look like project names
      if (isNoisyProjectName(card.title, /* requireProjectShape */ true)) continue;

      let body = "";
      try {
        body = await fetchAltEnergyArticleBody(card.url);
      } catch (err) {
        logger.warn({ err, url: card.url }, "AltEnergy article fetch failed");
      }

      const fullText = `${card.title} ${body}`;
      if (!isEarlyStage(fullText)) continue;

      seenUrls.add(card.url);
      projects.push({
        name: card.title,
        description: body.slice(0, 600) || card.title,
        capacityMw: extractCapacity(fullText),
        developer: extractDeveloper(fullText),
        location: extractLocation(fullText, "AU"),
        country: "AU",
        status: determineStatus(fullText),
        sourceUrl: card.url,
        sourceName: "AltEnergy Australia",
        announcedDate: card.date,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
      });
    }
  } catch (err) {
    logger.warn({ err }, "AltEnergy newsandviews scrape failed");
  }

  // ── 2. /kilowatt_subcribers — inline project JSON database ───────────────
  try {
    const html = await fetchAltEnergy("https://altenergy.com.au/kilowatt_subcribers");
    const records = parseAltEnergyProjectDb(html);
    logger.info({ total: records.length }, "AltEnergy project DB records found");

    for (const rec of records) {
      const url = `https://altenergy.com.au/projectdata/show/${rec.id}`;
      if (seenUrls.has(url)) continue;

      // Only solar-related energy types (no wind)
      if (!SOLAR_ENERGY_IDS.has(rec.energy_id)) continue;

      // Only In Development / announced projects
      const typeStr = (rec.type ?? "").toLowerCase();
      const statusStr = (rec.status ?? "").toLowerCase();
      const earlyStageRecord =
        typeStr.includes("in development") ||
        typeStr.includes("announced") ||
        typeStr.includes("planning") ||
        typeStr.includes("proposed") ||
        statusStr.includes("in development") ||
        statusStr.includes("under development") ||
        statusStr.includes("announced") ||
        statusStr.includes("planning");
      if (!earlyStageRecord) continue;

      // Date range filter: use updated_at (format "2026-03-09 23:00:28")
      if (startDate || endDate) {
        const updatedDate = (rec.updated_at ?? "").slice(0, 10);
        if (startDate && updatedDate < startDate) continue;
        if (endDate && updatedDate > endDate) continue;
      }

      seenUrls.add(url);
      const capacityNum = parseFloat(rec.capacity);

      // Enforce >=5 MW minimum (skip projects with known sub-5MW capacity)
      if (!isNaN(capacityNum) && capacityNum < 5) continue;

      const country = rec.country === "NZ" ? "NZ" : "AU";
      const location = [rec.location, rec.state].filter(Boolean).join(", ");

      projects.push({
        name: rec.project_name,
        description: (rec.description ?? "").slice(0, 600),
        capacityMw: isNaN(capacityNum) ? null : capacityNum,
        developer: rec.developer || rec.owner || null,
        location: location || null,
        country,
        status: rec.type === "In Development" ? "under_development" : determineStatus(rec.type + " " + rec.status),
        sourceUrl: url,
        sourceName: "AltEnergy Australia",
        announcedDate: (rec.updated_at ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10),
        contactName: rec.contact_name ?? null,
        contactEmail: isValidProjectContact(rec.contact_email, rec.developer || rec.owner) ? rec.contact_email : null,
        contactPhone: rec.contact_phone ?? null,
      });
    }
    logger.info({ added: projects.length }, "AltEnergy project DB scrape complete");
  } catch (err) {
    logger.warn({ err }, "AltEnergy project DB scrape failed");
  }

  // ── 3. /watt_news — weekly newsletters ───────────────────────────────────
  try {
    const html = await fetchAltEnergy("https://altenergy.com.au/watt_news");
    const newsletters = parseWattNewsListing(html);
    logger.info({ newsletters: newsletters.length }, "AltEnergy watt_news listing parsed");

    for (const newsletter of newsletters) {
      if (startDate && newsletter.date < startDate) continue;
      if (endDate && newsletter.date > endDate) continue;
      if (seenUrls.has(newsletter.url)) continue;
      seenUrls.add(newsletter.url);

      try {
        const newsletterHtml = await fetchAltEnergy(newsletter.url);
        let foundInNewsletter = 0;

        // 3a. Parse the Project Milestones Summary table (top of every newsletter).
        //     This catches all newly-added projects even if they have no dedicated article section.
        const milestoneProjs = parseWattNewsMilestonesTable(newsletterHtml, newsletter.date, newsletter.url);
        for (const p of milestoneProjs) {
          if (!seenUrls.has(p.sourceUrl)) {
            seenUrls.add(p.sourceUrl);
            projects.push(p);
            foundInNewsletter++;
            logger.info({ name: p.name }, "Watt News milestones table: project found");
          }
        }

        // 3b. Parse "NEW PROJECT:" and "PROJECT UPDATE:" article sections from the body text.
        //     Strip HTML and increase limit to capture full newsletter content.
        const text = newsletterHtml
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 20000);

        const sections = text.split(/(?=NEW PROJECT:|PROJECT UPDATE:|PROJECT MILESTONE:)/i);
        for (const section of sections) {
          const isNew = /^NEW PROJECT:/i.test(section);
          const isUpdate = /^PROJECT UPDATE:/i.test(section);
          if (!isNew && !isUpdate) continue;

          const snippet = section.slice(0, 700);
          const sectionLower = snippet.toLowerCase();

          // Must have a solar keyword in the section
          if (!SOLAR_TITLE_KEYWORDS.some((kw) => sectionLower.includes(kw))) continue;

          const nameMatch = section.match(/^(?:NEW PROJECT|PROJECT UPDATE|PROJECT MILESTONE):\s*([^\n.]+)/i);
          const name = nameMatch?.[1]?.trim();
          if (!name || name.length < 5) continue;

          const projectUrl = `${newsletter.url}#${encodeURIComponent(name.slice(0, 40))}`;
          if (seenUrls.has(projectUrl)) continue;
          seenUrls.add(projectUrl);

          const capacityMw = extractCapacity(snippet);
          if (capacityMw == null || capacityMw < 5) continue;

          projects.push({
            name,
            description: snippet.replace(/^[^\n]+\n/, "").trim().slice(0, 600),
            capacityMw,
            developer: extractDeveloper(snippet),
            location: extractLocation(snippet, "AU"),
            country: "AU",
            status: isNew ? "announced" : "under_development",
            sourceUrl: projectUrl,
            sourceName: "AltEnergy – Watts News",
            announcedDate: newsletter.date,
            contactName: null,
            contactEmail: null,
            contactPhone: null,
          });
          foundInNewsletter++;
        }

        // 3c. ChatGPT fallback — fires when HTML parsing found nothing for this newsletter.
        //     Sends the stripped page text to GPT-4o for project extraction.
        if (foundInNewsletter === 0) {
          logger.info({ url: newsletter.url }, "Watt News HTML parsing found 0 projects — trying ChatGPT fallback");
          const gptProjs = await parseWattNewsWithChatGpt(text, newsletter.date, newsletter.url);
          for (const p of gptProjs) {
            if (!seenUrls.has(p.sourceUrl)) {
              seenUrls.add(p.sourceUrl);
              projects.push(p);
              logger.info({ name: p.name }, "Watt News ChatGPT fallback: project found");
            }
          }
        }
      } catch (err) {
        logger.warn({ err, url: newsletter.url }, "Watt News article fetch failed");
      }
    }
  } catch (err) {
    logger.warn({ err }, "AltEnergy watt_news scrape failed");
  }

  logger.info({ total: projects.length }, "AltEnergy scrape complete");
  if (!altEnergyAuthenticated) throw new Error("AltEnergy authenticated source was not accessible");
  return projects;
}

interface LuviPipelineProject {
  name?: unknown;
  category?: unknown;
  type?: unknown;
  subtype?: unknown;
  status?: unknown;
  state?: unknown;
  location?: unknown;
  owner?: unknown;
  capacity?: unknown;
  capacityRaw?: unknown;
  epc?: unknown;
}

/**
 * Scrape LUVI's password-protected development pipeline.
 *
 * LUVI publishes the pipeline as base64-encoded JSON XOR-encrypted with the
 * client password. This mirrors LUVI's own browser-side decryption flow and
 * avoids browser automation while keeping the password server-side.
 */
export async function scrapeLuvi(
  startDate?: string,
  endDate?: string
): Promise<ScrapedProject[]> {
  const password = process.env.LUVI_PASSWORD;
  if (!password) {
    logger.warn("LUVI_PASSWORD not set — skipping LUVI pipeline scrape");
    return [];
  }

  try {
    const encrypted = (await fetchRaw(LUVI_PIPELINE_URL, 20_000)).text.trim();
    if (!encrypted) {
      logger.warn("LUVI pipeline returned an empty encrypted payload");
      return [];
    }

    const cipher = Buffer.from(encrypted, "base64");
    const plain = Buffer.alloc(cipher.length);
    for (let i = 0; i < cipher.length; i++) {
      plain[i] = cipher[i] ^ password.charCodeAt(i % password.length);
    }

    const records = JSON.parse(plain.toString("utf8")) as unknown;
    if (!Array.isArray(records)) {
      logger.warn("LUVI pipeline payload was not a JSON array");
      return [];
    }

    const today = new Date().toISOString().slice(0, 10);
    const projects: ScrapedProject[] = [];
    const seenNames = new Set<string>();

    for (const raw of records as LuviPipelineProject[]) {
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      const category = typeof raw.category === "string" ? raw.category.trim() : "";
      const type = typeof raw.type === "string" ? raw.type.trim() : "";
      const subtype = typeof raw.subtype === "string" ? raw.subtype.trim() : "";
      const status = typeof raw.status === "string" ? raw.status.trim() : "";
      const capacityValue =
        typeof raw.capacity === "number"
          ? raw.capacity
          : typeof raw.capacity === "string"
            ? Number.parseFloat(raw.capacity)
            : null;

      if (!name || category !== "Energy" || !LUVI_PIPELINE_STATUSES.has(status)) continue;
      if (!Number.isFinite(capacityValue) || capacityValue === null || capacityValue < 5) continue;

      // LUVI also carries standalone BESS, wind, hydrogen and hydro records.
      // The shared gate keeps only solar or solar+BESS projects.
      const projectText = `${name} ${type} ${subtype}`;
      if (!hasSolarComponent(projectText) || isWindProject(name, projectText)) continue;

      const normalizedName = name.toLowerCase();
      if (seenNames.has(normalizedName)) continue;
      seenNames.add(normalizedName);

      const slug = encodeURIComponent(normalizedName);
      const sourceUrl = `${LUVI_PROJECTS_URL}#${slug}`;
      const location = [raw.location, raw.state]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
        .join(", ") || null;
      const developer =
        typeof raw.owner === "string" && raw.owner.trim().length > 0
          ? raw.owner.trim()
          : null;
      const description = [
        `${type}${subtype && subtype !== type ? ` — ${subtype}` : ""}`,
        status,
        location,
        typeof raw.capacityRaw === "string" ? `${raw.capacityRaw} MW` : `${capacityValue} MW`,
      ]
        .filter(Boolean)
        .join(" · ");

      projects.push({
        name,
        description: description || name,
        capacityMw: capacityValue,
        developer,
        location,
        country: "AU",
        status: status === "Proposed" ? "announced" : "under_development",
        sourceUrl,
        sourceName: LUVI_SOURCE_NAME,
        announcedDate: today,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
      });
    }

    // LUVI's data is a current snapshot without per-project announcement dates.
    // When a date window is requested, include the snapshot only if today is in it.
    if ((startDate && today < startDate) || (endDate && today > endDate)) return [];

    logger.info({ found: projects.length }, "LUVI pipeline scrape complete");
    return projects;
  } catch (err) {
    logger.warn({ err }, "LUVI pipeline scrape failed — password may be invalid or the payload changed");
    throw err;
  }
}

/** Extract project entries from an HTML page */
function parseHtmlPage(
  html: string,
  source: ScrapeSource,
  startDate?: string,
  endDate?: string
): ScrapedProject[] {
  const projects: ScrapedProject[] = [];

  const articleMatches = html.matchAll(
    /<(?:article|div|section)[^>]*class="[^"]*(?:post|article|entry|item|result)[^"]*"[^>]*>([\s\S]*?)<\/(?:article|div|section)>/gi
  );

  for (const match of articleMatches) {
    const snippet = match[1];
    const lower = snippet.toLowerCase();

    if (!lower.includes("solar") && !lower.includes("photovoltaic") && !lower.includes(" pv ")) continue;
    if (!isEarlyStage(snippet)) continue;

    const titleMatch = snippet.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
    const linkMatch = snippet.match(/href="(https?:\/\/[^"]+)"/i);
    const dateMatch = snippet.match(/(\d{4}-\d{2}-\d{2})|(\w+ \d{1,2},? \d{4})/i);

    const rawTitle = (titleMatch?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
    const link = linkMatch?.[1] ?? source.searchUrl;
    const descText = snippet.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);

    if (!rawTitle || rawTitle.length < 10) continue;

    let announcedDate: string;
    let dateParsed = false;
    try {
      if (dateMatch) {
        const d = new Date(dateMatch[0]);
        if (!isNaN(d.getTime())) {
          announcedDate = d.toISOString().slice(0, 10);
          dateParsed = true;
        } else {
          announcedDate = new Date().toISOString().slice(0, 10);
        }
      } else {
        announcedDate = new Date().toISOString().slice(0, 10);
      }
    } catch {
      announcedDate = new Date().toISOString().slice(0, 10);
    }

    if (!dateParsed && (startDate || endDate)) continue;
    if (startDate && announcedDate < startDate) continue;
    if (endDate && announcedDate > endDate) continue;

    projects.push({
      name: rawTitle,
      description: descText.slice(0, 500),
      capacityMw: extractCapacity(snippet),
      developer: extractDeveloper(snippet),
      location: extractLocation(snippet, source.country),
      country: source.country,
      status: determineStatus(snippet),
      sourceUrl: link,
      sourceName: source.name,
      announcedDate,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
    });
  }

  return projects;
}

// ──────────────────────────────────────────────────────────────
// Firecrawl helpers
// ──────────────────────────────────────────────────────────────

interface FirecrawlScrapeResponse {
  success: boolean;
  data?: {
    markdown?: string;
    metadata?: { sourceURL?: string; title?: string };
  };
  error?: string;
}

/**
 * Parse Firecrawl markdown output into ScrapedProject records.
 *
 * Firecrawl returns clean markdown with headings (`## Name`) and paragraphs.
 * We split by heading, filter for solar + capacity, and apply the same
 * noise-filtering and extraction helpers used for HTML pages.
 */
function parseFirecrawlMarkdown(
  markdown: string,
  source: ScrapeSource,
  pageUrl: string,
  startDate?: string,
  endDate?: string,
): ScrapedProject[] {
  const projects: ScrapedProject[] = [];

  // Split at every heading line (H1–H3) to get one section per potential project
  const sections = markdown.split(/\n(?=#{1,3} )/);

  for (const section of sections) {
    const lower = section.toLowerCase();

    // Must mention solar/PV
    if (!lower.includes("solar") && !lower.includes("photovoltaic") && !lower.includes(" pv ")) continue;
    // Must have a capacity figure
    const capacity = extractCapacity(section);
    if (capacity === null) continue;

    // Reject if the capacity only appears as an industry-wide aggregate statistic
    // (e.g. "10 GW cumulative large-scale solar capacity in Australia")
    // rather than as a specific project's rated capacity.
    const STAT_CONTEXT_RE =
      /\d+(?:\.\d+)?\s*(?:mw|gw|megawatt|gigawatt)\s+(?:cumulative|total|installed|of (?:solar|renewable|wind|bess|battery)|capacity in australia|capacity in new zealand|across australia)/i;
    if (STAT_CONTEXT_RE.test(section)) {
      // Only skip if there is NO separate project-specific capacity mention
      // (i.e. the only capacity match is the statistic sentence)
      const allCapMatches = [...section.matchAll(/(\d+(?:\.\d+)?)\s*(mw|gw|megawatt|gigawatt)/gi)];
      const nonStatMatches = allCapMatches.filter((m) => {
        const idx = m.index ?? 0;
        const surroundingText = section.slice(Math.max(0, idx - 60), idx + 80).toLowerCase();
        return !STAT_CONTEXT_RE.test(surroundingText);
      });
      if (nonStatMatches.length === 0) continue;
    }

    // Exclude confirmed-operational content — don't require an explicit early-stage keyword
    // (government portals use language like "under assessment" or "referred" not in keyword list)
    if (EXCLUDE_KEYWORDS.some((kw) => lower.includes(kw))) continue;

    // Project name — prefer heading, fall back to first substantive line
    const headingMatch = section.match(/^#{1,3} (.+)/m);
    let name = (headingMatch?.[1] ?? "").replace(/\*|\[|\]|`/g, "").trim();
    if (!name || name.length < 5) {
      name = section.split("\n").find((l) => l.trim().length > 10)?.trim() ?? "";
    }
    if (!name || name.length < 5) continue;
    if (isNoisyProjectName(name)) continue;
    if (!hasSolarComponent(name + " " + section)) continue;

    // Prefer an in-text hyperlink, otherwise fall back to the page URL
    const linkMatch = section.match(/\[.*?\]\((https?:\/\/[^)]+)\)/);
    const sourceUrl = linkMatch?.[1] ?? pageUrl;

    // Date extraction
    const dateMatch = section.match(/(\d{4}-\d{2}-\d{2})|(\w+ \d{1,2},? \d{4})/);
    let announcedDate: string;
    let dateParsed = false;
    try {
      if (dateMatch) {
        const d = new Date(dateMatch[0]);
        if (!isNaN(d.getTime())) {
          announcedDate = d.toISOString().slice(0, 10);
          dateParsed = true;
        } else {
          announcedDate = new Date().toISOString().slice(0, 10);
        }
      } else {
        announcedDate = new Date().toISOString().slice(0, 10);
      }
    } catch {
      announcedDate = new Date().toISOString().slice(0, 10);
    }
    if (!dateParsed && (startDate || endDate)) continue;
    if (startDate && announcedDate < startDate) continue;
    if (endDate && announcedDate > endDate) continue;

    projects.push({
      name,
      description: section.replace(/^#{1,3} .+\n?/m, "").slice(0, 500).trim(),
      capacityMw: capacity,
      developer: extractDeveloper(section),
      location: extractLocation(section, source.country),
      country: source.country,
      status: determineStatus(section),
      sourceUrl,
      sourceName: source.name,
      announcedDate,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
    });
  }

  // ── Markdown table parsing ────────────────────────────────────────────────
  // Government portals and structured listing pages (EPBC, CEC, DCCEEW, etc.)
  // render HTML tables. Firecrawl converts these to pipe-delimited markdown
  // tables — split-by-heading misses them entirely, so we parse them here.
  const tableBlockRe = /(\|[^\n]+\|\n)((?:\|[^\n]+\|\n)+)/g;
  for (const tableMatch of markdown.matchAll(tableBlockRe)) {
    const headerRow = tableMatch[1];
    const bodyRows = tableMatch[2].split("\n").filter((r) => r.trim().startsWith("|"));

    const headers = headerRow
      .split("|")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);

    const nameIdx = headers.findIndex((h) =>
      h.includes("name") || h.includes("project") || h.includes("title") || h.includes("proponent")
    );
    const capIdx = headers.findIndex((h) =>
      h.includes("capacity") || h.includes("mw") || h.includes("size") || h.includes("power")
    );

    for (const row of bodyRows) {
      // Skip separator rows like |---|---|
      if (/^\|[\s\-|]+\|$/.test(row.trim())) continue;

      const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length < 2) continue;

      const rowText = cells.join(" ");
      const rowLower = rowText.toLowerCase();

      if (!rowLower.includes("solar") && !rowLower.includes("photovoltaic") && !rowLower.includes(" pv ")) continue;
      if (EXCLUDE_KEYWORDS.some((kw) => rowLower.includes(kw))) continue;

      // Try to extract capacity from dedicated column first, then full row
      let capacity: number | null = null;
      if (capIdx >= 0 && cells[capIdx]) capacity = extractCapacity(cells[capIdx]);
      if (capacity === null) capacity = extractCapacity(rowText);
      if (capacity === null) continue;

      // Project name: prefer named column, else first cell
      let name = (nameIdx >= 0 && cells[nameIdx]) ? cells[nameIdx] : cells[0];
      // Strip markdown links
      name = name.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`]/g, "").trim();
      if (!name || name.length < 5) continue;
      if (isNoisyProjectName(name)) continue;
      if (!hasSolarComponent(name + " " + rowText)) continue;

      // Date: scan whole row for a date pattern
      const dateMatch = rowText.match(/(\d{4}-\d{2}-\d{2})|(\w+ \d{1,2},? \d{4})/);
      let announcedDate = new Date().toISOString().slice(0, 10);
      let dateParsed = false;
      if (dateMatch) {
        const d = new Date(dateMatch[0]);
        if (!isNaN(d.getTime())) {
          announcedDate = d.toISOString().slice(0, 10);
          dateParsed = true;
        }
      }
      if (!dateParsed && (startDate || endDate)) continue;
      if (startDate && announcedDate < startDate) continue;
      if (endDate && announcedDate > endDate) continue;

      const linkMatch = rowText.match(/\[.*?\]\((https?:\/\/[^)]+)\)/);
      const sourceUrl = linkMatch?.[1] ?? pageUrl;

      projects.push({
        name,
        description: rowText.slice(0, 500),
        capacityMw: capacity,
        developer: extractDeveloper(rowText),
        location: extractLocation(rowText, source.country),
        country: source.country,
        status: determineStatus(rowText),
        sourceUrl,
        sourceName: source.name,
        announcedDate,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
      });
    }
  }

  // ── Bullet / list-item parsing ───────────────────────────────────────────
  // Government portals (ARENA, planning portals, CEC) often render project
  // listings as markdown bullet lists:
  //   - [Sunraysia Solar Farm](link) – 255 MW – Under assessment
  //   * Coppabella Solar 80MW – application lodged
  // Each bullet is a self-contained project candidate.
  const bulletRe = /^[\*\-]\s+(.+)$/gm;
  for (const bulletMatch of markdown.matchAll(bulletRe)) {
    const line = bulletMatch[1].trim();
    const lower = line.toLowerCase();

    if (!lower.includes("solar") && !lower.includes("photovoltaic") && !lower.includes(" pv ")) continue;

    const capacity = extractCapacity(line);
    if (capacity === null) continue;

    if (EXCLUDE_KEYWORDS.some((kw) => lower.includes(kw))) continue;

    // Strip markdown link syntax for the name
    let name = line.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`]/g, "").trim();
    // Drop trailing MW/GW annotation and status phrases (e.g. " – 255 MW – Under assessment")
    name = name.replace(/\s*[–\-]\s*\d[\d,.]*\s*(?:mw|gw|megawatt|gigawatt).*$/i, "").trim();
    name = name.replace(/\s*[–\-]\s*(under assessment|application|referred|approved|proposed|development|planning).*$/i, "").trim();
    if (!name || name.length < 5) continue;
    if (isNoisyProjectName(name)) continue;
    if (!hasSolarComponent(name + " " + line)) continue;

    // Skip if this project was already captured by heading or table parser
    if (projects.some((p) => p.name.toLowerCase() === name.toLowerCase())) continue;

    const linkMatch = line.match(/\[.*?\]\((https?:\/\/[^)]+)\)/);
    const sourceUrl = linkMatch?.[1] ?? pageUrl;

    const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})|(\w+ \d{1,2},? \d{4})/);
    let announcedDate = new Date().toISOString().slice(0, 10);
    let dateParsed = false;
    if (dateMatch) {
      const d = new Date(dateMatch[0]);
      if (!isNaN(d.getTime())) {
        announcedDate = d.toISOString().slice(0, 10);
        dateParsed = true;
      }
    }
    if (!dateParsed && (startDate || endDate)) continue;
    if (startDate && announcedDate < startDate) continue;
    if (endDate && announcedDate > endDate) continue;

    projects.push({
      name,
      description: line.slice(0, 500),
      capacityMw: capacity,
      developer: extractDeveloper(line),
      location: extractLocation(line, source.country),
      country: source.country,
      status: determineStatus(line),
      sourceUrl,
      sourceName: source.name,
      announcedDate,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
    });
  }

  return projects;
}

/**
 * Fetch a single URL via the Firecrawl API and return parsed projects.
 * Requires FIRECRAWL_API_KEY environment variable.
 * Returns [] and logs a warning if the key is absent or the request fails.
 */
async function scrapeWithFirecrawl(
  url: string,
  source: ScrapeSource,
  startDate?: string,
  endDate?: string,
): Promise<ScrapedProject[]> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    logger.warn({ source: source.name, url }, "FIRECRAWL_API_KEY not set — skipping Firecrawl source");
    return [];
  }

  try {
    const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
      signal: AbortSignal.timeout(30_000), // 30 s hard cap per Firecrawl request
    });

    if (!resp.ok) {
      logger.warn({ status: resp.status, url, source: source.name }, "Firecrawl API request failed");
      return [];
    }

    const data = (await resp.json()) as FirecrawlScrapeResponse;
    if (!data.success || !data.data?.markdown) {
      logger.warn({ url, error: data.error, source: source.name }, "Firecrawl returned no markdown");
      return [];
    }

    const pageUrl = data.data.metadata?.sourceURL ?? url;
    const results = parseFirecrawlMarkdown(data.data.markdown, source, pageUrl, startDate, endDate);
    logger.info({ source: source.name, url, found: results.length }, "Firecrawl scrape complete");
    return results;
  } catch (err) {
    logger.warn({ err, url, source: source.name }, "Firecrawl scrape threw");
    return [];
  }
}

// ──────────────────────────────────────────────────────────────
// Browse.AI integration
// ──────────────────────────────────────────────────────────────

interface BrowseAiTaskResponse {
  statusCode: number;
  messageCode: string;
  result?: {
    id?: string;
    status?: "successful" | "failed" | "running" | "pending";
    capturedLists?: Record<string, Array<Record<string, string>>>;
    capturedTexts?: Record<string, string>;
  };
}

/** Column-name fragments Browse.AI robots use for each field (case-insensitive substring match). */
const BA_NAME_COLS    = ["project name", "name", "title", "project", "development name"];
const BA_CAP_COLS     = ["capacity", " mw", "size", "megawatt"];
const BA_STATUS_COLS  = ["status", "stage", "phase", "assessment stage", "development stage"];
const BA_LOC_COLS     = ["location", "state", "region", "address", "suburb", "area"];
const BA_DEV_COLS     = ["developer", "proponent", "applicant", "company", "organisation", "organization", "operator", "sponsor"];
const BA_URL_COLS     = ["url", "link", "href", "detail"];

function browseAiMatchCol(row: Record<string, string>, patterns: string[]): string | undefined {
  for (const key of Object.keys(row)) {
    const kl = key.toLowerCase();
    if (patterns.some((p) => kl.includes(p))) {
      const v = row[key];
      return v && v.trim() ? v.trim() : undefined;
    }
  }
  return undefined;
}

/**
 * Parse Browse.AI task result into ScrapedProject records.
 * Browse.AI returns `capturedLists` — a dict of list-name → array of row dicts.
 * Column names are defined by the robot configuration in the Browse.AI dashboard.
 */
function parseBrowseAiResult(
  result: NonNullable<BrowseAiTaskResponse["result"]>,
  source: ScrapeSource,
  pageUrl: string,
  startDate?: string,
  endDate?: string,
): ScrapedProject[] {
  const projects: ScrapedProject[] = [];
  if (!result.capturedLists) return projects;

  for (const rows of Object.values(result.capturedLists)) {
    if (!Array.isArray(rows)) continue;

    for (const row of rows) {
      const allValues = Object.values(row).join(" ");
      const allLower = allValues.toLowerCase();

      // Must mention solar / photovoltaic / PV
      if (!allLower.includes("solar") && !allLower.includes("photovoltaic") && !/\bpv\b/.test(allLower)) continue;
      // Skip exclusion keywords (operational, commissioned, etc.)
      if (EXCLUDE_KEYWORDS.some((kw) => allLower.includes(kw))) continue;

      // Must have an extractable MW capacity
      const capacityMw = extractCapacity(allValues);
      if (capacityMw === null) continue;

      // --- Project name ---
      let name = browseAiMatchCol(row, BA_NAME_COLS) ?? "";
      if (!name) {
        name = Object.values(row).find(
          (v) => typeof v === "string" && v.length > 5 && !v.startsWith("http") && !/^\d+$/.test(v.trim()),
        ) ?? "";
      }
      name = name.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim(); // strip markdown links
      if (!name || name.length < 5) continue;
      if (isNoisyProjectName(name)) continue;
      if (!hasSolarComponent(name, allValues)) continue;

      // --- Source URL ---
      const rowUrl =
        browseAiMatchCol(row, BA_URL_COLS) ??
        Object.values(row).find((v) => typeof v === "string" && v.startsWith("http")) ??
        pageUrl;

      // --- Date (government listing pages rarely include one — fall back to today) ---
      let announcedDate = new Date().toISOString().slice(0, 10);
      const dateMatch = allValues.match(/(\d{4}-\d{2}-\d{2})|(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/);
      if (dateMatch) {
        const d = new Date(dateMatch[0].replace(/\//g, "-"));
        if (!isNaN(d.getTime())) announcedDate = d.toISOString().slice(0, 10);
      }
      if (startDate && announcedDate < startDate) continue;
      if (endDate && announcedDate > endDate) continue;

      projects.push({
        name,
        description: allValues.slice(0, 600),
        capacityMw,
        developer: browseAiMatchCol(row, BA_DEV_COLS) ?? extractDeveloper(allValues),
        location: browseAiMatchCol(row, BA_LOC_COLS) ?? extractLocation(allValues, source.country),
        country: source.country,
        status: determineStatus(browseAiMatchCol(row, BA_STATUS_COLS) ?? allValues),
        sourceUrl: typeof rowUrl === "string" ? rowUrl : pageUrl,
        sourceName: source.name,
        announcedDate,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
      });
    }
  }

  return projects;
}

/**
 * Run a Browse.AI robot against a URL and return extracted solar projects.
 *
 * Flow:
 *  1. POST /v2/robots/{robotId}/tasks  — create task with originUrl
 *  2. Poll GET /v2/robots/{robotId}/tasks/{taskId} every 5 s (max 90 s)
 *  3. Parse capturedLists from the completed task
 *
 * The robot must be created and configured in the Browse.AI dashboard with
 * an `originUrl` input parameter and the column names listed in ScrapeSource.browseAiRobotId.
 */
async function scrapeWithBrowseAi(
  robotId: string,
  url: string,
  source: ScrapeSource,
  startDate?: string,
  endDate?: string,
): Promise<ScrapedProject[]> {
  const apiKey = process.env.BROWSE_AI_API_KEY;
  if (!apiKey) {
    logger.warn({ source: source.name, url }, "BROWSE_AI_API_KEY not set — skipping Browse.AI source");
    return [];
  }

  try {
    // 1. Create task
    const createResp = await fetch(`https://api.browse.ai/v2/robots/${robotId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ inputParameters: { originUrl: url } }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!createResp.ok) {
      const body = await createResp.text().catch(() => "");
      logger.warn({ status: createResp.status, robotId, url, body }, "Browse.AI task creation failed");
      return [];
    }

    const createData = (await createResp.json()) as BrowseAiTaskResponse;
    const taskId = createData.result?.id;
    if (!taskId) {
      logger.warn({ createData, robotId }, "Browse.AI: no task ID in creation response");
      return [];
    }

    logger.info({ robotId, taskId, url, source: source.name }, "Browse.AI task created — polling");

    // 2. Poll for completion (max 90 s, every 5 s = 18 attempts)
    for (let attempt = 0; attempt < 18; attempt++) {
      await new Promise((r) => setTimeout(r, 5_000));

      const pollResp = await fetch(`https://api.browse.ai/v2/robots/${robotId}/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (!pollResp.ok) {
        logger.warn({ status: pollResp.status, attempt, robotId, taskId }, "Browse.AI poll HTTP error — retrying");
        continue;
      }

      const pollData = (await pollResp.json()) as BrowseAiTaskResponse;
      const status = pollData.result?.status;

      if (status === "successful") {
        const results = parseBrowseAiResult(pollData.result!, source, url, startDate, endDate);
        logger.info({ robotId, url, found: results.length, source: source.name }, "Browse.AI task complete");
        return results;
      }

      if (status === "failed") {
        logger.warn({ robotId, taskId, url, source: source.name }, "Browse.AI task failed");
        return [];
      }

      logger.info({ attempt, status, robotId, taskId }, "Browse.AI task still running");
    }

    logger.warn({ robotId, taskId, url, source: source.name }, "Browse.AI task timed out after 90 s");
    return [];
  } catch (err) {
    logger.warn({ err, robotId, url, source: source.name }, "Browse.AI scrape threw");
    return [];
  }
}

// ──────────────────────────────────────────────────────────────
// Contact enrichment helpers
// ──────────────────────────────────────────────────────────────

// Internal Apify types (used only for contact enrichment Phase 2)
interface ApifyOrganicResult {
  title: string;
  url: string;
  description?: string;
}

interface ApifyDatasetItem {
  organicResults?: ApifyOrganicResult[];
  "#error"?: boolean;
}

/**
 * Start an Apify Google Search Scraper run for a batch of queries.
 * Returns the run ID.
 */
async function startApifySearchRun(queries: string[]): Promise<string> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN not set");

  const body = JSON.stringify({
    queries: queries.join("\n"),
    maxPagesPerQuery: 1,
    resultsPerPage: 10,
    countryCode: "au",
    languageCode: "en",
    saveHtml: false,
    saveHtmlToKeyValueStore: false,
  });

  const res = await fetch(
    `https://api.apify.com/v2/acts/apify~google-search-scraper/runs?token=${token}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body }
  );
  const data = (await res.json()) as { data?: { id: string }; error?: { message: string } };
  if (!data.data?.id) throw new Error(`Apify run failed: ${data.error?.message ?? "unknown"}`);
  return data.data.id;
}

/**
 * Poll an Apify run until SUCCEEDED/FAILED (max 3 min).
 */
async function waitForApifyRun(runId: string): Promise<void> {
  const token = process.env.APIFY_API_TOKEN;
  const maxAttempts = 36; // 36 × 5s = 3 min
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
    const data = (await res.json()) as { data?: { status: string } };
    const status = data.data?.status;
    if (status === "SUCCEEDED") return;
    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      throw new Error(`Apify run ${runId} ended with status: ${status}`);
    }
  }
  throw new Error(`Apify run ${runId} timed out after 3 minutes`);
}

/**
 * Fetch dataset items from a completed Apify run.
 */
async function fetchApifyResults(runId: string): Promise<ApifyDatasetItem[]> {
  const token = process.env.APIFY_API_TOKEN;
  const res = await fetch(
    `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${token}&limit=200`
  );
  return (await res.json()) as ApifyDatasetItem[];
}

const GENERIC_EMAIL_RE =
  /^(info|admin|contact|hello|enquiries|enquiry|general|mail|projects|team|reception|office|support|sales|media|pr|news|communications|renewables|solar|wind|energy|development|planning|noreply|no-reply|webmaster|postmaster|feedback|accounts|billing|hr|jobs|careers|connect|update|newsletter|marketing|ops|operations)@/i;

function isPersonalEmail(email: string): boolean {
  return !GENERIC_EMAIL_RE.test(email) && email.includes("@");
}

/**
 * Parse the Project Milestones Summary table from raw Watts News HTML.
 * This table appears at the top of every newsletter and lists all projects
 * that changed status in the past week, including newly-added ones.
 * Extracts solar/hybrid projects that are newly proposed or under assessment.
 */
function parseWattNewsMilestonesTable(
  html: string,
  newsletterDate: string,
  newsletterUrl: string
): ScrapedProject[] {
  const projects: ScrapedProject[] = [];

  for (const tableMatch of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [...tableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

    for (const rowMatch of rows) {
      const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map(c =>
          c[1]
            .replace(/<[^>]+>/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&nbsp;/g, " ")
            .replace(/\s+/g, " ")
            .trim()
        );

      if (cells.length < 4) continue;

      const [projectName, statusRaw, stateRaw, developerRaw, descRaw = ""] = cells;

      if (!projectName || projectName.length < 4) continue;
      // Skip header rows
      if (/^\s*(project|status|developer|state|country)\s*$/i.test(projectName)) continue;

      // Only newly added / proposed / being assessed — skip Generating / Approved / Withdrawn
      const statusLower = statusRaw.toLowerCase();
      const isNewOrProposed =
        statusLower.includes("added to") ||
        statusLower.includes("proposed") ||
        statusLower.includes("being assessed") ||
        statusLower.includes("under assessment") ||
        statusLower.includes("split from");
      if (!isNewOrProposed) continue;

      const fullText = `${projectName} ${descRaw}`;

      // Must have a solar component
      if (!hasSolarComponent(projectName, descRaw)) continue;
      // Reject wind
      if (isWindProject(projectName, descRaw)) continue;

      const capacityMw = extractCapacity(fullText);
      if (capacityMw == null || capacityMw < 5) continue;

      const country: "AU" | "NZ" = /\bNZ\b/.test(stateRaw) ? "NZ" : "AU";
      const developer = developerRaw.length > 1 && developerRaw.length < 100 ? developerRaw : null;
      const isUnderDev = statusLower.includes("being assessed") || statusLower.includes("under assessment");

      projects.push({
        name: projectName,
        description: (descRaw || fullText).slice(0, 600),
        capacityMw,
        developer,
        location: stateRaw && stateRaw.length < 30 ? stateRaw : null,
        country,
        status: isUnderDev ? "under_development" : "announced",
        sourceUrl: `${newsletterUrl}#milestone-${encodeURIComponent(projectName.slice(0, 40))}`,
        sourceName: "AltEnergy – Watts News",
        announcedDate: newsletterDate,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
      });
    }
  }

  return projects;
}

/**
 * Use ChatGPT to extract solar/hybrid projects from a Watts News newsletter
 * when HTML table/section parsing yields nothing.
 */
async function parseWattNewsWithChatGpt(
  text: string,
  newsletterDate: string,
  newsletterUrl: string,
): Promise<ScrapedProject[]> {
  try {
    const { openai } = await import("@workspace/integrations-openai-ai-server");
    const gpt = openai as unknown as GptScraperOpenAI;

    const prompt = `The following is the text content of an AltEnergy Watts News newsletter dated ${newsletterDate}.

Extract all solar or solar+BESS hybrid projects ≥5 MW in Australia or New Zealand that are newly announced, proposed, approved, or being assessed. Do NOT include standalone battery/BESS-only projects, wind-only projects, or operational projects.

Return ONLY a valid JSON array (no prose, no markdown fences):
[
  {
    "name": "Example Solar Farm",
    "description": "250 MW solar farm in regional VIC",
    "capacity_mw": 250,
    "developer": "Acme Energy",
    "location": "Regional VIC",
    "country": "AU",
    "status": "announced"
  }
]

Rules:
- country: "AU" or "NZ" only
- status: "announced" or "under_development"
- capacity_mw: number (MW) or null — exclude projects <5 MW
- Exclude: wind-only, BESS-only, operational/generating, headlines about industry trends or policy
- Return [] if nothing relevant found

Newsletter text:
${text.slice(0, 12000)}`;

    const response = await gpt.responses.create({
      model: "gpt-5.6-sol",
      tools: [] as { type: string }[],
      input: prompt,
      max_output_tokens: 4096,
    });

    let raw = response.output_text ?? "";
    if (!raw && Array.isArray(response.output)) {
      for (const block of response.output) {
        if ((block as { type: string; text?: string }).type === "message") {
          raw = (block as { type: string; text?: string }).text ?? "";
          break;
        }
      }
    }

    raw = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start === -1 || end === -1) return [];

    const parsed = JSON.parse(raw.slice(start, end + 1)) as Array<{
      name?: string;
      description?: string;
      capacity_mw?: number | null;
      developer?: string | null;
      location?: string | null;
      country?: string;
      status?: string;
    }>;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((r) => r.name)
      .map((r) => {
        const fullText = `${r.name ?? ""} ${r.description ?? ""}`;
        // Use GPT-provided capacity first; fall back to regex extraction from description
        let capacityMw: number | null = typeof r.capacity_mw === "number" ? r.capacity_mw : null;
        if (capacityMw == null) capacityMw = extractCapacity(fullText);
        return {
          name: r.name!,
          description: r.description ?? r.name ?? "",
          capacityMw,
          developer: r.developer ?? null,
          location: r.location ?? null,
          country: (r.country === "NZ" ? "NZ" : "AU") as "AU" | "NZ",
          status: (r.status === "under_development" ? "under_development" : "announced") as "announced" | "under_development",
          sourceUrl: `${newsletterUrl}#gpt-${encodeURIComponent((r.name ?? "").slice(0, 40))}`,
          sourceName: "AltEnergy – Watts News",
          announcedDate: newsletterDate,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
        };
      })
      .filter((p) => p.capacityMw == null || p.capacityMw >= 5);
  } catch (err) {
    logger.warn({ err }, "Watt News ChatGPT fallback failed");
    return [];
  }
}

/**
 * Check if an email domain is plausibly related to a company name.
 * Used to reject emails scraped from unrelated pages (e.g. harvard.edu for WestWind Energy).
 */
/**
 * Validate a contact email for a project. Combines personal-check with domain relevance.
 * Returns true only if the email is both a non-generic address and plausibly
 * related to the developer/company name.
 */
/** Generic / government / regulatory domains that are never valid developer contacts */
const INVALID_CONTACT_DOMAINS = [
  "cer.gov.au", "cleanenergyregulator.gov.au", "dcceew.gov.au", "energy.gov.au",
  "aemo.com.au", "epa.gov.au", "epa.govt.nz", "gov.au", "govt.nz", "gov.uk",
  "ac.uk", "harvard.edu", "stanford.edu", "mit.edu", "edu.au", "edu.nz",
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com",
  "live.com", "mail.com", "protonmail.com", "proton.me", "zoho.com", "fastmail.com",
];

function isValidProjectContact(email: string | null, developerName: string | null | undefined): boolean {
  if (!email) return false;
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (INVALID_CONTACT_DOMAINS.some(d => domain.endsWith(d))) return false;
  if (!isPersonalEmail(email)) return false;
  if (!isEmailDomainRelated(email, developerName)) return false;
  return true;
}

/**
 * Check if an email domain is plausibly related to a company name.
 * The email domain must contain the company name or a recognisable part of it.
 * Returns true only if the company name (or a meaningful keyword) is found in the domain.
 */
function isEmailDomainRelated(email: string, companyName: string | null | undefined): boolean {
  if (!companyName) return false;
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  const rootDomain = domain.replace(/\.[^.]+$/, "");
  const company = companyName.toLowerCase();

  const allWords = company.replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(w => w.length >= 1);
  const commonWords = new Set([
    "energy", "solar", "power", "renewables", "wind", "battery", "storage",
    "pty", "ltd", "limited", "group", "holdings", "corporation", "inc", "co", "company",
    "australia", "new", "zealand", "nz", "au", "and", "the", "of",
    "green", "gold", "pacific", "blue", "red", "north", "south", "east", "west",
    "renewable", "clean", "project", "development", "projects", "international",
    "global", "national", "regional", "local", "urban", "rural", "metro", "metro",
  ]);
  const companyWords = allWords.filter(w => w.length >= 2 && !commonWords.has(w));

  // 1. Any company keyword must appear in the domain
  const related = companyWords.some(w => domain.includes(w));
  if (related) return true;

  // 2. Whole company name as a slug (e.g. "contactenergy" in "contactenergy.co.nz")
  const companySlug = company.replace(/[^a-z0-9]/g, "");
  if (companySlug.length >= 3 && domain.includes(companySlug)) return true;

  // 3. Prefix match: domain is a prefix of the company slug (e.g. "edp" vs "edpr")
  const domainSlug = rootDomain.replace(/[^a-z0-9]/g, "");
  if (domainSlug.length >= 3 && companySlug.startsWith(domainSlug)) return true;
  if (domainSlug.length >= 3 && companySlug.includes(domainSlug)) return true;

  // 4. Substring match: meaningful company word is in the domain (e.g. "generation" → "genco")
  // Only for longer words (>= 4 chars) to avoid false positives
  const meaningfulWords = allWords.filter(w => w.length >= 4 && !commonWords.has(w));
  const meaningfulMatch = meaningfulWords.some(w => {
    // Domain must contain a substring of the company word (>= 4 chars) or vice versa
    for (let i = 0; i <= w.length - 4; i++) {
      const sub = w.slice(i, i + 4);
      if (domainSlug.includes(sub)) return true;
    }
    for (let i = 0; i <= domainSlug.length - 4; i++) {
      const sub = domainSlug.slice(i, i + 4);
      if (w.includes(sub)) return true;
    }
    return false;
  });
  if (meaningfulMatch) return true;

  // 5. Acronym from ALL company words (e.g. "Yindjibarndi Energy Corporation" → "yec")
  const acronym = allWords.map(w => w[0]).join("");
  if (acronym.length >= 2 && domain.includes(acronym)) return true;

  return false;
}

/**
 * Match a developer/company name against the PVH contacts list.
 * Returns the best-matching contact (by organization name) or null.
 * Matching is case-insensitive and tolerates common suffixes (Pty, Ltd, Energy, etc.).
 */
function matchFallbackContact(
  developer: string | null,
  contacts: PvhContact[]
): { name: string; email: string } | null {
  if (!developer || contacts.length === 0) return null;

  const normalize = (s: string) =>
    s.toLowerCase()
      .replace(/\b(pty|ltd|limited|group|holdings|inc|corp|co|company|australia|energy|solar|power|renewables|renewable|green|clean|au|nz)\b/g, "")
      .replace(/[^a-z0-9]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const devNorm = normalize(developer);
  if (!devNorm) return null;

  let bestContact: PvhContact | null = null;
  let bestScore = 0;

  for (const c of contacts) {
    if (!c.organizationName || !c.email1) continue;
    const orgNorm = normalize(c.organizationName);
    if (!orgNorm) continue;

    let score = 0;

    // Exact normalized match — highest score
    if (devNorm === orgNorm) {
      score = 100;
    } else if (devNorm.includes(orgNorm) || orgNorm.includes(devNorm)) {
      // One contains the other
      score = 80;
    } else {
      // Word-overlap scoring
      const devWords = devNorm.split(" ").filter(w => w.length >= 3);
      const orgWords = new Set(orgNorm.split(" ").filter(w => w.length >= 3));
      const overlap = devWords.filter(w => orgWords.has(w)).length;
      if (overlap > 0) {
        score = (overlap / Math.max(devWords.length, orgWords.size)) * 60;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestContact = c;
    }
  }

  // Require at least a reasonable match threshold
  if (bestScore < 40 || !bestContact?.email1) return null;

  const nameParts = [bestContact.firstName, bestContact.lastName].filter(Boolean);
  const name = nameParts.length > 0 ? nameParts.join(" ") : (bestContact.organizationName ?? "");

  return { name, email: bestContact.email1 };
}

function extractEmailsFromHtml(html: string): Array<{ email: string; context: string }> {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  const results: Array<{ email: string; context: string }> = [];
  const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  let match;
  while ((match = emailRe.exec(text)) !== null) {
    const email = match[0].toLowerCase();
    const s = Math.max(0, match.index - 200);
    const e = Math.min(text.length, match.index + email.length + 200);
    results.push({ email, context: text.slice(s, e) });
  }
  return results;
}

const SKIP_NAMES_RE =
  /^(New Zealand|South Australia|Western Australia|New South Wales|North Queensland|Clean Energy|Solar Farm|Wind Farm|Battery Storage|Energy Park|Power Station|Project Manager|Development Manager|Business Development|Executive Director|Chief Executive|Managing Director|General Manager|Senior Manager|Project Director|Head Office|Annual Report|Privacy Policy|All Rights|Sunshine Estate|Global Ratings|Search Clear|Presentations? Videos?|Kurow Development Team|Unknown Developer|Project Team|Development Team|Our Team|The Team)$/i;

const NOISY_PROJECT_RE = new RegExp(
  [
    // Operational / milestone articles
    "officially opened",
    "full.?operations?",
    "reaches? full",
    "milestone reached",
    "huge milestone",
    "already operational",
    // Planning process articles (not the project itself)
    "recommended for approval",
    "approved by.*planning",
    "commission approves?",
    "modification application",
    "amendment report",
    "thank you for your feedback",
    "public views? about",
    "public consultation",
    // Corporate / deal / fundraising news (not project announcements)
    "sign(?:s|ed)? (?:a )?ppa",
    "power purchase agreement",
    "board visit",
    "ayala corporation",
    "joins? circular",
    "circular pv alliance",
    "industry member",
    "circular future",
    "solar panels? to be recycled",
    "help(?:s|ed)? (?:get|fund|secure|raise|deliver)",
    "helps? (?:the|a|an) ",
    "and .{3,30} help",
    "to power (?:uts|unis?|university|school|hospital|council|government|municipality)",
    "to underpin",
    "backs? circular",
    "folds? .{5,40} into",
    "secures? offtake",
    "secures? funding",
    // Taglines / slogans (not project names)
    "delivering sustainable solar power across",
    "sustainable solar power across the world",
    "the future of energy",
    "powering a sustainable",
    "leading the energy transition",
    "^our ",
    "^the future",
    // Agricultural / lifestyle articles about existing farms
    "grazing (?:merinos?|fleece|sheep|cattle)",
    "merinos? flock",
    "fashion house",
    "paddocks? to power",
    "rise of small",
    "accommodation with",
    "solar farm accommodation",
    // Generic article titles (too vague to be project names)
    "^\\d+% (?:wind|solar)",
    "the power behind",
    "bess boom",
    "^.{0,3}$",               // very short names (1-3 chars)
    // Industry-report / guide / snapshot headings (not projects)
    "careers? guide",
    "industry snapshot",
    "^clean energy australia",
    "^annual report",
    "^working in ",
    "^find out more",
    "^use our ",
    "^discover ",
    "^about (?:us|our|the )",
    "^get in touch",
    "^join (?:us|the|our)",
    "^read the",
    "^download (?:the|our)",
    "^subscribe",
    "^newsletter",
    "^media release$",
    "^fact sheet",
    "^faqs?$",
    "^resources?$",
    "^publications?$",
    "^contact us",
    // Non-AU/NZ geographies in the title
    "\\b(?:liberia|africa|india|china|uk |united kingdom|usa |united states|europe|middle east|kenya|nigeria|ghana|pakistan|indonesia|vietnam|philippines|bangladesh|myanmar|cambodia|laos|thailand|malaysia|singapore|taiwan|korea|japan|new mexico|colorado|california|texas|florida)\\b",
  ].join("|"),
  "i"
);

/**
 * A newsandviews article title looks like a project name only when it contains
 * a recognised project-name suffix (e.g. "Solar Farm", "BESS", "Energy Hub").
 * Reject article-style headlines like "Rod Drury and Sam Morgan help get $300m…"
 */
const PROJECT_NAME_SHAPE_RE =
  /\b(?:solar\s+farm|solar\s+park|solar\s+project|solar\s+hub|solar\s+station|bess|battery\s+storage|energy\s+hub|energy\s+park|power\s+station|hybrid\s+solar|solar\s+and\s+battery|battery\s+and\s+solar|solar\s+storage|solar\s+plus|wind\s+farm)\b/i;

function isNoisyProjectName(name: string, requireProjectShape = false): boolean {
  if (!name || name.trim().length <= 3) return true;
  if (NOISY_PROJECT_RE.test(name)) return true;
  // For newsandviews article titles, additionally require a project-name shape
  if (requireProjectShape && !PROJECT_NAME_SHAPE_RE.test(name)) return true;
  return false;
}

function extractNameNearEmail(context: string): string | null {
  const nameRe = /\b([A-Z][a-z]{1,20})\s+([A-Z][a-z]{1,25})\b/g;
  let m;
  while ((m = nameRe.exec(context)) !== null) {
    const name = `${m[1]} ${m[2]}`;
    if (!SKIP_NAMES_RE.test(name)) return name;
  }
  return null;
}

async function scrapeUrlForContact(url: string, companyName?: string | null): Promise<{ name: string | null; email: string; phone: string | null } | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const matches = extractEmailsFromHtml(html);
    for (const { email, context } of matches) {
      if (isPersonalEmail(email) && isEmailDomainRelated(email, companyName)) {
        const name = extractNameNearEmail(context);
        const phoneRaw = context.match(/\(?\+?[\d]{1,4}[\s\-.]?\(?\d{2,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}/);
        return { name, email, phone: phoneRaw?.[0]?.replace(/\s+/g, " ").trim() ?? null };
      }
    }
  } catch { /* timeout / network */ }
  return null;
}

type ContactResult = { name: string | null; email: string; phone: string | null };

// ── Lusha API types ────────────────────────────────────────────────────────

interface LushaContact {
  firstName?: string;
  lastName?: string;
  companyName?: string;
  companyDomain?: string;
}

interface LushaProspectingContact {
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
}

interface LushaProspectingResponse {
  data?: { contacts?: LushaProspectingContact[] };
  contacts?: LushaProspectingContact[];
  results?: LushaProspectingContact[];
}

interface LushaEnrichedContact {
  firstName?: string;
  lastName?: string;
  emails?: Array<{ email: string; type?: string; confidence?: string }>;
  phones?: Array<{ number?: string; type?: string; doNotCall?: boolean }>;
}

interface LushaResponse {
  results?: LushaEnrichedContact[];
  billing?: { creditsCharged?: number; resultsReturned?: number };
}

/**
 * Call Lusha v3 search-and-enrich in batches of up to 100 contacts.
 *
 * Real API shape (confirmed):
 *   POST https://api.lusha.com/v3/contacts/search-and-enrich
 *   Header: api_key: <key>
 *   Body:   { contacts: [...], reveal: ["emails", "phones"] }
 *   Response: { results: [ { emails: [{email, type, confidence}], phones: [{number, type}], firstName, lastName }, ... ] }
 *
 * Results are positionally aligned with the input contacts array.
 * Phone numbers may be partially masked (e.g. "+61 415...") on lower-tier plans —
 * those are discarded so we never save truncated data.
 *
 * Returns a map from input index → enriched result (email + phone + name).
 */
async function callLushaBulkEnrich(
  contacts: LushaContact[],
): Promise<Map<number, ContactResult>> {
  const apiKey = process.env.LUSHA_API_KEY;
  if (!apiKey || contacts.length === 0) return new Map();

  const results = new Map<number, ContactResult>();
  const BATCH_SIZE = 100;

  for (let start = 0; start < contacts.length; start += BATCH_SIZE) {
    const batch = contacts.slice(start, start + BATCH_SIZE);
    try {
      const resp = await fetch("https://api.lusha.com/v3/contacts/search-and-enrich", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api_key": apiKey,
        },
        body: JSON.stringify({
          contacts: batch,
          reveal: ["emails", "phones"],
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!resp.ok) {
        const body = await resp.text();
        logger.warn({ status: resp.status, body }, "Lusha API error response");
        continue;
      }

      const json = (await resp.json()) as LushaResponse;
      const enrichedList = json?.results ?? [];

      let batchFound = 0;
      for (let i = 0; i < enrichedList.length; i++) {
        const contact = enrichedList[i];
        if (!contact) continue;

        const emails = contact.emails ?? [];
        const phones = contact.phones ?? [];

        // Prefer work emails with highest confidence; fall back to any valid address
        const bestEmail =
          emails.find((e) => e.confidence === "A+" && e.type === "work")?.email ??
          emails.find((e) => e.type === "work")?.email ??
          emails[0]?.email;

        if (!bestEmail) continue;

        // Discard truncated/masked phone numbers (Lusha shows "+61 415..." on some plans)
        const fullPhone =
          phones.find((p) => p.type === "mobile" && p.number && !p.number.includes("..."))?.number ??
          phones.find((p) => p.number && !p.number.includes("..."))?.number ??
          null;

        const firstName = contact.firstName ?? "";
        const lastName = contact.lastName ?? "";
        const name = [firstName, lastName].filter(Boolean).join(" ") || null;

        results.set(start + i, { name, email: bestEmail, phone: fullPhone ?? null });
        batchFound++;
      }

      logger.info(
        { batchStart: start, batchSize: batch.length, found: batchFound, credits: json?.billing?.creditsCharged },
        "Lusha batch enrichment complete",
      );
    } catch (err) {
      logger.warn({ err, batchStart: start }, "Lusha bulk enrich request failed");
    }
  }

  return results;
}

/**
 * Lusha Prospecting: find contacts at a company where we don't know the person's name.
 *
 * Three-step flow (confirmed endpoint shapes):
 *   1. POST /prospecting/filters/companies/names  { text }  → resolves company ID + fqdn
 *   2. POST /prospecting/contact/search  { filters.companies.include.names: [name] }  → list of contacts (no PII)
 *   3. POST /v3/contacts/search-and-enrich  { firstName, lastName, companyName, companyDomain }  → emails + phones
 *
 * Picks the most sales-relevant contact (Business Developer > Project Director > CEO > Engineer).
 * Returns null if no credits, company not found, or no contacts.
 */
async function callLushaProspecting(
  companyName: string,
  companyDomain: string | null,
): Promise<ContactResult | null> {
  const apiKey = process.env.LUSHA_API_KEY;
  if (!apiKey) return null;

  // Job-title relevance scores — higher = better sales contact
  const TITLE_SCORES: Array<[RegExp, number]> = [
    [/business develop/i, 10],
    [/project director|head of (project|develop)/i, 9],
    [/development director|director of develop/i, 9],
    [/managing director|chief executive|^ceo$/i, 8],
    [/general manager|country manager/i, 7],
    [/project manager|development manager/i, 6],
    [/commercial manager|bd manager/i, 5],
  ];

  function titleScore(title: string): number {
    for (const [re, score] of TITLE_SCORES) {
      if (re.test(title)) return score;
    }
    return 1;
  }

  try {
    // Step 1 — resolve company ID
    const compResp = await fetch("https://api.lusha.com/prospecting/filters/companies/names", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api_key": apiKey },
      body: JSON.stringify({ text: companyName }),
    });
    if (!compResp.ok) {
      logger.warn({ status: compResp.status, companyName }, "Lusha: company name lookup failed");
      return null;
    }
    const companies = (await compResp.json()) as Array<{
      companyId?: number; name?: string; fqdn?: string; has_prospecting_contacts?: boolean;
    }>;
    const co = companies[0];
    if (!co?.companyId || !co.has_prospecting_contacts) return null;

    // Step 2 — search contacts at this company (no PII returned, no credits charged)
    const searchResp = await fetch("https://api.lusha.com/prospecting/contact/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api_key": apiKey },
      body: JSON.stringify({
        filters: {
          companies: { include: { names: [co.name ?? companyName] } },
        },
        pages: { page: 0, size: 10 },
      }),
    });
    if (!searchResp.ok) {
      logger.warn({ status: searchResp.status, companyName }, "Lusha: prospecting contact search failed");
      return null;
    }
    const searchData = (await searchResp.json()) as LushaProspectingResponse;
    const candidates: LushaProspectingContact[] =
      searchData.data?.contacts ?? searchData.contacts ?? searchData.results ?? [];
    if (candidates.length === 0) return null;

    // Pick the most sales-relevant contact
    const best = candidates
      .filter((c) => c.firstName && c.lastName)
      .sort((a, b) => titleScore(b.jobTitle ?? "") - titleScore(a.jobTitle ?? ""))[0];
    if (!best?.firstName || !best.lastName) return null;

    logger.info(
      { companyName, firstName: best.firstName, lastName: best.lastName, title: best.jobTitle },
      "Lusha prospecting: enriching best contact",
    );

    // Step 3 — enrich that specific person to reveal email + phone
    const enrichResp = await fetch("https://api.lusha.com/v3/contacts/search-and-enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api_key": apiKey },
      body: JSON.stringify({
        contacts: [{
          firstName: best.firstName,
          lastName: best.lastName,
          companyName: co.name ?? companyName,
          companyDomain: co.fqdn ?? companyDomain ?? undefined,
        }],
        reveal: ["emails", "phones"],
      }),
    });
    if (!enrichResp.ok) {
      logger.warn({ status: enrichResp.status, companyName }, "Lusha: prospecting enrich step failed");
      return null;
    }
    const enrichData = (await enrichResp.json()) as LushaResponse;
    const enriched = enrichData.results?.[0];
    if (!enriched || ("error" in enriched)) return null;

    const emails = enriched.emails ?? [];
    const phones = enriched.phones ?? [];

    const bestEmail =
      emails.find((e) => e.confidence === "A+" && e.type === "work")?.email ??
      emails.find((e) => e.type === "work")?.email ??
      emails[0]?.email;
    if (!bestEmail) return null;

    const fullPhone =
      phones.find((p) => p.type === "mobile" && p.number && !p.number.includes("..."))?.number ??
      phones.find((p) => p.number && !p.number.includes("..."))?.number ??
      null;

    const name = [enriched.firstName ?? best.firstName, enriched.lastName ?? best.lastName]
      .filter(Boolean).join(" ") || null;

    return { name, email: bestEmail, phone: fullPhone ?? null };
  } catch (err) {
    logger.warn({ err, companyName }, "Lusha prospecting threw");
    return null;
  }
}

/**
 * Enrich projects that are missing personal contact details.
 * Phase 1:    Scrape developer/project websites directly.
 * Phase 2:    Apify Google Search → visit top result URLs.
 * Phase 2.5a: Lusha search-and-enrich for contacts where we already have a person name.
 * Phase 2.5b: Lusha Prospecting for companies where we have no person name at all.
 * Phase 3:    LinkedIn profile search for developers with generic contacts.
 */
export async function enrichMissingContacts(runId?: number): Promise<{ checked: number; updated: number }> {
  const enrichmentStartedAt = performance.now();
  const GENERIC_PREFIXES = [
    "info@", "admin@", "contact@", "hello@", "enquiries@", "enquiry@",
    "general@", "mail@", "projects@", "team@", "reception@", "office@",
    "support@", "sales@", "media@", "pr@", "project@", "feedback@",
  ];

  function needsEnrichment(p: { contactEmail: string | null; contactName: string | null; developer?: string | null }): boolean {
    if (!p.contactEmail && !p.contactName) return true;
    if (p.contactEmail && GENERIC_PREFIXES.some(px => p.contactEmail!.toLowerCase().startsWith(px))) return true;
    if (p.contactEmail && !isValidProjectContact(p.contactEmail, p.developer ?? null)) return true;
    return false;
  }

  const allProjects = await db
    .select({
      id: projectsTable.id,
      developer: projectsTable.developer,
      sourceUrl: projectsTable.sourceUrl,
      contactName: projectsTable.contactName,
      contactEmail: projectsTable.contactEmail,
      contactPhone: projectsTable.contactPhone,
    })
    .from(projectsTable);
  const toEnrich = allProjects.filter(needsEnrichment);
  logger.info({ count: toEnrich.length, runId }, "Contact enrichment: starting");
  if (toEnrich.length === 0) {
    if (runId) {
      await db.update(contactEnrichmentsTable)
        .set({ status: "completed", completedAt: new Date(), checked: 0, updated: 0 })
        .where(eq(contactEnrichmentsTable.id, runId));
    }
    return { checked: 0, updated: 0 };
  }

  type GroupEntry = {
    projects: typeof toEnrich;
    domain: string | null;
    existingName: string | null;
  };
  const groups = new Map<string, GroupEntry>();

  for (const proj of toEnrich) {
    const key = (proj.developer ?? `id:${proj.id}`).toLowerCase().trim();
    if (!groups.has(key)) {
      let domain: string | null = null;
      if (proj.contactEmail) domain = proj.contactEmail.split("@")[1] ?? null;
      groups.set(key, { projects: [], domain, existingName: proj.contactName });
    }
    const g = groups.get(key)!;
    g.projects.push(proj);
    if (!g.domain && proj.contactEmail) g.domain = proj.contactEmail.split("@")[1] ?? null;
    if (!g.existingName && proj.contactName) g.existingName = proj.contactName;
    // Fallback: derive domain from non-altenergy source URLs
    if (!g.domain && proj.sourceUrl && !proj.sourceUrl.includes("altenergy.com.au")) {
      try {
        const host = new URL(proj.sourceUrl).hostname.replace(/^www\./, "");
        // Skip news/government/social domains — these are never developer domains
        const nonDeveloperDomains = new Set([
          "abc.net.au", "reneweconomy.com.au", "arena.gov.au", "pv-magazine-australia.com",
          "esdnews.com.au", "solarquarter.com", "greenreview.com.au", "businessdesk.co.nz",
          "cer.gov.au", "planningportal.nsw.gov.au", "epa.tas.gov.au", "transpower.co.nz",
          "epa.govt.nz", "ea.govt.nz", "fasttrack.govt.nz", "wikipedia.org", "youtube.com",
          "linkedin.com", "facebook.com", "twitter.com", "instagram.com", "reddit.com",
          "theaustralian.com.au", "afr.com", "smh.com.au", "theage.com.au", "heraldsun.com.au",
        ]);
        if (!nonDeveloperDomains.has(host)) g.domain = host;
      } catch { /* ignore */ }
    }
  }

  const CONTACT_PATHS = [
    "/team", "/our-team", "/about", "/about-us", "/people",
    "/contact", "/contact-us", "/meet-the-team", "/who-we-are", "/staff",
  ];

  let updated = 0;
  const enrichedKeys = new Set<string>();
  const noDomainGroups: Array<[string, GroupEntry]> = [];

  async function applyContact(g: GroupEntry, contact: ContactResult): Promise<void> {
    for (const proj of g.projects) {
      await db
        .update(projectsTable)
        .set({
          contactName: contact.name ?? g.existingName ?? proj.contactName,
          contactEmail: contact.email,
          contactPhone: contact.phone ?? proj.contactPhone,
          updatedAt: new Date(),
        })
        .where(eq(projectsTable.id, proj.id));
      updated++;
    }
  }

  // ── Phase 1: Scrape known domains ─────────────────────────
  // Developer domains are independent. A three-worker cap reduces wall time
  // while avoiding uncontrolled pressure on external sites.
  const phaseOneMisses = await mapWithConcurrency(
    [...groups.entries()],
    3,
    async ([devKey, g]): Promise<[string, GroupEntry] | null> => {
      if (!g.domain) return [devKey, g];

      for (const path of CONTACT_PATHS) {
        const contact = await scrapeUrlForContact(
          `https://${g.domain}${path}`,
          g.projects[0].developer ?? null,
        );
        if (contact) {
          await applyContact(g, contact);
          enrichedKeys.add(devKey);
          logger.info({ devKey, email: contact.email }, "Contact enriched via domain scrape");
          return null;
        }
      }
      return [devKey, g];
    },
  );
  noDomainGroups.push(
    ...phaseOneMisses.filter((entry): entry is [string, GroupEntry] => entry !== null),
  );

  // ── Phase 2: Apify Google Search for developers without a known domain ────
  const token = process.env.APIFY_API_TOKEN;
  const phaseTwo = noDomainGroups.filter(([k]) => !enrichedKeys.has(k));
  if (phaseTwo.length > 0 && !token) {
    logger.warn(
      { phase: "Apify search", outcome: "skipped-missing-credentials", missing: ["APIFY_API_TOKEN"] },
      "Contact enrichment integration outcome",
    );
  }
  if (phaseTwo.length > 0 && token) {
    logger.info({ count: phaseTwo.length }, "Contact enrichment: Phase 2 Apify search");

    const queries = phaseTwo.map(([, g]) => {
      const dev = g.projects[0].developer ?? "solar developer";
      const person = g.existingName;
      if (person && !/team|group|office|crew/i.test(person)) {
        return `"${person}" "${dev}" renewable energy email contact Australia`;
      }
      return `"${dev}" solar Australia contact email -info@ -admin@ -contact@`;
    });

    try {
      const runId = await startApifySearchRun(queries.slice(0, 25));
      await waitForApifyRun(runId);
      const items = await fetchApifyResults(runId);

      for (let i = 0; i < Math.min(phaseTwo.length, items.length); i++) {
        const [devKey, g] = phaseTwo[i];
        if (enrichedKeys.has(devKey)) continue;
        const results = (items[i] as ApifyDatasetItem)?.organicResults ?? [];

        // a) Check snippets for emails directly
        const companyName = g.projects[0].developer ?? null;
        for (const result of results) {
          const text = `${result.title ?? ""} ${result.description ?? ""}`;
          const emailMatches = [...text.matchAll(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g)];
          for (const em of emailMatches) {
            const email = em[0].toLowerCase();
            if (isPersonalEmail(email) && isEmailDomainRelated(email, companyName)) {
              const name = extractNameNearEmail(text) ?? g.existingName;
              await applyContact(g, { name: name ?? null, email, phone: null });
              enrichedKeys.add(devKey);
              logger.info({ devKey, email }, "Contact enriched via Apify snippet");
              break;
            }
          }
          if (enrichedKeys.has(devKey)) break;
        }

        // b) Visit top result URLs and scrape
        if (!enrichedKeys.has(devKey)) {
          for (const result of results.slice(0, 3)) {
            if (!result.url) continue;
            const contact = await scrapeUrlForContact(result.url, companyName);
            if (contact) {
              await applyContact(g, {
                name: contact.name ?? g.existingName,
                email: contact.email,
                phone: contact.phone,
              });
              enrichedKeys.add(devKey);
              logger.info({ devKey, email: contact.email, url: result.url }, "Contact enriched via Apify URL");
              break;
            }
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, "Contact enrichment: Phase 2 Apify failed");
    }
  }

  // ── Phase 2.5a: Lusha search-and-enrich (contacts with a known person name) ─
  //   search-and-enrich REQUIRES firstName + lastName — sending company-only returns 400.
  const lushaKey = process.env.LUSHA_API_KEY;
  const lushaPool = noDomainGroups.filter(([k]) => !enrichedKeys.has(k));

  if (lushaPool.length > 0 && !lushaKey) {
    logger.warn(
      { phase: "Lusha enrichment", outcome: "skipped-missing-credentials", missing: ["LUSHA_API_KEY"] },
      "Contact enrichment integration outcome",
    );
  }

  if (lushaPool.length > 0 && lushaKey) {
    // Split: known-name entries go to bulk search-and-enrich; nameless entries go to prospecting
    type NamedEntry  = { idx: number; devKey: string; g: GroupEntry; contact: LushaContact };
    const namedEntries: NamedEntry[] = [];
    const namelessEntries: Array<[string, GroupEntry]> = [];

    for (let i = 0; i < lushaPool.length; i++) {
      const [devKey, g] = lushaPool[i];
      const dev    = g.projects[0].developer ?? undefined;
      const domain = g.domain ?? undefined;
      const contact: LushaContact = { companyName: dev, companyDomain: domain };

      const fullName = g.existingName?.trim();
      if (fullName && !/team|group|office|crew|solar|renewables|energy/i.test(fullName)) {
        const spaceIdx = fullName.indexOf(" ");
        if (spaceIdx > 0) {
          contact.firstName = fullName.slice(0, spaceIdx);
          contact.lastName  = fullName.slice(spaceIdx + 1);
        }
      }

      if (contact.firstName && contact.lastName) {
        namedEntries.push({ idx: i, devKey, g, contact });
      } else {
        namelessEntries.push([devKey, g]);
      }
    }

    logger.info(
      { namedCount: namedEntries.length, namelessCount: namelessEntries.length },
      "Contact enrichment: Phase 2.5 Lusha split",
    );

    // 2.5a — bulk search-and-enrich for contacts we already have a name for
    if (namedEntries.length > 0) {
      try {
        const lushaResults = await callLushaBulkEnrich(namedEntries.map((e) => e.contact));
        for (const [batchIdx, result] of lushaResults) {
          const entry = namedEntries[batchIdx];
          if (!entry || enrichedKeys.has(entry.devKey)) continue;
          await applyContact(entry.g, {
            name: result.name ?? entry.g.existingName ?? null,
            email: result.email,
            phone: result.phone,
          });
          enrichedKeys.add(entry.devKey);
          logger.info(
            { devKey: entry.devKey, email: result.email, phone: result.phone },
            "Contact enriched via Lusha search-and-enrich",
          );
        }
      } catch (err) {
        logger.warn({ err }, "Contact enrichment: Phase 2.5a Lusha search-and-enrich failed");
      }
    }

    // 2.5b — prospecting for companies where we have no person name at all
    // DISABLED by default: Lusha free plans have a 100 API calls/day limit.
    // Prospecting uses 3 calls per company (company lookup + contact search + enrich),
    // which exhausts the quota after ~33 companies. Enable with
    // LUSHA_PROSPECTING_ENABLED=true if on a paid plan.
    if (namelessEntries.length > 0 && process.env.LUSHA_PROSPECTING_ENABLED === "true") {
      logger.info({ count: namelessEntries.length }, "Contact enrichment: Phase 2.5b Lusha prospecting");
      for (const [devKey, g] of namelessEntries) {
        if (enrichedKeys.has(devKey)) continue;
        const dev    = g.projects[0].developer;
        const domain = g.domain;
        if (!dev) continue;
        try {
          const result = await callLushaProspecting(dev, domain);
          if (result) {
            await applyContact(g, result);
            enrichedKeys.add(devKey);
            logger.info(
              { devKey, email: result.email, phone: result.phone, name: result.name },
              "Contact enriched via Lusha prospecting",
            );
          }
        } catch (err) {
          logger.warn({ err, devKey }, "Contact enrichment: Phase 2.5b prospecting entry failed");
        }
      }
    }
  }

  // ── Phase 3: LinkedIn profile search for developers with generic contacts ──
  const phaseThree = noDomainGroups.filter(([k]) => !enrichedKeys.has(k));
  if (phaseThree.length > 0 && token) {
    logger.info({ count: phaseThree.length }, "Contact enrichment: Phase 3 LinkedIn search");

    // Relevant job titles that indicate the person who would handle project enquiries
    const RELEVANT_TITLES = [
      "project director", "head of projects", "head of epc", "project manager",
      "engineering manager", "project development manager", "development manager",
      "head of development", "director of projects", "managing director",
      "chief executive officer", "ceo", "country manager", "general manager",
      "head of construction", "construction manager", "epc manager",
      "commercial manager", "business development manager", "bd manager",
    ];

    const titleQuery = RELEVANT_TITLES.map(t => `"${t}"`).join(" OR ");

    const linkedInQueries = phaseThree.map(([, g]) => {
      const dev = g.projects[0].developer ?? "solar developer";
      return `"${dev}" LinkedIn (${titleQuery})`;
    });

    try {
      const runId = await startApifySearchRun(linkedInQueries.slice(0, 20));
      await waitForApifyRun(runId);
      const items = await fetchApifyResults(runId);

      for (let i = 0; i < Math.min(phaseThree.length, items.length); i++) {
        const [devKey, g] = phaseThree[i];
        if (enrichedKeys.has(devKey)) continue;
        const results = (items[i] as ApifyDatasetItem)?.organicResults ?? [];

        // Find LinkedIn profile results with relevant titles
        let bestMatch: { name: string; title: string; email: string | null; phone: string | null } | null = null;

        for (const result of results) {
          const text = `${result.title ?? ""} ${result.description ?? ""}`;
          const url = result.url ?? "";

          // Only look at LinkedIn results
          if (!url.includes("linkedin.com/in/")) continue;

          // Extract name from title (usually "Name - Title | LinkedIn")
          const linkedInMatch = text.match(/^([^|\-]+)[\s|\-]+([^|\n]+)/);
          if (!linkedInMatch) continue;

          const extractedName = linkedInMatch[1].trim();
          const extractedTitle = linkedInMatch[2].trim().toLowerCase();

          // Check if the title matches any relevant role
          const isRelevant = RELEVANT_TITLES.some(t => extractedTitle.includes(t));
          if (!isRelevant) continue;

          // Score the match: prefer more senior roles
          const seniority = extractedTitle.includes("director") || extractedTitle.includes("head") || extractedTitle.includes("ceo") || extractedTitle.includes("chief") || extractedTitle.includes("managing") ? 3 :
                            extractedTitle.includes("manager") ? 2 : 1;

          if (!bestMatch || seniority > bestMatch.title.split(" ").length) {
            bestMatch = { name: extractedName, title: linkedInMatch[2].trim(), email: null, phone: null };
          }
        }

        if (bestMatch) {
          // Try to find email/phone for this person via a targeted search
          const personQuery = `"${bestMatch.name}" "${bestMatch.title}" "${g.projects[0].developer ?? ""}" email contact Australia`;
          const personRunId = await startApifySearchRun([personQuery]);
          await waitForApifyRun(personRunId);
          const personItems = await fetchApifyResults(personRunId);
          const personResults = (personItems[0] as ApifyDatasetItem)?.organicResults ?? [];

          const companyName = g.projects[0].developer ?? null;
          for (const pr of personResults) {
            const pText = `${pr.title ?? ""} ${pr.description ?? ""}`;
            const emailMatches = [...pText.matchAll(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g)];
            for (const em of emailMatches) {
              const email = em[0].toLowerCase();
              if (isPersonalEmail(email) && isEmailDomainRelated(email, companyName)) {
                bestMatch.email = email;
                break;
              }
            }
            if (bestMatch.email) break;
          }

          // Apply the LinkedIn contact
          await applyContact(g, {
            name: bestMatch.name,
            email: bestMatch.email ?? g.projects[0].contactEmail ?? "",
            phone: bestMatch.phone,
          });
          enrichedKeys.add(devKey);
          logger.info({ devKey, name: bestMatch.name, title: bestMatch.title, email: bestMatch.email }, "Contact enriched via LinkedIn");
        }
      }
    } catch (err) {
      logger.warn({ err }, "Contact enrichment: Phase 3 LinkedIn failed");
    }
  }

  logger.info(
    {
      checked: toEnrich.length,
      updated,
      runId,
      durationMs: Math.round(performance.now() - enrichmentStartedAt),
    },
    "Contact enrichment complete",
  );
  if (runId) {
    await db.update(contactEnrichmentsTable)
      .set({ status: "completed", completedAt: new Date(), checked: toEnrich.length, updated })
      .where(eq(contactEnrichmentsTable.id, runId));
  }
  return { checked: toEnrich.length, updated };
}

/**
 * Start an enrichment run in the background and return the run ID.
 * The caller receives 202 Accepted immediately; the enrichment runs asynchronously.
 */
export async function startEnrichment(): Promise<number> {
  const [run] = await db.insert(contactEnrichmentsTable)
    .values({ status: "running", checked: 0, updated: 0 })
    .returning();

  const runId = run.id;

  // Kick off the long-running work without awaiting
  enrichMissingContacts(runId).catch((err: Error) => {
    logger.error({ err, runId }, "Contact enrichment background task failed");
    db.update(contactEnrichmentsTable)
      .set({ status: "failed", completedAt: new Date(), errorMessage: err.message })
      .where(eq(contactEnrichmentsTable.id, runId))
      .catch((e) => logger.error({ err: e, runId }, "Failed to mark enrichment as failed"));
  });

  return runId;
}

// ──────────────────────────────────────────────────────────────

/** Extract a readable source name from a URL */
function extractSourceName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    // Map known domains to friendly names
    const known: Record<string, string> = {
      "abc.net.au": "ABC News Australia",
      "theaustralian.com.au": "The Australian",
      "afr.com": "Australian Financial Review",
      "smh.com.au": "Sydney Morning Herald",
      "theage.com.au": "The Age",
      "heraldsun.com.au": "Herald Sun",
      "couriermail.com.au": "Courier Mail",
      "businessnewsaustralia.com": "Business News Australia",
      "spglobal.com": "S&P Global",
      "globalconstructionnews.com": "Global Construction News",
      "solarpowerworldonline.com": "Solar Power World",
      "rechargenews.com": "Recharge News",
      "windpowermonthly.com": "Wind Power Monthly",
      "energymonitor.ai": "Energy Monitor",
      "businessdesk.co.nz": "BusinessDesk NZ",
      "stuff.co.nz": "Stuff NZ",
      "nzherald.co.nz": "NZ Herald",
      "greenbuildingadvisor.com": "Green Building Advisor",
      // New industry news sources
      "esdnews.com.au": "ESD News",
      "solarquarter.com": "SolarQuarter Australia",
      "greenreview.com.au": "Green Review",
      "carbonnews.co.nz": "Carbon News NZ",
      "scoop.co.nz": "Scoop NZ",
      // Government / regulatory
      "cer.gov.au": "Clean Energy Regulator",
      "coordinatorgeneral.qld.gov.au": "QLD Coordinator-General",
      "planningportal.nsw.gov.au": "NSW Planning Portal",
      "epa.tas.gov.au": "Tasmania EPA",
      "recfit.tas.gov.au": "ReCFIT Tasmania",
      "transgrid.com.au": "Transgrid Australia",
      "powerlink.com.au": "Powerlink Queensland",
      "transpower.co.nz": "Transpower New Zealand",
      "epa.govt.nz": "NZ EPA",
      "ea.govt.nz": "NZ Electricity Authority",
      "minister.dcceew.gov.au": "DCCEEW Ministerial Media",
      // Utility / developer sites that may appear as source URLs
      "lightsourcebp.com": "LightsourceBP",
      "neoen.com": "Neoen",
      "edifyenergy.com": "Edify Energy",
      "iberdrola.com.au": "Iberdrola Australia",
      "ox2.com": "OX2 Australia",
      "flowpower.com.au": "Flow Power Australia",
      "nzcleanenergy.nz": "NZ Clean Energy",
      "firstsolar.com": "First Solar",
      "canadian.com": "Canadian Solar",
    };
    return known[host] ?? host;
  } catch {
    return "Web";
  }
}

// ── ChatGPT web-search fallback ───────────────────────────────────────────────

type GptScraperOpenAI = {
  responses: {
    create: (opts: {
      model: string;
      tools: { type: string }[];
      input: string;
      max_output_tokens: number;
    }) => Promise<{ output_text?: string; output?: { type: string; text?: string }[] }>;
  };
};

interface GptSourceProject {
  name?: string;
  description?: string;
  capacity_mw?: number | null;
  developer?: string | null;
  location?: string | null;
  country?: string;
  status?: string;
  source_url?: string;
  announced_date?: string;
}

/**
 * ChatGPT web-search fallback for a single source.
 * Called when standard HTML/RSS parsing returns 0 projects.
 */
async function scrapeWithChatGpt(
  source: ScrapeSource,
  startDate?: string,
  endDate?: string,
): Promise<ScrapedProject[]> {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    logScanSourceOutcome(source.name, "skipped-missing-credentials", {
      missing: ["OPENAI_API_KEY"],
    });
    return [];
  }

  try {
    const { openai } = await import("@workspace/integrations-openai-ai-server");
    const gpt = openai as unknown as GptScraperOpenAI;
    const today = new Date().toISOString().slice(0, 10);
    const strategy = getSourceRepairStrategy(source.name);
    const officialHosts = [...new Set(strategy.officialUrls.map((url) => new URL(url).hostname))];

    const dateClause = startDate || endDate
      ? ` announced between ${startDate ?? "any date"} and ${endDate ?? today}`
      : "";

    const prompt = `Today is ${today}. Search "${source.name}" (${source.searchUrl}) for utility-scale solar energy or solar+BESS hybrid projects in Australia or New Zealand${dateClause}.

Find all solar/PV projects ≥5 MW that have been announced, approved, or are under assessment. Include the project's MW capacity if stated.

Return ONLY a valid JSON array (no prose, no markdown fences):
[
  {
    "name": "Example Solar Farm",
    "description": "150 MW solar farm in regional NSW",
    "capacity_mw": 150,
    "developer": "Acme Energy Pty Ltd",
    "location": "Regional NSW",
    "country": "AU",
    "status": "announced",
    "source_url": "https://example.com/project/example-solar-farm",
    "announced_date": "2024-03-15"
  }
]

Rules:
- Search and cite ONLY these approved official hostnames: ${officialHosts.join(", ")}
- Do not use news aggregators, developer sites, social media, cached copies, or unofficial mirrors
- country: "AU" or "NZ" only
- status: "announced" or "under_development"
- capacity_mw: number or null if unknown — only include projects ≥5 MW or where size is unknown
- source_url: direct URL to the specific project page/article if known, otherwise use ${source.searchUrl}
- announced_date: YYYY-MM-DD format, null if unknown
- Exclude wind-only projects, mining, roads, housing
- Return [] if nothing relevant found`;

    const response = await gpt.responses.create({
      model: "gpt-5.6-sol",
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

    // Strip markdown fences, find JSON array
    text = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1) return [];

    const parsed = JSON.parse(text.slice(start, end + 1)) as GptSourceProject[];
    if (!Array.isArray(parsed)) return [];

    const results: ScrapedProject[] = [];
    for (const r of parsed) {
      if (!r.name) continue;
      const cap = typeof r.capacity_mw === "number" ? r.capacity_mw : null;
      let sourceUrl = source.searchUrl;
      if (r.source_url) {
        try {
          const candidateUrl = new URL(r.source_url);
          if (officialHosts.includes(candidateUrl.hostname)) sourceUrl = candidateUrl.href;
        } catch { /* retain the configured official URL */ }
      }
      if (cap !== null && cap < 5) continue; // respect ≥5 MW gate
      const announcedDate = r.announced_date ?? today;
      if (startDate && announcedDate < startDate) continue;
      if (endDate && announcedDate > endDate) continue;
      results.push({
        name: r.name,
        description: r.description ?? r.name,
        capacityMw: cap,
        developer: r.developer ?? null,
        location: r.location ?? null,
        country: (r.country === "NZ" ? "NZ" : "AU") as "AU" | "NZ",
        status: (r.status === "under_development" ? "under_development" : "announced") as "announced" | "under_development",
        sourceUrl,
        sourceName: source.name,
        announcedDate,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
      });
    }

    const eligibleResults = results.filter(isEligibleScanProject);
    logger.info({ source: source.name, found: eligibleResults.length }, "ChatGPT fallback complete");
    return eligibleResults;
  } catch (err) {
    logger.warn({ err, source: source.name }, "ChatGPT fallback failed");
    return [];
  }
}

// ── Per-source scrape ─────────────────────────────────────────────────────────

function sourceRepairCandidatesToProjects(
  candidates: readonly SourceRepairCandidate[],
  source: ScrapeSource,
  startDate?: string,
  endDate?: string,
): ScrapedProject[] {
  const today = new Date().toISOString().slice(0, 10);
  return candidates.flatMap((candidate) => {
    const announcedDate = candidate.announcedDate ?? today;
    if (startDate && announcedDate < startDate) return [];
    if (endDate && announcedDate > endDate) return [];
    const project: ScrapedProject = {
      ...candidate,
      country: source.country,
      sourceName: source.name,
      announcedDate,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
    };
    return isEligibleScanProject(project) ? [project] : [];
  });
}

async function scrapeAemoGenerationWorkbook(
  source: ScrapeSource,
  startDate?: string,
  endDate?: string,
): Promise<ScrapedProject[]> {
  const response = await fetch(AEMO_GENERATION_WORKBOOK_URL, {
    headers: {
      "User-Agent": "USST/1.0 (approved public energy-data ingestion)",
      Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new SourceRequestError(
      `AEMO workbook returned HTTP ${response.status}`,
      response.status === 403 ? "blocked" : "http-error",
      response.url || AEMO_GENERATION_WORKBOOK_URL,
      response.status,
    );
  }
  const { read: readWorkbook, utils: workbookUtils } = await import("xlsx");
  const workbook = readWorkbook(Buffer.from(await response.arrayBuffer()), { type: "buffer" });
  const sheet = workbook.Sheets["Generator Information"];
  if (!sheet) throw new Error("AEMO Generator Information worksheet is missing");
  const rows = workbookUtils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
  const today = new Date().toISOString().slice(0, 10);
  return sourceRepairCandidatesToProjects(
    parseAemoGenerationRows(rows, AEMO_GENERATION_WORKBOOK_URL, today),
    source,
    startDate,
    endDate,
  );
}

async function scrapeEpbcOfficialLayer(
  source: ScrapeSource,
  startDate?: string,
  endDate?: string,
): Promise<ScrapedProject[]> {
  const { fetchEpbcRecords } = await import("./epbc-scraper");
  const records = await fetchEpbcRecords(startDate, endDate, {
    supplementStructuredRecords: false,
    fallback: async () => { throw new Error("EPBC official ArcGIS layer unavailable"); },
  });
  const candidates: SourceRepairCandidate[] = records
    .filter((record) => record.isSolar)
    .map((record) => ({
      name: record.projectName,
      description: record.rawDescription ?? `${record.technologyType ?? "Solar"} EPBC referral ${record.epbcNumber}`,
      capacityMw: record.sizeMw,
      developer: record.proponent,
      location: record.location ?? record.state,
      status: record.isApproved ? "under_development" : "announced",
      sourceUrl: record.sourceUrl ?? source.searchUrl,
      announcedDate: record.referralDate,
    }));
  return sourceRepairCandidatesToProjects(candidates, source, startDate, endDate);
}

function finalFailureOutcome(failures: readonly unknown[]): ScanSourceOutcome {
  if (failures.some((error) => error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))) {
    return "timeout";
  }
  const problems = failures
    .filter((error): error is SourceRequestError => error instanceof SourceRequestError)
    .map((error) => error.problem);
  if (problems.includes("timeout")) return "timeout";
  if (problems.includes("blocked")) return "blocked";
  return "extraction-failed";
}

function logDirectSourceFailure(source: string, error: unknown): void {
  if (error instanceof SourceRequestError) {
    logScanSourceOutcome(
      source,
      error.problem === "blocked" ? "blocked" : error.problem === "timeout" ? "timeout" : "extraction-failed",
      { err: error, url: error.url, reason: error.problem },
    );
    return;
  }
  logScanSourceOutcome(source, "extraction-failed", { err: error });
}

async function scrapeSource(
  source: ScrapeSource,
  startDate?: string,
  endDate?: string,
): Promise<ScrapedProject[]> {
  const projects: ScrapedProject[] = [];
  const seenUrls = new Set<string>();
  const failures: unknown[] = [];
  const strategy = getSourceRepairStrategy(source.name);
  const startedAt = Date.now();
  let directSucceeded = false;
  let fallbackUsed = false;

  logScanSourceOutcome(source.name, "attempted", {
    method: strategy.mode,
    url: source.searchUrl,
  });

  function addUnique(items: readonly ScrapedProject[]): void {
    for (const project of items) {
      if (seenUrls.has(project.sourceUrl)) continue;
      seenUrls.add(project.sourceUrl);
      projects.push(project);
    }
  }

  async function useOpenAiFallback(reason: string): Promise<void> {
    fallbackUsed = true;
    logScanSourceOutcome(source.name, "fallback-used", {
      method: "openai-web-search",
      reason,
    });
    addUnique(await scrapeWithChatGpt(source, startDate, endDate));
  }

  try {
    if (strategy.mode === "openai-first") {
      await useOpenAiFallback(
        "official direct access is unreliable or does not expose extractable project rows",
      );
    } else if (strategy.mode === "aemo-workbook") {
      try {
        addUnique(await scrapeAemoGenerationWorkbook(source, startDate, endDate));
        directSucceeded = true;
      } catch (err) {
        failures.push(err);
        logDirectSourceFailure(source.name, err);
        logger.warn({ err, source: source.name }, "AEMO official workbook extraction failed");
        await useOpenAiFallback("official AEMO workbook was unavailable or changed shape");
      }
    } else if (strategy.mode === "epbc-arcgis") {
      try {
        addUnique(await scrapeEpbcOfficialLayer(source, startDate, endDate));
        directSucceeded = true;
      } catch (err) {
        failures.push(err);
        logDirectSourceFailure(source.name, err);
        logger.warn({ err, source: source.name }, "EPBC official ArcGIS extraction failed");
        await useOpenAiFallback("official EPBC ArcGIS feature layer was unavailable");
      }
    } else if (strategy.mode === "structured-html") {
      const urls = [source.searchUrl, ...(source.extraUrls ?? [])];
      const results = await Promise.allSettled(urls.map((url) => fetchForSource(source, url)));
      for (let index = 0; index < results.length; index++) {
        const result = results[index];
        if (result.status === "fulfilled") {
          directSucceeded = true;
          addUnique(sourceRepairCandidatesToProjects(
            parseOfficialProjectHtml(result.value, urls[index]),
            source,
            startDate,
            endDate,
          ));
        } else {
          failures.push(result.reason);
          logDirectSourceFailure(source.name, result.reason);
          logger.warn({ err: result.reason, source: source.name, url: urls[index] }, "Structured HTML fetch failed");
        }
      }
    } else if (strategy.mode === "browse-ai-or-openai") {
      const robotId = strategy.browseRobotIdEnvironmentKey
        ? process.env[strategy.browseRobotIdEnvironmentKey]?.trim()
        : undefined;
      if (robotId && process.env.BROWSE_AI_API_KEY?.trim()) {
        addUnique(await scrapeWithBrowseAi(robotId, source.searchUrl, source, startDate, endDate));
        directSucceeded = projects.length > 0;
      }
      if (projects.length === 0) {
        await useOpenAiFallback(robotId
          ? "approved Browse.AI robot returned no qualifying projects"
          : "approved Browse.AI robot is not configured");
      }
    } else {
      if (source.feedUrl) {
        try {
          const xml = await fetchForSource(source, source.feedUrl);
          directSucceeded = true;
          addUnique(parseRssFeed(xml, source, startDate, endDate));
          logger.info({ source: source.name, rssCount: projects.length }, "RSS scraped");
        } catch (err) {
          failures.push(err);
          logDirectSourceFailure(source.name, err);
          logger.warn({ err, source: source.name, url: source.feedUrl }, "RSS fetch failed");
        }
      }

      const htmlUrls = [source.searchUrl, ...(source.extraUrls ?? [])];
      const htmlResults = await Promise.allSettled(
        htmlUrls.map((url) => fetchForSource(source, url)),
      );
      for (let index = 0; index < htmlResults.length; index++) {
        const result = htmlResults[index];
        if (result.status === "fulfilled") {
          directSucceeded = true;
          addUnique(parseHtmlPage(result.value, source, startDate, endDate));
        } else {
          failures.push(result.reason);
          logDirectSourceFailure(source.name, result.reason);
          logger.warn({ err: result.reason, url: htmlUrls[index], source: source.name }, "HTML URL fetch failed");
        }
      }
    }

    if (projects.length === 0 && strategy.fallback === "openai" && !fallbackUsed) {
      await useOpenAiFallback("official direct extraction returned no qualifying projects");
    }
  } catch (err) {
    failures.push(err);
    logger.warn({ err, source: source.name }, "Failed to scrape source");
  }

  const outcome: ScanSourceOutcome = projects.length > 0
    ? "success"
    : directSucceeded
      ? "empty"
      : finalFailureOutcome(failures);
  logScanSourceOutcome(source.name, outcome, {
    projectCount: projects.length,
    durationMs: Date.now() - startedAt,
    method: fallbackUsed ? `${strategy.mode}+openai-web-search` : strategy.mode,
    reason: outcome === "empty" ? "no qualifying projects" : undefined,
    err: outcome === "extraction-failed" ? failures.at(-1) : undefined,
  });
  return projects;
}

export async function runScan(scanId: number, startDate?: string, endDate?: string): Promise<void> {
  const scanStartedAt = performance.now();
  const configuredSourceCount = SOURCES.length + 2;
  validateSourceRepairStrategies(CONFIGURED_SCAN_SOURCE_NAMES);
  logger.info(
    { scanId, startDate, endDate, configuredSourceCount },
    "Starting scan",
  );
  if (configuredSourceCount !== 34) {
    logger.error(
      { configuredSourceCount, expectedSourceCount: 34 },
      "Scan source registry parity mismatch",
    );
  }

  const persistedLineage: ScanProjectLineage[] = [];
  const linkedProjectIds = new Set<number>();
  let sourcesScanned = 0;
  let errorMessage: string | null = null;

  try {
    const allScraped: ScrapedProject[] = [];
    let progressUpdate = Promise.resolve();

    async function recordSourceComplete(): Promise<void> {
      sourcesScanned++;
      const completedCount = sourcesScanned;
      progressUpdate = progressUpdate.then(async () => {
        await db
          .update(scansTable)
          .set({ sourcesScanned: completedCount })
          .where(eq(scansTable.id, scanId));
      });
      await progressUpdate;
    }

    const genericResults = await mapWithConcurrency(SOURCES, 4, async (source) => {
      try {
        return await scrapeSource(source, startDate, endDate);
      } catch (err) {
        logger.warn({ err, source: source.name }, "Source scrape error");
        return [];
      } finally {
        await recordSourceComplete();
      }
    });
    for (const scraped of genericResults) allScraped.push(...scraped);

    // Dedicated AltEnergy authenticated scrape (separate from generic SOURCES)
    const altEnergyStartedAt = Date.now();
    try {
      logScanSourceOutcome("AltEnergy Australia", "attempted", { method: "authenticated" });
      const altEnergyProjects = await scrapeAltEnergy(startDate, endDate);
      allScraped.push(...altEnergyProjects);
      if (process.env.ALTENERGY_USERNAME?.trim() && process.env.ALTENERGY_PASSWORD?.trim()) {
        logScanSourceOutcome(
          "AltEnergy Australia",
          altEnergyProjects.length > 0 ? "success" : "empty",
          { projectCount: altEnergyProjects.length, durationMs: Date.now() - altEnergyStartedAt, method: "authenticated" },
        );
      }
    } catch (err) {
      logger.warn({ err }, "AltEnergy scrape error");
      logScanSourceOutcome("AltEnergy Australia", "extraction-failed", {
        err,
        durationMs: Date.now() - altEnergyStartedAt,
        method: "authenticated",
      });
    } finally {
      await recordSourceComplete();
    }

    // Dedicated LUVI authenticated development-pipeline scrape.
    const luviStartedAt = Date.now();
    try {
      const luviMissing = process.env.LUVI_PASSWORD?.trim() ? [] : ["LUVI_PASSWORD"];
      let luviProjects: ScrapedProject[] = [];
      if (luviMissing.length > 0) {
        logScanSourceOutcome(LUVI_SOURCE_NAME, "skipped-missing-credentials", {
          missing: luviMissing,
          method: "authenticated",
        });
      } else {
        logScanSourceOutcome(LUVI_SOURCE_NAME, "attempted", { method: "authenticated" });
        luviProjects = await scrapeLuvi(startDate, endDate);
        allScraped.push(...luviProjects);
        logScanSourceOutcome(
          LUVI_SOURCE_NAME,
          luviProjects.length > 0 ? "success" : "empty",
          { projectCount: luviProjects.length, durationMs: Date.now() - luviStartedAt, method: "authenticated" },
        );
      }
    } catch (err) {
      logger.warn({ err }, "LUVI scrape error");
      logScanSourceOutcome(LUVI_SOURCE_NAME, "extraction-failed", {
        err,
        durationMs: Date.now() - luviStartedAt,
        method: "authenticated",
      });
    } finally {
      await recordSourceComplete();
    }

    // Build a lookup of existing sourceUrl -> { id, announcedDate } for quick checking
    const existingByUrl = new Map<string, number>();
    const existingDateByUrl = new Map<string, string>(); // sourceUrl -> DB-stored announcedDate
    const eligibleExistingProjectIds = new Set<number>();
    const existingRows = await db.select({
      id: projectsTable.id,
      name: projectsTable.name,
      description: projectsTable.description,
      capacityMw: projectsTable.capacityMw,
      country: projectsTable.country,
      sourceUrl: projectsTable.sourceUrl,
      announcedDate: projectsTable.announcedDate,
    }).from(projectsTable);
    for (const r of existingRows) {
      if (r.sourceUrl) {
        existingByUrl.set(r.sourceUrl, r.id);
        if (r.announcedDate) existingDateByUrl.set(r.sourceUrl, r.announcedDate);
        if (isEligibleScanProject(r)) eligibleExistingProjectIds.add(r.id);
      }
    }

    // Load PVH fallback contacts once for the whole scan
    const pvhContacts = await db.select().from(pvhContactsTable);

    // Insert / record every project found by this scan (deduplicate by sourceUrl)
    for (const project of allScraped) {
      // Pre-insert quality gate — skip noise
      if (isNoisyProjectName(project.name)) {
        if (project.sourceUrl) existingByUrl.set(project.sourceUrl, -1); // sentinel
        continue;
      }
      const ineligibilityReason = getProjectIneligibilityReason(project);
      if (ineligibilityReason) {
        logger.info(
          {
            project: project.name,
            source: project.sourceName,
            capacityMw: project.capacityMw,
            reason: ineligibilityReason,
          },
          "Quality gate: ineligible scan project dropped",
        );
        if (project.sourceUrl) existingByUrl.set(project.sourceUrl, -1);
        continue;
      }
      // Date-range gate: when a range is specified, only accept projects whose
      // announced date falls within it. For existing projects (already in DB),
      // use the DB-stored date — some sources assign today's date as a fallback
      // for undated items, which would otherwise let old March/May records slip
      // through. For new projects, use the scraped date directly.
      if (startDate || endDate) {
        const isExisting = !!project.sourceUrl && existingByUrl.has(project.sourceUrl);
        const effectiveDate = isExisting && project.sourceUrl
          ? (existingDateByUrl.get(project.sourceUrl) ?? project.announcedDate)
          : project.announcedDate;
        if (startDate && effectiveDate < startDate) continue;
        if (endDate && effectiveDate > endDate) continue;
      }

      const isNew = !project.sourceUrl || !existingByUrl.has(project.sourceUrl);

      try {
        const existingProjectId = isNew ? null : existingByUrl.get(project.sourceUrl!)!;
        if (existingProjectId === -1 || (existingProjectId != null && linkedProjectIds.has(existingProjectId))) {
          continue;
        }
        if (existingProjectId != null && !eligibleExistingProjectIds.has(existingProjectId)) {
          logger.info(
            { project: project.name, projectId: existingProjectId },
            "Quality gate: ineligible historical project not linked to new scan",
          );
          continue;
        }

        const projectId = await db.transaction(async (tx) => {
          let persistedProjectId = existingProjectId;

          if (persistedProjectId == null) {
            // Apply PVH fallback contact if the project has no contact info
            let contactName = project.contactName;
            let contactEmail = project.contactEmail;
            let contactPhone = project.contactPhone;

            if (!contactEmail && !contactName && project.developer) {
              const fallback = matchFallbackContact(project.developer, pvhContacts);
              if (fallback) {
                contactName = fallback.name;
                contactEmail = fallback.email;
                logger.info({ project: project.name, developer: project.developer, fallbackEmail: fallback.email }, "Applied PVH fallback contact");
              }
            }

            const [inserted] = await tx.insert(projectsTable).values({
              name: project.name,
              description: project.description,
              capacityMw: String(project.capacityMw),
              developer: project.developer,
              epc: null,
              location: project.location,
              country: project.country,
              status: project.status,
              sourceUrl: project.sourceUrl,
              sourceName: project.sourceName,
              announcedDate: project.announcedDate,
              contactName,
              contactEmail,
              contactPhone,
              scanId,
            }).returning({ id: projectsTable.id });
            persistedProjectId = inserted.id;
          }

          if (persistedProjectId == null) {
            throw new Error("Project insert did not return an id");
          }

          // Record all found projects (new and existing) in scan_projects.
          await tx.insert(scanProjectsTable).values({
            scanId,
            projectId: persistedProjectId,
            projectName: project.name,
            isNew,
          });

          return persistedProjectId;
        });

        linkedProjectIds.add(projectId);
        persistedLineage.push({ projectId, isNew });
        if (isNew && project.sourceUrl) existingByUrl.set(project.sourceUrl, projectId);
      } catch (err) {
        logger.warn({ err, project: project.name }, "Failed to insert project or scan relationship");
      }
    }

    const { projectsFound, newProjects } = summarizeScanLineage(persistedLineage);

    await db
      .update(scansTable)
      .set({
        status: "completed",
        completedAt: new Date(),
        sourcesScanned,
        projectsFound,
        newProjects,
      })
      .where(eq(scansTable.id, scanId));

    logger.info(
      {
        scanId,
        sourcesScanned,
        projectsFound,
        newProjects,
        durationMs: Math.round(performance.now() - scanStartedAt),
      },
      "Scan completed",
    );
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err, scanId }, "Scan failed");
    const { projectsFound, newProjects } = summarizeScanLineage(persistedLineage);

    await db
      .update(scansTable)
      .set({
        status: "failed",
        completedAt: new Date(),
        sourcesScanned,
        projectsFound,
        newProjects,
        errorMessage,
      })
      .where(eq(scansTable.id, scanId));
  }
}
