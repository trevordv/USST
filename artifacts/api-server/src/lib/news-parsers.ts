/**
 * Pure parsers for approved news feeds and listing pages.
 *
 * Kept free of I/O, logging and database imports so the behaviour is covered by
 * fixture tests (news-parsers.test.mjs). scraper.ts owns fetching, paging and
 * the shared eligibility/date gates.
 */

import { parseFeedItems } from "./feed-items.ts";
import {
  EXCLUDE_KEYWORDS,
  determineStatus,
  extractCapacity,
  extractDeveloper,
  extractLocation,
  isEarlyStage,
} from "./source-heuristics.ts";
import {
  deriveProjectName,
  extractElementBlocks,
  fragmentToText,
  normalizeProjectName,
  parseTextDate,
  projectSlug,
  resolveHttpUrl,
} from "./source-text.ts";

export interface NewsSource {
  name: string;
  country: "AU" | "NZ";
  searchUrl: string;
}

export interface NewsProject {
  name: string;
  description: string;
  capacityMw: number | null;
  developer: string | null;
  location: string | null;
  country: "AU" | "NZ";
  status: "announced" | "under_development";
  sourceUrl: string;
  sourceName: string;
  announcedDate: string | null;
  announcedDateEvidence: "source_reported" | "unknown";
  /** Capacity unknown after the excerpt: read the same-site article page. */
  needsArticleEnrichment: boolean;
  contactName: null;
  contactEmail: null;
  contactPhone: null;
}

export interface FeedPageResult {
  projects: NewsProject[];
  itemCount: number;
  oldestDate: string | null;
  firstLink: string | null;
}

/**
 * Parse one page of an approved news feed into project candidates.
 *
 * Reads the full article text when the feed carries it (`content:encoded`),
 * so the MW figure is found even when it is not in the excerpt. Items whose
 * capacity is still unknown are flagged for a bounded same-site article fetch
 * (see enrichProjectsFromArticles) instead of being silently dropped later.
 */
export function parseRssFeedPage(xml: string, source: NewsSource, startDate?: string, endDate?: string): FeedPageResult {
  const items = parseFeedItems(xml);
  const projects: NewsProject[] = [];
  let oldestDate: string | null = null;

  for (const item of items) {
    if (item.date && (!oldestDate || item.date < oldestDate)) oldestDate = item.date;

    const body = (item.content || item.summary).slice(0, 12_000);
    const fullText = `${item.title} ${item.summary} ${body}`;
    if (!/\b(?:solar|photovoltaic|pv)\b/i.test(fullText)) continue;

    // Exclude clearly operational articles (commissioned, now generating, etc.).
    // Only the headline, excerpt and opening paragraph are checked: a passing
    // mention of another farm being commissioned deep in the article must not
    // discard a genuine project announcement. Positive early-stage keywords are
    // not required for articles from trusted solar publications.
    const gate = `${item.title} ${item.summary} ${item.content.slice(0, 600)}`.toLowerCase();
    if (EXCLUDE_KEYWORDS.some((kw) => gate.includes(kw))) continue;

    // An undated item is unknown, never "today" (docs/Scan-Date-Window-Policy.md).
    if ((startDate || endDate) && !item.date) continue;
    if (startDate && item.date && item.date < startDate) continue;
    if (endDate && item.date && item.date > endDate) continue;

    const derivedName = deriveProjectName(item.title);
    const name = derivedName ?? item.title;
    const excerpt = (item.summary || body).slice(0, 700);
    const description = derivedName && derivedName !== item.title
      ? `${item.title}. ${excerpt}`.slice(0, 800)
      : excerpt;
    const capacityMw = extractCapacity(fullText);

    projects.push({
      name,
      description,
      capacityMw,
      developer: extractDeveloper(`${item.title}. ${item.summary}`),
      location: extractLocation(fullText, source.country),
      country: source.country,
      status: determineStatus(fullText),
      sourceUrl: item.link,
      sourceName: source.name,
      announcedDate: item.date,
      announcedDateEvidence: item.date ? "source_reported" : "unknown",
      needsArticleEnrichment: capacityMw == null && item.content.length < 1_500,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
    });
  }

  return { projects, itemCount: items.length, oldestDate, firstLink: items[0]?.link ?? null };
}

