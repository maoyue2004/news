import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from '../lib/feed-parse.mjs';

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example Blog</title>
    <item>
      <title>Reward hacking in RL</title>
      <link>https://example.com/p/reward-hacking</link>
      <pubDate>Sat, 26 Jul 2026 18:00:00 GMT</pubDate>
      <description>Short blurb</description>
      <content:encoded><![CDATA[<p>Full <b>body</b> text</p>]]></content:encoded>
    </item>
    <item>
      <title>Second post</title>
      <link>https://example.com/p/second</link>
      <pubDate>Fri, 25 Jul 2026 09:30:00 GMT</pubDate>
      <description>Only a description</description>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom</title>
  <entry>
    <title>Atom entry title</title>
    <link rel="alternate" type="text/html" href="https://example.com/atom-1"/>
    <link rel="edit" href="https://example.com/edit/atom-1"/>
    <published>2026-07-26T12:00:00Z</published>
    <content type="html">&lt;p&gt;Atom body&lt;/p&gt;</content>
  </entry>
</feed>`;

const YOUTUBE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Some video title</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
    <published>2026-07-27T04:00:00+00:00</published>
    <media:group>
      <media:description>Video description here</media:description>
    </media:group>
  </entry>
</feed>`;

test('解析 RSS 2.0：取 content:encoded 作为正文', () => {
  const { items } = parseFeed(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Reward hacking in RL');
  assert.equal(items[0].link, 'https://example.com/p/reward-hacking');
  assert.equal(items[0].publishedAt, '2026-07-26T18:00:00.000Z');
  assert.match(items[0].contentHtml, /Full <b>body<\/b> text/);
});

test('解析 RSS 2.0：没有 content:encoded 时回退到 description', () => {
  const { items } = parseFeed(RSS);
  assert.equal(items[1].contentHtml, 'Only a description');
});

test('解析 Atom：link 取 rel=alternate 那一个', () => {
  const { items } = parseFeed(ATOM);
  assert.equal(items.length, 1);
  assert.equal(items[0].link, 'https://example.com/atom-1');
  assert.equal(items[0].publishedAt, '2026-07-26T12:00:00.000Z');
  assert.match(items[0].contentHtml, /Atom body/);
});

test('解析 YouTube Atom：正文取 media:description', () => {
  const { items } = parseFeed(YOUTUBE);
  assert.equal(items[0].link, 'https://www.youtube.com/watch?v=abc123');
  assert.equal(items[0].contentHtml, 'Video description here');
});

test('日期无法解析时 publishedAt 为 null', () => {
  const xml = `<rss version="2.0"><channel><item>
    <title>T</title><link>https://e.com/x</link><pubDate>not a date</pubDate>
  </item></channel></rss>`;
  const { items } = parseFeed(xml);
  assert.equal(items[0].publishedAt, null);
});

test('无法识别的格式抛错', () => {
  assert.throws(() => parseFeed('<html><body>not a feed</body></html>'), /无法识别/);
});
