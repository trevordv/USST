/**
 * Solar project scraper
 *
 * Fetches content from Australian / New Zealand energy news sources and extracts
 * solar and BESS project announcements (≥5 MW) using keyword and pattern matching.
 *
 * Only the 28 approved sources listed in replit.md are scanned — no broad search,
 * no developer page scraping, no ad-hoc sites.
 *
 * Sources covered:
 *  - News: Renew Economy, AltEnergy, PV Magazine Australia, EcoGeneration,
 *    Utility Magazine, ESD News, RenewMap
 *  - Government: ARENA, CER, AEMO, DCCEEW, EPBC Act, NSW Planning Portal,
 *    NSW Planning, Planning Victoria, QLD Coordinator-General, SA Energy & Mining,
 *    WA EPA, NT Development, Tasmania EPA
 *  - NZ: Electricity Authority, Transpower, NZ Fast-track, NZ EPA
 *  - AltEnergy is authenticated via WordPress login and handled separately
 *
 * Apify Google Search is used ONLY for the explicit contact-enrichment feature
 * (POST /projects/enrich-contacts), never during scanning.
 */

import { db, projectsTable, scansTable, scanProjectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// AltEnergy authenticated session
// ---------------------------------------------------------------------------

const ALTENERGY_BASE = "https://altenergy.com.au";
const ALTENERGY_LOGIN_URL = `${ALTENERGY_BASE}/login`;

/** In-memory cookie jar for AltEnergy session cookies */
let altEnergyCookies: string[] = [];
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
  },
  {
    name: "Utility Magazine",
    country: "AU",
    searchUrl: "https://utilitymagazine.com.au/category/electricity/solar/",
  },
  {
    name: "ESD News",
    country: "AU",
    searchUrl: "https://esdnews.com.au/tag/solar/",
    feedUrl: "https://esdnews.com.au/feed/",
  },
  {
    name: "RenewMap",
    country: "AU",
    searchUrl: "https://renewmap.com.au/resources/",
  },
  // AltEnergy is handled by scrapeAltEnergy() — omit from generic SOURCES
  // so it doesn't go through the generic HTML parser
  {
    name: "ARENA",
    country: "AU",
    searchUrl: "https://arena.gov.au/news/?s=solar",
    extraUrls: [
      "https://arena.gov.au/blog/",
      "https://arena.gov.au/projects/",
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
    name: "Capacity Investment Scheme",
    country: "AU",
    searchUrl: "https://www.dcceew.gov.au/energy/renewable/capacity-investment-scheme/closed-cis-tenders",
  },
  {
    name: "EPBC Act Referrals",
    country: "AU",
    searchUrl: "https://epbcpublicportal.environment.gov.au/",
  },
  {
    name: "NSW Planning Portal",
    country: "AU",
    searchUrl: "https://www.planningportal.nsw.gov.au/major-projects/projects",
  },
  {
    name: "NSW Planning Renewable Energy",
    country: "AU",
    searchUrl: "https://www.planning.nsw.gov.au/policy-and-legislation/renewable-energy",
  },
  {
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
    name: "NZ Fast-track",
    country: "NZ",
    searchUrl: "https://www.fasttrack.govt.nz/projects",
  },
  {
    name: "NZ EPA",
    country: "NZ",
    searchUrl: "https://www.epa.govt.nz/fast-track-consenting/",
  },
];

