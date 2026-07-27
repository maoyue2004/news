import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let L;
before(() => {
  const code = readFileSync('templates/logic.js', 'utf8');
  // 注意：这里没有用 vm.createContext + vm.runInContext（brief 原稿的写法）。
  // createContext 会开一个独立的 V8 realm，导致 logic.js 里 `[]`/`{}` 字面量
  // 产出的数组/对象带着另一个 realm 的 Array.prototype/Object.prototype。
  // node:assert/strict 的 deepEqual 等价于 deepStrictEqual，会用 === 比较
  // [[Prototype]]，跨 realm 时哪怕内容完全一样也会报
  // “Values have same structure but are not reference-equal”。
  // 用 runInThisContext 在当前 realm 里执行，规避这个问题；对 logic.js
  // 本身透明（它只是往全局 window 上挂东西）。
  globalThis.window = globalThis.window || {};
  vm.runInThisContext(code, { filename: 'templates/logic.js' });
  L = globalThis.window.ReaderLogic;
});

function item(over = {}) {
  // 注意：这里把 id 字段挪到 `...over` 之后计算（brief 原稿把它放在最前面，
  // 会被后面的 `...over` 覆盖掉 'id-' 前缀，导致任何显式传 id 的用例都拿到
  // 裸的 '1'/'2' 而不是 'id-1'/'id-2'，与下面依赖 'id-N' 格式的断言对不上）。
  return {
    source: 'S', type: 'blog', lang: 'en',
    url: 'https://e.com/x', titleOriginal: 'Original Title',
    titleZh: '中文标题', summaryZh: '中文摘要内容',
    publishedAt: '2026-07-27T00:00:00.000Z', brief: false, ...over,
    id: 'id-' + (over.id ?? '1'),
  };
}

test('按类型分组并遵循固定顺序', () => {
  const groups = L.groupByType([
    item({ id: '1', type: 'podcast' }),
    item({ id: '2', type: 'blog' }),
    item({ id: '3', type: 'lab' }),
  ]);
  assert.deepEqual(groups.map((g) => g.type), ['blog', 'lab', 'podcast']);
  assert.equal(groups[0].items.length, 1);
});

test('分组里不出现空类型', () => {
  const groups = L.groupByType([item({ id: '1', type: 'blog' })]);
  assert.equal(groups.length, 1);
});

test('每个类型都有中文标签', () => {
  for (const t of L.TYPE_ORDER) {
    assert.equal(typeof L.TYPE_LABELS[t], 'string');
    assert.ok(L.TYPE_LABELS[t].length > 0);
  }
});

test('未读筛选排除已读条目', () => {
  const items = [item({ id: '1' }), item({ id: '2' })];
  const out = L.applyFilter(items, { filter: 'unread', query: '', readSet: new Set(['id-1']), starSet: new Set() });
  assert.deepEqual(out.map((i) => i.id), ['id-2']);
});

test('标星筛选只留标星条目', () => {
  const items = [item({ id: '1' }), item({ id: '2' })];
  const out = L.applyFilter(items, { filter: 'starred', query: '', readSet: new Set(), starSet: new Set(['id-2']) });
  assert.deepEqual(out.map((i) => i.id), ['id-2']);
});

test('搜索同时命中中文标题、中文摘要、英文原标题和信源名', () => {
  const items = [item({ id: '1', titleZh: '报酬黑客', summaryZh: 'x', titleOriginal: 'y', source: 'z' })];
  const opts = { filter: 'all', readSet: new Set(), starSet: new Set() };
  assert.equal(L.applyFilter(items, { ...opts, query: '报酬' }).length, 1);
  assert.equal(L.applyFilter([item({ id: '2', summaryZh: '独特摘要' })], { ...opts, query: '独特' }).length, 1);
  assert.equal(L.applyFilter([item({ id: '3', titleOriginal: 'Unique English' })], { ...opts, query: 'unique' }).length, 1);
  assert.equal(L.applyFilter([item({ id: '4', source: 'Interconnects' })], { ...opts, query: 'intercon' }).length, 1);
  assert.equal(L.applyFilter(items, { ...opts, query: '不存在的词' }).length, 0);
});

