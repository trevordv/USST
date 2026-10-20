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
  if (GENERAL_MEDIA_HOSTS.has(ost) && author) return "journalist";
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
    .replace(/[#*`<]/g, " ")
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
    author,BÛÝ[N[ÛÝ[KÛÛ[\NÛ\ÜÚYPÛÛ[\J\]]Ü[[
KX\ÚY]KNÂB\Þ[È[Ý[Û\XÜ]ÛÙX\Ú
[ÎÙX\Ú[×KÝ\Ý[Ë[Ý[ÊNÛZ\ÙO]ÜÐØ[Y]V×OÂÛÛÝÙ^HHØÙ\ÜË[TPÔUÓÐTWÒÑVOË[J
NÂY
ZÙ^JHÝÈ]È\ÜTPÔUÓÐTWÒÑVH\ÈÝÛÛYÝ\YNÂÛÛÝ\Ý[Î]ÜÐØ[Y]V×HH×NÂÜ
ÛÛÝ[Ù[ÊHÂÛÛÝ\ÜÛÙHH]ØZ]]Ú
TPÔUÓÔÑPTÒÕTÂY]ÙÔÕXY\ÎÈ]]Ü^][ÛX\\	ÚÙ^_XÛÛ[U\H\XØ][ÛÚÛÛKÙNÓÓÝ[ÚYJÂ]Y\N[]Y\K[Z]LÛÝ\Ù\ÎÞÈ\N]ÜÈKÈ\NÙXWKØÜ\SÜ[ÛÎÈÜX]ÎÈX\ÙÝÛKÛSXZ[ÛÛ[YHKJKÚYÛ[XÜÚYÛ[[Y[Ý]
WÌ
KJNÂY
\\ÜÛÙKÚÊHÝÈ]È\Ü\XÜ]ÛÙX\ÚZ[YÚ]	Ü\ÜÛÙKÝ]\ßX
NÂÛÛÝÙHH]ØZ]\ÜÛÙKÛÛ
H\È[ÛÝÛÂÜ
ÛÛÝÝÈÙXYÝÜÊÙJJHÂÛÛÝØ[Y]HHÐØ[Y]JÝË[Ý\[
NÂY
Ø[Y]JH\Ý[Ë\Ú
Ø[Y]JNÂBB]\\Ý[ÎÂB[\XÙH\YSÜØ[XÔ\Ý[Â]OÎÝ[ÎÂ\ÎÝ[ÎÂ\ØÜ\[ÛÎÝ[ÎÂ]OÎÝ[ÎÂX\ÚY]OÎÝ[ÎÂÛÝ\ÙOÎÝ[ÎÂB\Þ[È[Ý[Û\YTÙX\Ú
[ÎÙX\Ú[×KÝ\Ý[Ë[Ý[ÊNÛZ\ÙO]ÜÐØ[Y]V×OÂÛÛÝÚÙ[HØÙ\ÜË[TQWÐTWÕÒÑSË[J
NÂY
]ÚÙ[HÝÈ]È\ÜTQWÐTWÕÒÑS\ÈÝÛÛYÝ\YNÂÛÛÝ\ÜÛÙHH]ØZ]]Ú
	ÐTQWÑÓÓÑÓWÔÑPTÒÕTIÚÙ[IÙ[ÛÙUTPÛÛ\Û[
ÚÙ[_XÂY]ÙÔÕXY\ÎÈÛÛ[U\H\XØ][ÛÚÛÛKÙNÓÓÝ[ÚYJÂ]Y\Y\Î[ËX\


HO]Y\JKÚ[K\Ý[Ô\YÙNLX^YÙ\Ô\]Y\NK[ÝXYÙPÛÙN[[Ø[T\Ý[Î[ÙKJKÚYÛ[XÜÚYÛ[[Y[Ý]
LWÌ
KJNÂY
\\ÜÛÙKÚÊHÝÈ]È\Ü	Ð\YHÛÛÙÛHÙX\ÚZ[YÚ]	Ü\ÜÛÙKÝ]\ßX
NÂÛÛÝÝÜÈH]ØZ]\ÜÛÙKÛÛ
H\È\^OÈÙX\Ú]Y\OÎÈ\OÎÝ[ÈNÈÜØ[XÔ\Ý[ÏÎ\YSÜØ[XÔ\Ý[×HOÂÛÛÝ\Ý[Î]ÜÐØ[Y]V×HH×NÂÜ
ÛÛÝÚ[^Ý×HÙÝÜË[Y\Ê
JHÂÛÛÝ\HHÝËÙX\Ú]Y\OË\HÏÈÂÛÛÝ[H[Ë[


HO]Y\HOOH\JHÏÈ[ÖÓX]Z[[^[Ë[ÝHJWNÂY
\[HÛÛ[YNÂÜ
ÛÛÝ][HÙÝËÜØ[XÔ\Ý[ÈÏÈ×JHÂÛÛÝØ[Y]HHÐØ[Y]JÂ]N][K]K\][K\\ØÜ\[Û][K\ØÜ\[Û]N][K]HÏÈ][KX\ÚY]KÛÝ\ÙS[YN][KÛÝ\ÙKK[Ý\[
NÂY
Ø[Y]JH\Ý[Ë\Ú
Ø[Y]JNÂBB]\\Ý[ÎÂB[Ý[ÛY\J][\Î]ÜÐØ[Y]V×JN]ÜÐØ[Y]V×HÂÛÛÝU\H]ÈX\Ý[Ë]ÜÐØ[Y]O
NÂÜ
ÛÛÝ][HÙ][\ÊHÂÛÛÝ^\Ý[ÈHU\Ù]
][KÛÝ\ÙU\
NÂY
Y^\Ý[È
][KÝ[[X\OË[ÝÏÈ
H
^\Ý[ËÝ[[X\OË[ÝÏÈ
JHU\Ù]
][KÛÝ\ÙU\][JNÂB]\ËU\[Y\Ê
WKÛÜ

KHOX\ÚY]KØØ[PÛÛ\\JKX\ÚY]JHK]KØØ[PÛÛ\\J]JB
NÂB^Ü\Þ[È[Ý[ÛØØ[[\ÝS]ÜÊØØ[Y[X\Ý\]OÎÝ[Ë[]OÎÝ[ËNÛZ\ÙOÈÝ[[X\ÈÝY\\XÜ]Û\YHÈÝ\]NÝ[ÎÈ[]NÝ[ÈOÂÛÛÝÈÝ\[HHYXÝ]UÚ[ÝÊÝ\]K[]JNÂÛÛÝ[ÈHZ[[ÊÝ\]K[]JNÂ]ÝY\\XÜ]Û\YHH\XÜ]ÛÂ]][\Î]ÜÐØ[Y]V×HH×NÂHÂ][\ÈH]ØZ]\XÜ]ÛÙX\Ú
[ËÝ\[
NÂHØ]Ú
\ÜHÂÙÙÙ\Ø\È\\ÜØØ[YK[\ÝH]ÜÈ\XÜ]ÛÙX\ÚZ[YÈZ[È\YHNÂBY
][\Ë[ÝOOH
HÂÝY\H\YHÂ][\ÈH]ØZ]\YTÙX\Ú
[ËÝ\[
NÂBÛÛÝ[\]YHHY\J][\ÊNÂ]ØZ][ØXÝ[Û\Þ[È

HOÂ]ØZ][]J[\ÝS]ÜÕXJKÚ\J\J[\ÝS]ÜÕXKØØ[YØØ[Y
JNÂY
[\]YK[Ý
HÂ]ØZ][Ù\
[\ÝS]ÜÕXJK[Y\Ê[\]YKX\

][JHO
ÈØØ[Y][HJJJNÂBJNÂÙÙÙ\[ÊÈØØ[YÝ[[\]YK[ÝÝY\Ý\]NÝ\[]N[K[\ÝH]ÜÈØØ[ÛÛ\]HNÂ]\ÈÝ[[\]YK[ÝÝY\Ý\]NÝ\[]N[NÂB