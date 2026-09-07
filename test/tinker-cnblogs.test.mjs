import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cnblogsUser, cnblogsFeedUser, handledUsers, publishedCnblogsAuthors } from '../scripts/tinker-cnblogs.mjs';

test('从收录条目的 url 里取作者名，站务路径不算人', () => {
  assert.equal(cnblogsUser('https://www.cnblogs.com/rossiXYZ/p/19012345.html'), 'rossiXYZ');
  assert.equal(cnblogsUser('https://www.cnblogs.com/grey-wolf/archive/2026/09/01/x.html'), 'grey-wolf');
  // `/news/` `/cmt/` 这些是博客园自己的板块，不是某个人的随笔。
  assert.equal(cnblogsUser('https://news.cnblogs.com/n/123456/'), null);
  assert.equal(cnblogsUser('https://www.cnblogs.com/cmt/p/1.html'), null);
  // 只有一段路径（作者主页）不认——这条通道要的是「他发过随笔」这个证据。
  assert.equal(cnblogsUser('https://www.cnblogs.com/rossiXYZ'), null);
  assert.equal(cnblogsUser('https://juejin.cn/post/7412345678'), null);
  assert.equal(cnblogsUser('not a url'), null);
});

test('已订阅和已否决的作者都要认出来，而判据是 feed URL 不是域名', () => {
  // 博客园是一个域名挂几十万人的聚合站：按域名比会把「博客园首页」自己算进去，
  // 于是一个作者都评不出来，而症状是「今天没有新作者」——和真的没有一模一样。
  const sources = [
    { name: '博客园首页', url: 'https://www.cnblogs.com', feed: 'https://feed.cnblogs.com/blog/sitehome/rss' },
    { name: '博客园 · 罗西的思考', url: 'https://www.cnblogs.com/rossiXYZ', feed: 'https://www.cnblogs.com/rossiXYZ/rss' },
    { name: '不相干的站', url: 'https://example.com', feed: 'https://example.com/feed' },
  ];
  // denylist 里博客园那批记的是 `scope: "feed"`（和 wechat2rss 同形），
  // 而 `deniedHostsFrom()` 刻意不把它们按域名否掉——所以这一侧必须单独按 feed URL 读。
  const denylist = [
    { feed: 'https://www.cnblogs.com/jinjiangongzuoshi/rss', scope: 'feed', reason: '清单体' },
    { url: 'https://someblog.example/', reason: '别的站' },
  ];
  const handled = handledUsers(sources, denylist);
  assert.ok(handled.has('rossixyz'));
  assert.ok(handled.has('jinjiangongzuoshi'));
  assert.ok(!handled.has('*'), '博客园首页那条不该把整个平台判成已否决');
  assert.ok(!handled.has('grey-wolf'));
});

test('cnblogsFeedUser 只认作者 feed，聚合 feed 返回 null', () => {
  assert.equal(cnblogsFeedUser('https://www.cnblogs.com/rossiXYZ/rss'), 'rossiXYZ');
  assert.equal(cnblogsFeedUser('https://feed.cnblogs.com/blog/sitehome/rss'), null);
  assert.equal(cnblogsFeedUser('https://www.cnblogs.com'), null);
  assert.equal(cnblogsFeedUser('https://example.com/rss'), null);
});

test('日文件里按作者聚合收录篇数，--days 只看窗口内那几天', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cnblogs-'));
  const today = new Date();
  const day = (back) => new Date(today.getTime() - back * 86400000).toISOString().slice(0, 10);
  writeFileSync(join(dir, `${day(1)}.json`), JSON.stringify({
    date: day(1),
    items: [
      { url: 'https://www.cnblogs.com/aaa/p/1.html', titleZh: '近的一篇', rating: 5 },
      { url: 'https://www.cnblogs.com/aaa/p/2.html', titleZh: '近的另一篇', rating: 4 },
      { url: 'https://juejin.cn/post/1', titleZh: '不是博客园' },
    ],
  }));
  writeFileSync(join(dir, `${day(40)}.json`), JSON.stringify({
    date: day(40),
    items: [{ url: 'https://www.cnblogs.com/bbb/p/9.html', titleZh: '远的一篇', rating: 4 }],
  }));

  const all = publishedCnblogsAuthors(dir);
  assert.deepEqual(all.map((a) => a.user), ['aaa', 'bbb']);
  assert.equal(all[0].posts, 2);
  assert.deepEqual(all[0].ratings, [5, 4]);

  const recent = publishedCnblogsAuthors(dir, 30);
  assert.deepEqual(recent.map((a) => a.user), ['aaa']);
});