test('搜索大小写不敏感', () => {
  const items = [item({ titleOriginal: 'Reward Hacking' })];
  const out = L.applyFilter(items, { filter: 'all', query: 'REWARD', readSet: new Set(), starSet: new Set() });
  assert.equal(out.length, 1);
});

test('统计给出总数、未读数与标星数', () => {
  const items = [item({ id: '1' }), item({ id: '2' }), item({ id: '3' })];
  const s = L.computeStats(items, new Set(['id-1']), new Set(['id-2', 'id-3']));
  assert.deepEqual(s, { total: 3, unread: 2, starred: 2 });
});

test('日期标签：今天和昨天用中文词', () => {
  assert.equal(L.formatDayLabel('2026-07-27', '2026-07-27'), '今天');
  assert.equal(L.formatDayLabel('2026-07-26', '2026-07-27'), '昨天');
});

test('日期标签：更早的显示月日与星期', () => {
  assert.equal(L.formatDayLabel('2026-07-24', '2026-07-27'), '7月24日 周五');
});

// 以下测试覆盖 brief 之外新增的 thin 徽标（抓不到正文，摘要只能依据标题写），
// 以及它和已有的 brief 徽标（播客/视频只看官方简介）同时出现的情况。
// itemBadges 是从 ui.js 抽出来的纯字符串拼接函数，不碰 DOM，因此能在这里单测，
// 不必依赖浏览器渲染去肉眼确认徽标是否正确显示。

test('thin 条目显示“仅标题”徽标', () => {
  const html = L.itemBadges(item({ thin: true, brief: false }));
  assert.match(html, /仅标题/);
  assert.doesNotMatch(html, /基于官方简介/);
});

test('brief 播客条目显示“基于官方简介，未收听”且用耳机符号', () => {
  const html = L.itemBadges(item({ type: 'podcast', brief: true, thin: false }));
  assert.match(html, /基于官方简介，未收听/);
  assert.match(html, /🎧/);
  assert.doesNotMatch(html, /仅标题/);
});

test('brief 视频条目用播放符号而不是耳机', () => {
  const html = L.itemBadges(item({ type: 'video', brief: true, thin: false }));
  assert.match(html, /▶/);
  assert.doesNotMatch(html, /🎧/);
});

test('thin 与 brief 可以同时出现，两个徽标都在', () => {
  const html = L.itemBadges(item({ type: 'podcast', brief: true, thin: true }));
  assert.match(html, /基于官方简介，未收听/);
  assert.match(html, /仅标题/);
});

test('两者都不成立时不产生任何徽标', () => {
  const html = L.itemBadges(item({ brief: false, thin: false }));
  assert.equal(html, '');
});

// 以下测试覆盖 safeUrl：条目的 url 一路从远端 RSS feed 流进来，属于不可信数据，
// esc() 只做 HTML 实体转义，挡不住 javascript:/data: 这类伪协议，必须先过一道
// 协议白名单。只放行 http/https，其余一律换成 '#'。

test('http 与 https 链接原样放行', () => {
  assert.equal(L.safeUrl('http://example.com/a'), 'http://example.com/a');
  assert.equal(L.safeUrl('https://example.com/a?x=1'), 'https://example.com/a?x=1');
});

test('javascript 伪协议被拦截', () => {
  assert.equal(L.safeUrl('javascript:alert(1)'), '#');
});

test('大小写混写的伪协议也被拦截', () => {
  assert.equal(L.safeUrl('JaVaScRiPt:alert(1)'), '#');
});

test('带前导空白的伪协议被拦截', () => {
  assert.equal(L.safeUrl('  javascript:alert(1)'), '#');
});

test('内嵌制表符/换行的伪协议被拦截（绕过手法）', () => {
  assert.equal(L.safeUrl('java\tscript:alert(1)'), '#');
  assert.equal(L.safeUrl('java\nscript:alert(1)'), '#');
});

test('data 协议被拦截', () => {
  assert.equal(L.safeUrl('data:text/html,<script>alert(1)</script>'), '#');
});

test('空值、undefined 与非法字符串一律返回 #', () => {
  assert.equal(L.safeUrl(''), '#');
  assert.equal(L.safeUrl(undefined), '#');
  assert.equal(L.safeUrl('not a url'), '#');
});
