/**
 * RSS 2.0 / Atom feed parsing for the approved news sources.
 *
 * The previous parser only read `<description>` (a ~50 word excerpt), only
 * understood `<item>`, ignored `content:encoded` (the full article on every
 * WordPress feed) and fell back to the scan day when an item had no date.
 * Excerpts rarely contain the MW figure, so most solar articles were dropped
 * later for "missing-capacity". This parser returns the full text when the
 * feed supplies it and never invents a publication date.
 */

import { fragmentToText } from "./source-text.ts";

export interface FeedItem {
  title: string;
  link: string;
  /** Plain-text excerpt (`<description>` / `<summary>`). */
  summary: string;
  /** Plain-text full article when the feed carries it (`content:encoded` / `<content>`), else "". */
  content: string;
  /** ISO date (YYYY-MM-DD) or null when the feed gave no parseable date. */
  date: string | null;
}

function unwrapCdata(value: string): string {
  return value.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
}

function firstTag(block: string, names: readonly string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(":", "\\:");
    const re = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)</${escaped}>`, "i");
    const match = block.match(re);
    if (match) return unwrapCdata(match[1]);
  }
  return null;
}

function atomLink(block: string): string | null {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)];
  for (const link of links) {
    const attrs = link[1];
    const rel = attrs.match(/\brel=["']([^"']+)["']/i)?.[1];
    const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (href && (!rel || rel === "alternate")) return href;
  }
  return null;
}

/** Parse a feed date (RFC 822 or ISO 8601) to YYYY-MM-DD, or null. */
export function parseFeedDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  const iso = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) {
    const parsed = new Date(`${iso[1]}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso[1]) return iso[1];
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/** True when the document looks like RSS or Atom (used for validity checks). */
export function looksLikeFeed(xml: string): boolean {
  return /<(?:rss|feed|rdf:RDF)\b/i.test(xml.slice(0, 4000)) || /<(?:item|entry)\b/i.test(xml);
}

export function parseFeedItems(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = [
    ...[...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => ({ body: match[1], atom: false })),
    ...[...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((match) => ({ body: match[1], atom: true })),
  ];

  for (const { body, atom } of blocks) {
    const title = fragmentToText(firstTag(body, ["title"]) ?? "");
    let link = atom
      ? atomLink(body) ?? ""
      : fragmentToText(firstTag(body, ["link"]) ?? "") || (body.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] ?? "");
    if (!link) link = fragmentToText(firstTag(body, ["guid", "id"]) ?? "");
    if (!/^https?:\/\//i.test(link)) link = "";
    if (!title || !link) continue;

    const summary = fragmentToText(firstTag(body, ["description", "summary"]) ?? "");
    const content = fragmentToText(firstTag(body, ["content:encoded", "content"]) ?? "");
    const date = parseFeedDate(firstTag(body, ["pubDate", "dc:date", "published", "updated"]));
    items.push({ title, link, summary, content, date });
  }
  return items;
}

/**
 * URL for page `page` of a WordPress-style feed (`/feed/?paged=2`). Returns
 * null for page 1 (use the configured URL unchanged).
 */
export function feedPageUrl(feedUrl: string, page: number): string | null {
  if (page <= 1) return null;
  try {
    const url = new URL(feedUrl);
    url.searchParams.set("paged", String(page));
    return url.href;
  } catch {
    return null;
  }
}
