import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAlignmentDate,
  parseAlignmentIndex,
  parseArticleMeta,
  parseEpoch,
  parseGwernNewsletter,
  parseRundown,
  parseSinaMedia,
  parseSitemap,
  parseTheBatch,
  parseWaytoagi,
} from '../lib/source-adapters.mjs';

test('The Batch archive cards become feed-shaped items', () => {
  const html = `<article><a href="/the-batch/tag/jul-31-2026">Jul 31, 2026</a>
    <h3>Issue title</h3><p>Issue summary</p>
    <a aria-label="Issue title" href="/the-batch/issue-364"></a></article>`;
  assert.deepEqual(parseTheBatch(html)[0], {
    title: 'Issue title',
    link: 'https://www.deeplearning.ai/the-batch/issue-364',
    publishedAt: '2026-07-31T00:00:00.000Z',
    contentHtml: 'Issue summary',
  });
});

test('Epoch cards use the date badge and canonical card link', () => {
  const html = `<div class="card cover-link-parent card-article-listing card-layout-image-right">
    <span class="badge-text">Research</span><span class="badge-text">Jul. 29, 2026</span>
    <a href="/publications/example" class="cover-link"></a><span class="trim">Example result</span>
    <p class="body-3 trim">What the result means</p></div>`;
  assert.equal(parseEpoch(html)[0].link, 'https://epoch.ai/publications/example');
  assert.equal(parseEpoch(html)[0].publishedAt, '2026-07-29T00:00:00.000Z');
});

test('Rundown embedded Beehiiv JSON is decoded', () => {
  const html = '{"web_title":"A \\"quoted\\" title","web_subtitle":"Daily summary","featured":false,"slug":"daily-news","scheduled_at":"2026-07-31T09:00:00Z"}';
  const parsed = parseRundown(html)[0];
  assert.equal(parsed.title, 'A "quoted" title');
  assert.equal(parsed.link, 'https://www.therundown.ai/p/daily-news');
});

test('Alignment index entries inherit their month and exact BibTeX date', () => {
  const index = `<div class="date">July 2026</div><a href="2026/example/" class="note">
    <h3>Alignment result</h3><div class="description">Details</div></a>`;
  assert.equal(parseAlignmentIndex(index)[0].month, 'July 2026');
  assert.equal(
    parseAlignmentDate('year = {2026}, month = {July}, day = {13}'),
    '2026-07-13T00:00:00.000Z',
  );
});

test('sitemap and article metadata preserve publication time', () => {
  const xml = `<urlset><url><loc>https://cohere.com/blog/new</loc><lastmod>2026-07-30</lastmod></url>
    <url><loc>https://example.com/no</loc><lastmod>2026-07-31</lastmod></url></urlset>`;
  const rows = parseSitemap(xml, '^https://cohere\\.com/blog/');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lastmod, '2026-07-30T00:00:00.000Z');
  const article = parseArticleMeta(
    '<meta property="og:title" content="New post"><meta property="og:description" content="Summary"><script>{"datePublished":"2026-07-29T12:00:00Z"}</script>',
    rows[0].link,
    rows[0].lastmod,
  );
  assert.equal(article.publishedAt, '2026-07-29T12:00:00.000Z');
});

test('Sina media cards become stable article entries', () => {
  const html = `<a class="post-link" href="/news/detail/123.html"><article class="post">
    <div class="time">2026-07-24 05:07<span>来自网页</span></div>
    <div class="post-text">一条模型测评内容</div></article></a>`;
  const parsed = parseSinaMedia(html)[0];
  assert.equal(parsed.link, 'https://www.sina.cn/news/detail/123.html');
  assert.equal(parsed.title, '一条模型测评内容');
});

test('WaytoAGI homepage cards derive their date from the canonical slug', () => {
  const html = `<a href="https://blog.waytoagi.com/article/news-20250321">
    <div class="text-sm font-bold">Knowledge Base Picks</div>
    <div class="text-gray-500 h-10">Six useful links</div></a>`;
  assert.equal(parseWaytoagi(html)[0].publishedAt, '2025-03-20T16:00:00.000Z');
});

test('Gwern newsletter month URL supplies a deterministic date', () => {
  const link = 'https://gwern.net/newsletter/2026/07';
  const html = '<article><h1>July 2026 News</h1><div class="page-description"><p>Monthly links</p></div></article>';
  assert.equal(parseGwernNewsletter(html, link).publishedAt, '2026-07-01T00:00:00.000Z');
});
