import assert from "node:assert/strict";
import test from "node:test";
import { feedPageUrl, looksLikeFeed, parseFeedDate, parseFeedItems } from "./feed-items.ts";

const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
<item><title><![CDATA[Neoen&#8217;s 400 MW Culcairn Solar Farm approved]]></title><link>https://example.com/a</link>
<pubDate>Fri, 12 Jun 2026 03:00:00 +0000</pubDate>
<description><![CDATA[<p>Short excerpt…</p>]]></description>
<content:encoded><![CDATA[<p>Full text mentions <strong>400 MW</strong> of solar.</p>]]></content:encoded></item>
<item><title>No date item</title><link>https://example.com/b</link><description>x</description></item>
<item><title>No link</title></item>
</channel></rss>`;

test("RSS: reads content:encoded, decodes entities and keeps null dates null", () => {
  const items = parseFeedItems(rss);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Neoen’s 400 MW Culcairn Solar Farm approved");
  assert.equal(items[0].date, "2026-06-12");
  assert.match(items[0].content, /Full text mentions 400 MW of solar/);
  assert.equal(items[1].date, null);
});

test("Atom entries are supported", () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Alpha Solar Farm</title><link rel="alternate" href="https://example.com/alpha"/><updated>2026-07-01T10:00:00Z</updated><summary>200 MW</summary></entry></feed>`;
  const items = parseFeedItems(atom);
  assert.deepEqual(items.map((item) => [item.title, item.link, item.date]), [["Alpha Solar Farm", "https://example.com/alpha", "2026-07-01"]]);
  assert.ok(looksLikeFeed(atom));
});

test("date parsing", () => {
  assert.equal(parseFeedDate("2026-07-01T10:00:00Z"), "2026-07-01");
  assert.equal(parseFeedDate("Fri, 12 Jun 2026 03:00:00 +0000"), "2026-06-12");
  assert.equal(parseFeedDate(""), null);
  assert.equal(parseFeedDate("garbage"), null);
});

test("feed paging uses the WordPress paged parameter", () => {
  assert.equal(feedPageUrl("https://example.com/feed/", 1), null);
  assert.equal(feedPageUrl("https://example.com/feed/", 3), "https://example.com/feed/?paged=3");
  assert.equal(feedPageUrl("https://example.com/feed/?x=1", 2), "https://example.com/feed/?x=1&paged=2");
});