// Keywords that indicate a project is in early stage (not yet generating)
const EARLY_STAGE_KEYWORDS = [
  "announced", "proposed", "plans to build", "planning approval",
  "resource consent", "development approval", "da approved",
  "under development", "under construction", "planning",
  "feasibility", "pre-development", "early stage", "new project",
  "to build", "will build", "breaking ground", "scoping",
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
    return await response.text();
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

    // Check if it's early stage
    if (!isEarlyStage(fullText)) continue;

    // Parse date
    let announcedDate: string;
    try {
      const d = pubDate ? new Date(pubDate) : new Date();
      announcedDate = d.toISOString().slice(0, 10);
    } catch {
      announcedDate = new Date().toISOString().slice(0, 10);
    }

    // Apply date range filter
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
  "solar", "pv", "photovoltaic", "renewable", "wind farm", "battery",
  "bess", "energy storage", "green energy", "clean energy",
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
 */
function parseWattNewsListing(html: string): Array<{ url: string; date: string }> {
  const results: Array<{ url: string; date: string }> = [];
  // Match <div class="pdf-block-watts-new"> blocks
  const blockRe = /<div[^>]*class="[^"]*pdf-block-watts-new[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
  for (const block of html.matchAll(blockRe)) {
    const inner = block[1];
    const linkMatch = inner.match(/href="(https?:\/\/altenergy\.com\.au\/watt_news\/show\/[^"]+)"/i);
    if (!linkMatch) continue;
    const url = linkMatch[1];
    // Title format: "Watts News, 12 June 2026"
    const titleMatch = inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const title = titleMatch?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
    // Parse "12 June 2026" part
    const dateMatch = title.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    let date = new Date().toISOString().slice(0, 10);
    if (dateMatch) {
      const month = MONTH_MAP[dateMatch[2].toLowerCase()];
      if (month) date = `${dateMatch[3]}-${month}-${dateMatch[1].padStart(2, "0")}`;
    }
    results.push({ url, date });
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
        contactEmail: rec.contact_email ?? null,
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
        const text = await fetchWattNewsArticleText(newsletter.url);
        // Extract "NEW PROJECT:" and "PROJECT UPDATE:" sections from the newsletter text
        const sections = text.split(/(?=NEW PROJECT:|PROJECT UPDATE:|PROJECT MILESTONE:)/i);
        for (const section of sections) {
          const isNew = /^NEW PROJECT:/i.test(section);
          const isUpdate = /^PROJECT UPDATE:/i.test(section);
          if (!isNew && !isUpdate) continue;

          const snippet = section.slice(0, 500);
          const sectionLower = snippet.toLowerCase();
          if (!SOLAR_TITLE_KEYWORDS.some((kw) => sectionLower.includes(kw))) continue;

          // Extract project name from first line after the label
          const nameMatch = section.match(/^(?:NEW PROJECT|PROJECT UPDATE|PROJECT MILESTONE):\s*([^\n.]+)/i);
          const name = nameMatch?.[1]?.trim();
          if (!name || name.length < 5) continue;

          const projectUrl = `${newsletter.url}#${encodeURIComponent(name.slice(0, 40))}`;
          if (seenUrls.has(projectUrl)) continue;
          seenUrls.add(projectUrl);

          projects.push({
            name,
            description: snippet.replace(/^[^\n]+\n/, "").trim().slice(0, 600),
            capacityMw: extractCapacity(snippet),
            developer: extractDeveloper(snippet),
            location: extractLocation(snippet, "AU"),
            country: "AU",
            status: isNew ? "announced" : "under_development",
            sourceUrl: newsletter.url,
            sourceName: "AltEnergy Watts News",
            announcedDate: newsletter.date,
            contactName: null,
            contactEmail: null,
            contactPhone: null,
          });
        }
      } catch (err) {
        logger.warn({ err, url: newsletter.url }, "Watt News article fetch failed");
      }
    }
  } catch (err) {
    logger.warn({ err }, "AltEnergy watt_news scrape failed");
  }

  logger.info({ total: projects.length }, "AltEnergy scrape complete");
  return projects;
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
    try {
      const d = dateMatch ? new Date(dateMatch[0]) : new Date();
      if (isNaN(d.getTime())) throw new Error("invalid");
      announcedDate = d.toISOString().slice(0, 10);
    } catch {
      announcedDate = new Date().toISOString().slice(0, 10);
    }

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

async function scrapeUrlForContact(url: string): Promise<{ name: string | null; email: string; phone: string | null } | null> {
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
      if (isPersonalEmail(email)) {
        const name = extractNameNearEmail(context);
        const phoneRaw = context.match(/\(?\+?[\d]{1,4}[\s\-.]?\(?\d{2,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}/);
        return { name, email, phone: phoneRaw?.[0]?.replace(/\s+/g, " ").trim() ?? null };
      }
    }
  } catch { /* timeout / network */ }
  return null;
}

type ContactResult = { name: string | null; email: string; phone: string | null };

