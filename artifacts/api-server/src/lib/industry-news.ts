import { db, industryNewsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

type Country = "AU" | "NZ";
type ContentType = "news" | "linkedin" | "journalist" | "industry";

interface SearchPlan {
  query: string;
  country: Country;
  hint?: ContentType;
}

interface NewsCandidate {
  title: string;
  summary: string | null;
  sourceName: string;
  sourceUrl: string;
  author: string | null;
  country: Country;
  contentType: ContentType;
  publishedDate: string;
}

const FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const APIFY_GOOGLE_SEARCH_URL =
  "https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?timeout=120&memory=512";

const GENERAL_MEDIA_HOSTS = new Set([
  "abc.net.au", "afr.com", "theaustralian.com.au", "smh.com.au", "theage.com.au",
  "businessdesk.co.nz", "nzherald.co.nz", "reuters.com", "bloomberg.com",
]);

const INDUSTRY_HOSTS = new Set([
  "reneweconomy.com.au", "pv-magazine-australia.com", "pv-magazine.com", "pv-tech.org",
  "energy-storage.news", "solarquarter.com", "energyglobal.com", "greenreview.com.au",
  "renewablesnow.com", "power-technology.com", "australianmining.com.au",
  "infrastructuremagazine.com.au", "energynewsbulletin.net", "ecogeneration.com.au",
  "utilitymagazine.com.au", "esdnews.com.au", "energymagazine.com.au", "carbonnews.co.nz",
  "energynews.co.nz", "seanz.org.nz", "cleanenergycouncil.org.au", "smartenergy.org.au",
]);

const SOURCE_NAMES: Record<string, string> = {
  "reneweconomy.com.au": "RenewEconomy",
  "pv-magazine-australia.com": "PV Magazine Australia",
  "pv-magazine.com": "PV Magazine Global",
  "pv-tech.org": "PV Tech",
  "energy-storage.news": "Energy-Storage.news",
  "solarquarter.com": "SolarQuarter",
  "energyglobal.com": "Energy Global",
  "greenreview.com.au": "Green Review",
  "renewablesnow.com": "Renewables Now",
  "power-technology.com": "Power Technology",
  "australianmining.com.au": "Australian Mining",
  "infrastructuremagazine.com.au": "Infrastructure Magazine",
  "energynewsbulletin.net": "Energy News Bulletin",
  "ecogeneration.com.au": "EcoGeneration",
  "utilitymagazine.com.au": "Utility Magazine",
  "esdnews.com.au": "ESD News",
  "energymagazine.com.au": "Energy Magazine",
  "carbonnews.co.nz": "Carbon News NZ",
  "energynews.co.nz": "Energy News NZ",
  "businessdesk.co.nz": "BusinessDesk NZ",
  "nzherald.co.nz": "NZ Herald",
  "linkedin.com": "LinkedIn",
};

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const relative = raw.match(/^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const d = new Date();
    if (unit === "minute") d.setMinutes(d.getMinutes() - amount);
    if (unit === "hour") d.setHours(d.getHours() - amount);
    if (unit === "day") d.setDate(d.getDate() - amount);
    if (unit === "week") d.setDate(d.getDate() - amount * 7);
    if (unit === "month") d.setMonth(d.getMonth() - amount);
    if (unit === "year") d.setFullYear(d.getFullYear() - amount);
    return d.toISOString().slice(0, 10);
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function effectiveWindow(startDate?: string, endDate?: string): { start: string; end: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (startDate || endDate) return { start: startDate ?? "2000-01-01", end: endDate ?? today };
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 30);
  return { start: d.toISOString().slice(0, 10), end: today };
}

function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return ""; }
}

function sourceName(url: string, supplied?: unknown): string {
  const host = hostOf(url);
  if (typeof supplied === "string" && supplied.trim() && supplied.trim().length < 80) return supplied.trim();
  return SOURCE_NAMES[host] ?? (host || "Web");
}

