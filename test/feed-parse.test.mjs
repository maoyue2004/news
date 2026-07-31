import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from '../lib/feed-parse.mjs';
import { htmlToText } from '../lib/html-text.mjs';
import { itemId } from '../lib/fingerprint.mjs';

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

test('播客条目没有 link 时回退到 enclosure 音频地址', () => {
  const xml = `<?xml version="1.0"?><rss><channel><item>
    <title>Episode</title><guid isPermaLink="false">opaque-id</guid>
    <enclosure url="https://audio.example/episode.mp3?x=1&amp;y=2" type="audio/mpeg" />
  </item></channel></rss>`;
  assert.equal(parseFeed(xml).items[0].link, 'https://audio.example/episode.mp3?x=1&y=2');
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

test('【修复】真实 feed 中大量转义字符不触发实体展开上限报错', () => {
  // 真实正文里常见大量 HTML 转义字符（例如引用代码块里的 &lt;/&gt;），
  // fast-xml-parser 默认实体展开上限为 1000，超过就抛
  // "Entity expansion limit exceeded: N > 1000"。这里构造一个超过 1000 个
  // &lt; 的 description（&amp; 本身不计入展开计数，故用 &lt; 复现），
  // 验证 parseFeed 不再因此抛错。
  const manyEntities = '&lt;'.repeat(1100);
  const xml = `<rss version="2.0"><channel><item>
    <title>Entity heavy post</title>
    <link>https://example.com/entity-heavy</link>
    <pubDate>Sat, 26 Jul 2026 18:00:00 GMT</pubDate>
    <description>${manyEntities}</description>
  </item></channel></rss>`;
  const { items } = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Entity heavy post');
});

test('【修复】title 中的实体被解码', () => {
  const xml = `<rss version="2.0"><channel><item>
    <title>A &amp; B &lt;C&gt;</title>
    <link>https://example.com/title-entities</link>
    <pubDate>Sat, 26 Jul 2026 18:00:00 GMT</pubDate>
    <description>desc</description>
  </item></channel></rss>`;
  const { items } = parseFeed(xml);
  assert.equal(items[0].title, 'A & B <C>');
});

test('【修复】Atom title 中的实体也被解码', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>A &amp; B &lt;C&gt;</title>
    <link rel="alternate" href="https://example.com/atom-title-entities"/>
    <published>2026-07-26T12:00:00Z</published>
    <content type="html">body</content>
  </entry>
</feed>`;
  const { items } = parseFeed(xml);
  assert.equal(items[0].title, 'A & B <C>');
});

test('【修复】contentHtml 不被二次解码：&amp;lt; 经 htmlToText 后应为 &lt; 而非 <', () => {
  const xml = `<rss version="2.0"><channel><item>
    <title>Double decode guard</title>
    <link>https://example.com/double-decode</link>
    <pubDate>Sat, 26 Jul 2026 18:00:00 GMT</pubDate>
    <description>&amp;lt;</description>
  </item></channel></rss>`;
  const { items } = parseFeed(xml);
  // parseFeed 本身不应把 contentHtml 里的实体解成 "<"（那是两次解码的结果）；
  // 正确的一次解码结果应仍是 "&lt;" 这个字面串，留给 htmlToText 去解码一次。
  assert.equal(htmlToText(items[0].contentHtml), '&lt;');
});

test('【修复】RSS <link> 文本里的实体被解码', () => {
  // Substack/WordPress 等站点的 link 常带 ?utm_source=...&utm_medium=... 这种
  // 多参数查询串，在 XML 里必须转义成 &amp;。processEntities:false 关闭后
  // 这类 link 若不单独解码，会把坏掉的 "&amp;" 字面量当成链接渲染给用户，
  // 也会污染 itemId() 的稳定 id 计算。
  const xml = `<rss version="2.0"><channel><item>
    <title>T</title>
    <link>https://e.com/a?x=1&amp;y=2</link>
    <pubDate>Sat, 26 Jul 2026 18:00:00 GMT</pubDate>
    <description>desc</description>
  </item></channel></rss>`;
  const { items } = parseFeed(xml);
  assert.equal(items[0].link, 'https://e.com/a?x=1&y=2');
});

test('【修复】Atom link[href] 属性里的实体被解码', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>T</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc&amp;feature=share"/>
    <published>2026-07-26T12:00:00Z</published>
    <content type="html">body</content>
  </entry>
</feed>`;
  const { items } = parseFeed(xml);
  assert.equal(items[0].link, 'https://www.youtube.com/watch?v=abc&feature=share');
});

test('【修复】link 解码后算出的 itemId 与正确 URL 的 itemId 一致（id 地基不能被 &amp; 污染）', () => {
  const xml = `<rss version="2.0"><channel><item>
    <title>T</title>
    <link>https://e.com/a?x=1&amp;y=2</link>
    <pubDate>Sat, 26 Jul 2026 18:00:00 GMT</pubDate>
    <description>desc</description>
  </item></channel></rss>`;
  const { items } = parseFeed(xml);
  assert.equal(itemId(items[0].link), itemId('https://e.com/a?x=1&y=2'));
});
