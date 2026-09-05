import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpml, parseMarkdown, parseSiteList, parseBoyouquan, looksLikeAudio, PODCAST_HOST, deniedHostsFrom } from '../scripts/tinker-harvest.mjs';

test('parseBoyouquan 收裸域名的 JSON 索引：补 scheme、按域名去重、feed 留空', () => {
  const json = JSON.stringify([
    { blogName: '彼岸临窗', domainName: '023.me' },
    { blogName: '同一个站', domainName: 'www.023.me' },
    { blogName: '带了 scheme', domainName: 'https://b.com' },
    { blogName: '不是博客', domainName: 'zhuanlan.zhihu.com' },
    { blogName: '空的', domainName: '' },
  ]);
  const rows = parseBoyouquan(json);
  assert.equal(rows.length, 2);
  const a = rows.find((r) => r.url === 'https://023.me');
  assert.equal(a.feed, null);
  assert.equal(a.name, '彼岸临窗');
  // TECH_TAGS 那道闸按 tags 过滤，站点列表型索引一律标「技术」，否则整份索引会被静默滤光。
  assert.equal(a.tags, '技术');
  assert.ok(rows.some((r) => r.url === 'https://b.com'));
  assert.ok(!rows.some((r) => /zhihu/.test(r.url)));
  // 拿不到 JSON（接口改了 / 返回 HTML）时返回空数组，不要让整轮 harvest 崩掉。
  assert.deepEqual(parseBoyouquan('<html>403</html>'), []);
});

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

test('denylist 的两种 key 都要读，否则否决过的站会被重新提名', () => {
  // 2026-08-31 周更体检抓到的真 bug：这份账本早期记 `feed`（wechat2rss 那批），
  // 从 08-21 起「探到站点、判它不够格」那一类记的是 `url`——落盘那一刻手上还没有
  // feed 地址。75 条里 12 条是后者，而 harvest / blogroll 都只读 `feed`，
  // 于是那 12 条从写下那天起就没生效过。症状：本轮 4 个命中里 2 个
  // （imsuk.cn、fuwari.oh1.top）是 08-24 亲手否掉并写进 denylist 的。
  const hosts = deniedHostsFrom([
    { feed: 'https://a.com/feed.xml', name: '记 feed 的老条目' },
    { url: 'https://imsuk.cn/', name: '记 url 的新条目' },
    { domain: 'c.com', name: '只有域名的' },
    // 聚合网关：一个域名下几百个互不相干的号，否的是号不是域名。
    { feed: 'https://wechat2rss.xlab.app/feed/abc.xml', name: '某公众号', scope: 'feed' },
    { name: '两个 key 都没有的脏数据' },
  ]);
  assert.ok(hosts.has('a.com'));
  assert.ok(hosts.has('imsuk.cn'), '只读 feed 的话这一条会被静默丢掉');
  assert.ok(hosts.has('c.com'));
  assert.ok(!hosts.has('wechat2rss.xlab.app'), 'scope:feed 的聚合网关不能按域名整个否掉');
  assert.equal(hosts.size, 3, '脏数据不该变成一个空 host 混进集合');
});