function classifyContentType(url: string, author: string | null, hint?: ContentType): ContentType {
  const host = hostOf(url);
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return "linkedin";
  if (GENERAL_MEDIA_HOSTS.has(host) && author) return "journalist";
  if (INDUSTRY_HOSTS.has(host) || host.endsWith(".gov.au") || host.endsWith(".govt.nz")) return "industry";
  return hint === "linkedin" ? "linkedin" : author ? "journalist" : "news";
}

function relevant(text: string): boolean {
  const lower = text.toLowerCase();
  const solar = /\bsolar\b|photovoltaic|\bpv\b/.test(lower);
  if (!solar) return false;
  const utility = /utility[ -]?scale|large[ -]?scale|solar farm|solar park|solar project|renewable energy|grid connection|transmission|capacity investment scheme|\bcis\b|developer|\bepc\b|construction|planning approval|resource consent|ppa|power purchase/.test(lower);
  const residential = /residential|household|home solar|rooftop solar/.test(lower);
  return utility && (!residential || /utility[ -]?scale|large[ -]?scale|solar farm|solar park/.test(lower));
}

function compactSummary(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/[#*_`<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > 420 ? text.slice(0, 417).trimEnd() + "..." : text;
}

function buildPlans(startDate?: string, endDate?: string): SearchPlan[] {
  const { start, end } = effectiveWindow(startDate, endDate);
  const dateTerms = `after:${start} before:${addDays(end, 1)}`;
  return [
    { country: "AU", query: `("utility scale solar" OR "large scale solar" OR "solar farm") Australia (market OR grid OR policy OR developer OR EPC OR construction) ${dateTerms}` },
    { country: "AU", query: `solar Australia (Capacity Investment Scheme OR transmission OR grid connection OR planning approval) ${dateTerms}` },
    { country: "AU", hint: "linkedin", query: `site:linkedin.com/posts ("utility scale solar" OR "large scale solar" OR "solar farm") Australia ${dateTerms}` },
    { country: "NZ", query: `("utility scale solar" OR "large scale solar" OR "solar farm") "New Zealand" (market OR grid OR policy OR developer OR EPC OR construction) ${dateTerms}` },
    { country: "NZ", query: `solar "New Zealand" (Transpower OR grid connection OR fast-track OR resource consent OR generation investment) ${dateTerms}` },
    { country: "NZ", hint: "linkedin", query: `site:linkedin.com/posts ("utility scale solar" OR "large scale solar" OR "solar farm") "New Zealand" ${dateTerms}` },
  ];
}

function readRows(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const root = body as Record<string, unknown>;
  const data = root.data;
  if (Array.isArray(data)) return data.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    const combined = ["news", "web"].flatMap((key) =>
      Array.isArray(record[key]) ? (record[key] as unknown[]) : []
    );
    return combined.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
  }
  return [];
}

function toCandidate(row: Record<string, unknown>, plan: SearchPlan, start: string, end: string): NewsCandidate | null {
  const urlRaw = [row.url, row.link, row.sourceURL].find((v) => typeof v === "string") as string | undefined;
  const url = urlRaw ? canonicalUrl(urlRaw) : null;
  const title = typeof row.title === "string" ? row.title.trim() : "";
  if (!url || !title) return null;

  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown> : {};
  const authorValue = [row.author, row.byline, metadata.author].find((v) => typeof v === "string" && v.trim());
  const author = typeof authorValue === "string" ? authorValue.trim().slice(0, 160) : null;
  const summary = compactSummary(row.description ?? row.snippet ?? row.markdown ?? metadata.description);
  const text = `${title} ${summary ?? ""}`;
  if (!relevant(text)) return null;

  const dateValue = [
    row.publishedDate, row.published_date, row.date, row.datePublished, row.publishedAt,
    metadata.publishedDate, metadata.publishedTime, metadata.date, metadata.datePublished,
  ].find((v) => typeof v === "string" && v.trim());
  const publishedDate = isoDate(dateValue);
  if (!publishedDate || publishedDate < start || publishedDate > end) return null;

  return {
    title: title.slice(0, 500),
    summary,
    sourceName: sourceName(url, row.sourceName ?? row.siteName),
    sourceUrl: url,
    author,
    country: plan.country,
    contentType: classifyContentType(url, author, plan.hint),
    publishedDate,
  };
}