/**
 * Enrich projects that are missing personal contact details.
 * Phase 1: Scrape developer/project websites directly.
 * Phase 2: Apify Google Search → visit top result URLs.
 */
export async function enrichMissingContacts(): Promise<{ checked: number; updated: number }> {
  const GENERIC_PREFIXES = [
    "info@", "admin@", "contact@", "hello@", "enquiries@", "enquiry@",
    "general@", "mail@", "projects@", "team@", "reception@", "office@",
    "support@", "sales@", "media@", "pr@", "project@", "feedback@",
  ];

  function needsEnrichment(p: { contactEmail: string | null; contactName: string | null }): boolean {
    if (!p.contactEmail && !p.contactName) return true;
    if (p.contactEmail && GENERIC_PREFIXES.some(px => p.contactEmail!.toLowerCase().startsWith(px))) return true;
    return false;
  }

  const allProjects = await db.select().from(projectsTable);
  const toEnrich = allProjects.filter(needsEnrichment);
  logger.info({ count: toEnrich.length }, "Contact enrichment: starting");
  if (toEnrich.length === 0) return { checked: 0, updated: 0 };

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
  for (const [devKey, g] of groups) {
    if (!g.domain) { noDomainGroups.push([devKey, g]); continue; }

    for (const path of CONTACT_PATHS) {
      const contact = await scrapeUrlForContact(`https://${g.domain}${path}`);
      if (contact) {
        await applyContact(g, contact);
        enrichedKeys.add(devKey);
        logger.info({ devKey, email: contact.email }, "Contact enriched via domain scrape");
        break;
      }
    }
    if (!enrichedKeys.has(devKey)) noDomainGroups.push([devKey, g]);
  }

  // ── Phase 2: Apify Google Search for developers without a known domain ────
  const token = process.env.APIFY_API_TOKEN;
  const phaseTwo = noDomainGroups.filter(([k]) => !enrichedKeys.has(k));
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
        for (const result of results) {
          const text = `${result.title ?? ""} ${result.description ?? ""}`;
          const emailMatches = [...text.matchAll(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g)];
          for (const em of emailMatches) {
            const email = em[0].toLowerCase();
            if (isPersonalEmail(email)) {
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
            const contact = await scrapeUrlForContact(result.url);
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

  logger.info({ checked: toEnrich.length, updated }, "Contact enrichment complete");
  return { checked: toEnrich.length, updated };
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

async function scrapeSource(
  source: ScrapeSource,
  startDate?: string,
  endDate?: string
): Promise<ScrapedProject[]> {
  const projects: ScrapedProject[] = [];
  const seenUrls = new Set<string>();

  function addUnique(items: ScrapedProject[]) {
    for (const p of items) {
      if (!seenUrls.has(p.sourceUrl)) {
        seenUrls.add(p.sourceUrl);
        projects.push(p);
      }
    }
  }

  try {
    // 1. Try RSS feed first — best structured data
    if (source.feedUrl) {
      const xml = await fetchForSource(source, source.feedUrl);
      addUnique(parseRssFeed(xml, source, startDate, endDate));
      logger.info({ source: source.name, rssCount: projects.length }, "RSS scraped");
    }

    // 2. Scrape the primary search URL
    const searchHtml = await fetchForSource(source, source.searchUrl);
    addUnique(parseHtmlPage(searchHtml, source, startDate, endDate));

    // 3. Scrape extra URLs (authenticated category/search pages for AltEnergy)
    if (source.extraUrls) {
      for (const url of source.extraUrls) {
        try {
          const html = await fetchForSource(source, url);
          addUnique(parseHtmlPage(html, source, startDate, endDate));
        } catch (err) {
          logger.warn({ err, url, source: source.name }, "Extra URL scrape failed");
        }
      }
    }

    logger.info({ source: source.name, total: projects.length }, "Source scrape complete");
  } catch (err) {
    logger.warn({ err, source: source.name }, "Failed to scrape source");
  }

  return projects;
}

export async function runScan(scanId: number, startDate?: string, endDate?: string): Promise<void> {
  logger.info({ scanId, startDate, endDate }, "Starting scan");

  let totalProjectsFound = 0;
  let newProjects = 0;
  let sourcesScanned = 0;
  let errorMessage: string | null = null;

  try {
    // Fetch existing project source URLs to deduplicate
    const existingProjects = await db.select({ sourceUrl: projectsTable.sourceUrl }).from(projectsTable);
    const existingUrls = new Set(existingProjects.map((p) => p.sourceUrl).filter(Boolean));

    const allScraped: ScrapedProject[] = [];

    for (const source of SOURCES) {
      try {
        const scraped = await scrapeSource(source, startDate, endDate);
        allScraped.push(...scraped);
        sourcesScanned++;

        // Update scan progress in DB
        await db
          .update(scansTable)
          .set({ sourcesScanned, projectsFound: allScraped.length })
          .where(eq(scansTable.id, scanId));
      } catch (err) {
        logger.warn({ err, source: source.name }, "Source scrape error");
        sourcesScanned++;
      }
    }

    // Dedicated AltEnergy authenticated scrape (separate from generic SOURCES)
    try {
      const altEnergyProjects = await scrapeAltEnergy(startDate, endDate);
      allScraped.push(...altEnergyProjects);
      sourcesScanned++; // count AltEnergy as one source

      await db
        .update(scansTable)
        .set({ sourcesScanned, projectsFound: allScraped.length })
        .where(eq(scansTable.id, scanId));
    } catch (err) {
      logger.warn({ err }, "AltEnergy scrape error");
      sourcesScanned++;
    }

    totalProjectsFound = allScraped.length;

    // Build a lookup of existing sourceUrl -> projectId for quick checking
    const existingByUrl = new Map<string, number>();
    const existingRows = await db.select({ id: projectsTable.id, sourceUrl: projectsTable.sourceUrl }).from(projectsTable);
    for (const r of existingRows) {
      if (r.sourceUrl) existingByUrl.set(r.sourceUrl, r.id);
    }

    // Insert / record every project found by this scan (deduplicate by sourceUrl)
    for (const project of allScraped) {
      // Pre-insert quality gate — skip noise
      if (isNoisyProjectName(project.name)) {
        if (project.sourceUrl) existingByUrl.set(project.sourceUrl, -1); // sentinel
        continue;
      }
      // Only AU and NZ
      if (project.country && !["AU", "NZ"].includes(project.country)) {
        if (project.sourceUrl) existingByUrl.set(project.sourceUrl, -1);
        continue;
      }

      const isNew = !project.sourceUrl || !existingByUrl.has(project.sourceUrl);
      let projectId: number;

      try {
        if (isNew) {
          const [inserted] = await db.insert(projectsTable).values({
            name: project.name,
            description: project.description,
            capacityMw: project.capacityMw != null ? String(project.capacityMw) : null,
            developer: project.developer,
            epc: null,
            location: project.location,
            country: project.country,
            status: project.status,
            sourceUrl: project.sourceUrl,
            sourceName: project.sourceName,
            announcedDate: project.announcedDate,
            contactName: project.contactName,
            contactEmail: project.contactEmail,
            contactPhone: project.contactPhone,
            scanId,
          }).returning({ id: projectsTable.id });
          projectId = inserted.id;
          newProjects++;
          if (project.sourceUrl) existingByUrl.set(project.sourceUrl, projectId);
        } else {
          projectId = existingByUrl.get(project.sourceUrl!)!;
        }

        // Record this scan↔project relationship
        await db.insert(scanProjectsTable).values({
          scanId,
          projectId,
          projectName: project.name,
          isNew,
        });
      } catch (err) {
        logger.warn({ err, project: project.name }, "Failed to insert project or scan relationship");
      }
    }

    await db
      .update(scansTable)
      .set({
        status: "completed",
        completedAt: new Date(),
        sourcesScanned,
        projectsFound: totalProjectsFound,
        newProjects,
      })
      .where(eq(scansTable.id, scanId));

    logger.info({ scanId, sourcesScanned, totalProjectsFound, newProjects }, "Scan completed");
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err, scanId }, "Scan failed");

    await db
      .update(scansTable)
      .set({
        status: "failed",
        completedAt: new Date(),
        sourcesScanned,
        projectsFound: totalProjectsFound,
        newProjects,
        errorMessage,
      })
      .where(eq(scansTable.id, scanId));
  }
}
