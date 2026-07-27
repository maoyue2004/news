import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectFromFeed } from '../lib/collect.mjs';

const blogSource = {
  name: 'Example Blog', url: 'https://example.com/', feed: 'https://example.com/feed',
  type: 'blog', lang: 'en', enabled: true, desc: 'x',
};

const podcastSource = { ...blogSource, name: 'Example Pod', type: 'podcast' };

function rss(items) {
  return `<rss version="2.0"><channel>${items}</channel></rss>`;
}

const ITEM_FRESH = `<item>
  <title>Fresh post</title><link>https://example.com/p/fresh</link>
  <pubDate>Mon, 27 Jul 2026 06:00:00 GMT</pubDate>
  <description><![CDATA[<p>Body of the fresh post</p>]]></description>
</item>`;

const ITEM_OLD = `<item>
  <title>Ancient post</title><link>https://example.com/p/ancient</link>
  <pubDate>Mon, 01 Jan 2024 06:00:00 GMT</pubDate>
  <description>old</description>
</item>`;

const TODAY = '2026-07-27';
const NOW = '2026-07-27T08:00:00.000Z';

test('抓出未见过的新条目', () => {
  const { items } = collectFromFeed({ source: blogSource, xml: rss(ITEM_FRESH), seen: {}, today: TODAY, now: NOW });
  assert.equal(items.length, 1);
  assert.equal(items[0].titleOriginal, 'Fresh post');
  assert.equal(items[0].source, 'Example Blog');
  assert.equal(items[0].type, 'blog');
  assert.equal(items[0].lang, 'en');
  assert.equal(items[0].excerpt, 'Body of the fresh post');
  assert.equal(items[0].brief, false);
  assert.match(items[0].id, /^[0-9a-f]{16}$/);
});

test('已在 seen 里的条目被跳过', () => {
  const first = collectFromFeed({ source: blogSource, xml: rss(ITEM_FRESH), seen: {}, today: TODAY, now: NOW });
  const seen = { [first.items[0].id]: '2026-07-26' };
  const second = collectFromFeed({ source: blogSource, xml: rss(ITEM_FRESH), seen, today: TODAY, now: NOW });
  assert.equal(second.items.length, 0);
});

test('超过 14 天的老条目被跳过，避免首次运行灌进几百条历史', () => {
  const { items } = collectFromFeed({ source: blogSource, xml: rss(ITEM_OLD), seen: {}, today: TODAY, now: NOW });
  assert.equal(items.length, 0);
});

test('播客与视频条目标记 brief', () => {
  const { items } = collectFromFeed({ source: podcastSource, xml: rss(ITEM_FRESH), seen: {}, today: TODAY, now: NOW });
  assert.equal(items[0].brief, true);
});

test('没有发布时间的条目按当前时间收下', () => {
  const noDate = `<item><title>No date</title><link>https://example.com/p/nd</link><description>d</description></item>`;
  const { items } = collectFromFeed({ source: blogSource, xml: rss(noDate), seen: {}, today: TODAY, now: NOW });
  assert.equal(items.length, 1);
  assert.equal(items[0].publishedAt, NOW);
});

test('没有链接的条目被丢弃', () => {
  const noLink = `<item><title>No link</title><pubDate>Mon, 27 Jul 2026 06:00:00 GMT</pubDate></item>`;
  const { items } = collectFromFeed({ source: blogSource, xml: rss(noLink), seen: {}, today: TODAY, now: NOW });
  assert.equal(items.length, 0);
});

test('同一次抓取里重复的链接只保留一条', () => {
  const { items } = collectFromFeed({ source: blogSource, xml: rss(ITEM_FRESH + ITEM_FRESH), seen: {}, today: TODAY, now: NOW });
  assert.equal(items.length, 1);
});

test('excerpt 截断在 2000 字以内', () => {
  const long = `<item><title>L</title><link>https://example.com/p/l</link>
    <pubDate>Mon, 27 Jul 2026 06:00:00 GMT</pubDate>
    <description>${'x'.repeat(5000)}</description></item>`;
  const { items } = collectFromFeed({ source: blogSource, xml: rss(long), seen: {}, today: TODAY, now: NOW });
  assert.equal(items[0].excerpt.length, 2000);
});