async function firecrawlSearch(plans: SearchPlan[], start: string, end: string): Promise<NewsCandidate[]> {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) throw new Error("FIRECRAWL_API_KEY is not configured");

  const results: NewsCandidate[] = [];
  for (const plan of plans) {
    const response = await fetch(FIRECRAWL_SEARCH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: plan.query,
        limit: 10,
        sources: [{ type: "news" }, { type: "web" }],
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`Firecrawl search failed with HTTP ${response.status}`);
    const body = await response.json() as unknown;
    for (const row of readRows(body)) {
      const candidate = toCandidate(row, plan, start, end);
      if (candidate) results.push(candidate);
    }
  }
  return results;
}

interface ApifyOrganicResult {
  title?: string;
  url?: string;
  description?: string;
  date?: string;
  publishedDate?: string;
  source?: string;
}

async function apifySearch(plans: SearchPlan[], start: string, end: string): Promise<NewsCandidate[]> {
  const token = process.env.APIFY_API_TOKEN?.trim();
  if (!token) throw new Error("APIFY_API_TOKEN is not configured");
  const response = await fetch(`${APIFY_GOOGLE_SEARCH_URL}&token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      queries: plans.map((p) => p.query).join("\n"),
      resultsPerPage: 10,
      maxPagesPerQuery: 1,
      languageCode: "en",
      mobileResults: false,
    }),
    signal: AbortSignal.timeout(125_000),
  });
  if (!response.ok) throw new Error(`Apify Google search failed with HTTP ${response.status}`);
  const rows = await response.json() as Array<{ searchQuery?: { term?: string }; organicResults?: ApifyOrganicResult[] }>;
  const results: NewsCandidate[] = [];
  for (const [index, row] of rows.entries()) {
    const term = row.searchQuery?.term ?? "";
    const plan = plans.find((p) => p.query === term) ?? plans[Math.min(index, plans.length - 1)];
    if (!plan) continue;
    for (const item of row.organicResults ?? []) {
      const candidate = toCandidate({
        title: item.title,
        url: item.url,
        description: item.description,
        date: item.date ?? item.publishedDate,
        sourceName: item.source,
      }, plan, start, end);
      if (candidate) results.push(candidate);
    }
  }
  return results;
}

function dedupe(items: NewsCandidate[]): NewsCandidate[] {
  const byUrl = new Map<string, NewsCandidate>();
  for (const item of items) {
    const existing = byUrl.get(item.sourceUrl);
    if (!existing || (item.summary?.length ?? 0) > (existing.summary?.length ?? 0)) byUrl.set(item.sourceUrl, item);
  }
  return [...byUrl.values()].sort((a, b) =>
    b.publishedDate.localeCompare(a.publishedDate) || a.title.localeCompare(b.title)
  );
}

export async function scanIndustryNews(
  scanId: number,
  startDate?: string,
  endDate?: string,
): Promise<{ found: number; provider: "firecrawl" | "apify"; startDate: string; endDate: string }> {
  const { start, end } = effectiveWindow(startDate, endDate);
  const plans = buildPlans(startDate, endDate);
  let provider: "firecrawl" | "apify" = "firecrawl";
  let items: NewsCandidate[] = [];

  try {
    items = await firecrawlSearch(plans, start, end);
  } catch (error) {
    logger.warn({ err: error, scanId }, "Industry news Firecrawl search failed; trying Apify");
  }

  if (items.length === 0) {
    provider = "apify";
    items = await apifySearch(plans, start, end);
  }

  const unique = dedupe(items);
  await db.transaction(async (tx) => {
    await tx.delete(industryNewsTable).where(eq(industryNewsTable.scanId, scanId));
    if (unique.length) {
      await tx.insert(industryNewsTable).values(unique.map((item) => ({ scanId, ...item })));
    }
  });

  logger.info({ scanId, found: unique.length, provider, startDate: start, endDate: end }, "Industry news scan complete");
  return { found: unique.length, provider, startDate: start, endDate: end };
}