export function parseRssFeed(xml: string, source: NewsSource, startDate?: string, endDate?: string): NewsProject[] {
  return parseRssFeedPage(xml, source, startDate, endDate).projects;
}

const HTML_CARD_OPEN_RE =
  /^<(?:article\b|(?:div|li|section)\b[^>]*\bclass=["'][^"']*\b(?:post|article|entry|item|result|card|teaser|story|listing|news|views-row)[^"']*["'])/i;

/**
 * Extract project cards from a listing page.
 *
 * Cards are found with a balanced-tag walk. The previous non-greedy
 * `<div class="post">…</div>` regex ended at the first nested `</div>`, so the
 * title, link or date frequently fell outside the captured snippet and the card
 * was skipped or mis-titled. Wrapper elements that contain several headings are
 * skipped (their child cards are visited individually), relative links are
 * resolved against the page, and an undated card stays undated instead of being
 * stamped with today's date.
 */
export function parseHtmlPage(
  html: string,
  source: NewsSource,
  startDate?: string,
  endDate?: string,
  pageUrl: string = source.searchUrl,
): NewsProject[] {
  const projects: NewsProject[] = [];
  const seen = new Set<string>();
  const blocks = extractElementBlocks(html, ["article", "div", "li", "section"], HTML_CARD_OPEN_RE);

  for (const block of blocks) {
    const snippet = block.inner;
    if ((snippet.match(/<h[1-6]\b/gi)?.length ?? 0) > 1) continue;
    const text = fragmentToText(snippet.replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/gi, " "));
    if (!/\b(?:solar|photovoltaic|pv)\b/i.test(text)) continue;
    if (!isEarlyStage(text)) continue;

    const headingHtml = snippet.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] ?? "";
    const headingAnchor = headingHtml.match(/<a\b[^>]*\bhref=["']([^"']+)["']/i)?.[1];
    const firstAnchor = snippet.match(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const rawTitle = fragmentToText(headingHtml) || fragmentToText(firstAnchor?.[2] ?? "");
    if (!rawTitle || rawTitle.length < 10) continue;

    const link = resolveHttpUrl(headingAnchor ?? firstAnchor?.[1] ?? "", pageUrl);
    const dateAttr = snippet.match(/<time\b[^>]*\bdatetime=["']([^"']+)["']/i)?.[1];
    const announcedDate = (dateAttr ? parseTextDate(dateAttr) : null) ?? parseTextDate(text);

    if ((startDate || endDate) && !announcedDate) continue;
    if (startDate && announcedDate && announcedDate < startDate) continue;
    if (endDate && announcedDate && announcedDate > endDate) continue;

    const derivedName = deriveProjectName(rawTitle);
    const name = derivedName ?? rawTitle;
    const key = `${link ?? pageUrl}|${normalizeProjectName(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const capacityMw = extractCapacity(`${rawTitle} ${text}`);
    const sourceUrl = link ?? `${pageUrl.split("#")[0]}#${projectSlug(name)}`;
    const listingPage = link != null && link.split("#")[0].replace(/\/$/, "") === pageUrl.split("#")[0].replace(/\/$/, "");
    projects.push({
      name,
      description: (derivedName && derivedName !== rawTitle ? `${rawTitle}. ${text}` : text).slice(0, 600),
      capacityMw,
      developer: extractDeveloper(text),
      location: extractLocation(text, source.country),
      country: source.country,
      status: determineStatus(text),
      sourceUrl,
      sourceName: source.name,
      announcedDate,
      announcedDateEvidence: announcedDate ? "source_reported" : "unknown",
      needsArticleEnrichment: capacityMw == null && link != null && !listingPage,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
    });
  }

  return projects;
}
