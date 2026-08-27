import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpml, parseMarkdown, parseSiteList, looksLikeAudio, PODCAST_HOST } from '../scripts/tinker-harvest.mjs';

test('parseOpml 取 xmlUrl，忽略没有 feed 的分组节点', () => {
  const opml = `<opml><body>
    <outline text="分组" title="分组">
      <outline text="某博客" htmlUrl="https://a.com" xmlUrl="https://a.com/feed.xml"/>
    </outline>
  </body></opml>`;
  const rows = parseOpml(opml);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].feed, 'https://a.com/feed.xml');
  assert.equal(rows[0].url, 'https://a.com');
});

test('parseMarkdown 只挑形似 feed 的地址，跳过 GitHub 自身链接', () => {
  const md = `
  - [某博客](https://a.com) RSS: https://a.com/atom.xml
  - 仓库 https://github.com/x/y
  - https://b.com/feed/
  - https://c.com/about
  `;
  const feeds = parseMarkdown(md).map((r) => r.feed);
  assert.ok(feeds.includes('https://a.com/atom.xml'));
  assert.ok(feeds.includes('https://b.com/feed/'));
  assert.ok(!feeds.some((f) => f.includes('github.com')));
  assert.ok(!feeds.includes('https://c.com/about'));
});

test('parseSiteList 收只列主页的索引：按域名去重，退回站点根，feed 留空等下游探', () => {
  const md = `
  ### 某人
  - https://a.com/
  - https://a.com/posts/2026/hello
  ### 另一个人
  - https://b.com
  RSS 订阅：
  - https://b.com/atom.xml
  ### 不是博客
  - https://github.com/x/y
  - https://www.zhihu.com/people/z
  `;
  const rows = parseSiteList(md);
  assert.equal(rows.length, 2);
  const a = rows.find((r) => r.url === 'https://a.com');
  // 同一个域名出现两次（主页 + 深链）只留一条，且退回站点根。
  assert.equal(a.feed, null);
  const b = rows.find((r) => r.url === 'https://b.com');
  // 显式写出来的 RSS 地址优先，哪怕它排在主页后面。
  assert.equal(b.feed, 'https://b.com/atom.xml');
  assert.ok(!rows.some((r) => /github|zhihu/.test(r.url)));
});

test('同一份站点列表，旧的 feed 形态解析器几乎什么都抽不到', () => {
  // 这是 2026-08-28 接 qianguyihao 时的原始症状：那份索引列的是站点不是 feed，
  // parseMarkdown 读它等于把整份索引丢掉，而症状和「这个索引没增量」一模一样。
  const md = ['https://a.com/', 'https://b.com/', 'https://c.com/', 'https://d.com/feed'].join('\n');
  assert.equal(parseMarkdown(md).length, 1);
  assert.equal(parseSiteList(md).length, 4);
});

test('播客源被挡在门外：靠 URL 认托管商，靠 enclosure 认自建', () => {
  // 两条都需要——ximalaya 的专辑 URL 看不出是音频，自建的又不在托管名单里。
  assert.ok(PODCAST_HOST.test('https://www.ximalaya.com/album/52069269.xml'));
  assert.ok(PODCAST_HOST.test('https://justinyan.me/feed/podcast'));
  assert.ok(!PODCAST_HOST.test('https://einverne.github.io/atom.xml'));

  assert.ok(looksLikeAudio('<item><enclosure url="x.mp3" type="audio/mpeg"/></item>'));
  assert.ok(looksLikeAudio('<rss xmlns:itunes="..."><itunes:author>x</itunes:author></rss>'));
  assert.equal(looksLikeAudio('<item><title>普通文章</title></item>'), false);
});
