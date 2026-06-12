/**
 * Solar project scraper
 *
 * Fetches content from Australian/New Zealand energy news sources and extracts
 * solar project announcements using keyword and pattern matching.
 *
 * Sources covered:
 *  - Renew Economy (reneweconomy.com.au)
 *  - AltEnergy (altenergy.com.au)
 *  - ARENA (arena.gov.au/news)
 *  - Clean Energy Council (cleanenergycouncil.org.au/news)
 *  - Australian Government Department of Climate Change (dcceew.gov.au)
 *  - NZ EECA / Electricity Authority / Transpower news
 *  - PV Magazine Australia (pv-magazine-australia.com)
 *  - Energy Magazine AU (energymagazine.com.au)
 */

import { db, projectsTable, scansTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

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
}

const SOURCES: ScrapeSource[] = [
  {
    name: "Renew Economy",
    country: "AU",
    searchUrl: "https://reneweconomy.com.au/?s=solar+project+announced",
    feedUrl: "https://reneweconomy.com.au/feed/",
  },
  {
    name: "AltEnergy Australia",
    country: "AU",
    searchUrl: "https://altenergy.com.au/?s=solar",
    feedUrl: "https://altenergy.com.au/feed/",
  },
  {
    name: "ARENA News",
    country: "AU",
    searchUrl: "https://arena.gov.au/news/?s=solar",
  },
  {
    name: "Clean Energy Council",
    country: "AU",
    searchUrl: "https://www.cleanenergycouncil.org.au/news?q=solar",
  },
  {
    name: "PV Magazine Australia",
    country: "AU",
    searchUrl: "https://www.pv-magazine-australia.com/?s=solar+project",
    feedUrl: "https://www.pv-magazine-australia.com/feed/",
  },
  {
    name: "Energy Magazine Australia",
    country: "AU",
    searchUrl: "https://www.energymagazine.com.au/?s=solar",
  },
  {
    name: "EECA New Zealand",
    country: "NZ",
    searchUrl: "https://www.eeca.govt.nz/search/?q=solar",
  },
  {
    name: "RNZ Business",
    country: "NZ",
    searchUrl: "https://www.rnz.co.nz/search?q=solar+project",
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

async function scrapeSource(
  source: ScrapeSource,
  startDate?: string,
  endDate?: string
): Promise<ScrapedProject[]> {
  const projects: ScrapedProject[] = [];

  try {
    // Try RSS feed first (more reliable structure)
    if (source.feedUrl) {
      const xml = await fetchWithTimeout(source.feedUrl);
      const rssProjects = parseRssFeed(xml, source, startDate, endDate);
      projects.push(...rssProjects);
    }

    // Also try the search page for HTML scraping
    if (projects.length === 0) {
      const html = await fetchWithTimeout(source.searchUrl);

      // Extract article snippets with basic heuristics
      const articleMatches = html.matchAll(
        /<(?:article|div|section)[^>]*class="[^"]*(?:post|article|entry|item|result)[^"]*"[^>]*>([\s\S]*?)<\/(?:article|div|section)>/gi
      );

      for (const match of articleMatches) {
        const snippet = match[1];
        const lower = snippet.toLowerCase();

        if (!lower.includes("solar")) continue;
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
    }
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

    totalProjectsFound = allScraped.length;

    // Insert new projects (deduplicate by sourceUrl)
    for (const project of allScraped) {
      if (project.sourceUrl && existingUrls.has(project.sourceUrl)) continue;

      try {
        await db.insert(projectsTable).values({
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
        });
        newProjects++;
        if (project.sourceUrl) existingUrls.add(project.sourceUrl);
      } catch (err) {
        logger.warn({ err, project: project.name }, "Failed to insert project");
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
