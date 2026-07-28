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

test('【修复】未知或缺失的 type 归入「其他」桶而不是被丢弃', () => {
  const groups = L.groupByType([
    item({ id: '1', type: 'blog' }),
    item({ id: '2', type: 'weird-unknown-type' }),
    item({ id: '3', type: undefined }),
  ]);
  const totalItems = groups.reduce((n, g) => n + g.items.length, 0);
  assert.equal(totalItems, 3, '所有条目都应该出现在某个分组里，一条都不能丢');
  const other = groups.find((g) => g.label === '其他');
  assert.ok(other, '应该存在一个「其他」分组');
  assert.deepEqual(other.items.map((i) => i.id).sort(), ['id-2', 'id-3']);
  // 「其他」排在已知类型分组之后
  assert.equal(groups[groups.length - 1].label, '其他');
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

// 以下测试覆盖 applyFilter 新增的 source 选项：分布行里点某个信源名，
// 只看该信源的条目。undefined/null 表示不筛选，必须和不传这个字段时
// 行为完全一致（旧调用方、旧测试都不传 source）。

test('source 筛选：只返回该信源的条目', () => {
  const items = [item({ id: '1', source: 'A' }), item({ id: '2', source: 'B' })];
  const out = L.applyFilter(items, { filter: 'all', query: '', readSet: new Set(), starSet: new Set(), source: 'A' });
  assert.deepEqual(out.map((i) => i.id), ['id-1']);
});

test('source 为 undefined 或 null 时不筛选，行为与不传一致', () => {
  const items = [item({ id: '1', source: 'A' }), item({ id: '2', source: 'B' })];
  const opts = { filter: 'all', query: '', readSet: new Set(), starSet: new Set() };
  const base = L.applyFilter(items, opts).map((i) => i.id);
  assert.deepEqual(L.applyFilter(items, { ...opts, source: undefined }).map((i) => i.id), base);
  assert.deepEqual(L.applyFilter(items, { ...opts, source: null }).map((i) => i.id), base);
});

test('source 与 unread 筛选同时生效，取交集', () => {
  const items = [
    item({ id: '1', source: 'A' }),
    item({ id: '2', source: 'A' }),
    item({ id: '3', source: 'B' }),
  ];
  const out = L.applyFilter(items, {
    filter: 'unread', query: '', readSet: new Set(['id-1']), starSet: new Set(), source: 'A',
  });
  assert.deepEqual(out.map((i) => i.id), ['id-2']);
});

test('source 与搜索同时生效，取交集', () => {
  const items = [
    item({ id: '1', source: 'A', titleOriginal: 'Reward Hacking' }),
    item({ id: '2', source: 'B', titleOriginal: 'Reward Hacking' }),
  ];
  const out = L.applyFilter(items, {
    filter: 'all', query: 'reward', readSet: new Set(), starSet: new Set(), source: 'A',
  });
  assert.deepEqual(out.map((i) => i.id), ['id-1']);
});

test('source 指定不存在的信源名时返回空数组', () => {
  const items = [item({ id: '1', source: 'A' })];
  const out = L.applyFilter(items, {
    filter: 'all', query: '', readSet: new Set(), starSet: new Set(), source: 'Nonexistent',
  });
  assert.deepEqual(out, []);
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

// 以下测试覆盖 sourceBreakdown：分组标题下面那一行「信源 条数」分布，
// 统计的是调用方传进来的条目（已经过筛选/搜索），按条数降序、同条数按
// 信源名升序排，超过 topN 个合并成「其他」放在最后。

test('sourceBreakdown 按条数降序排列', () => {
  const items = [
    item({ id: '1', source: 'A' }),
    item({ id: '2', source: 'B' }),
    item({ id: '3', source: 'B' }),
    item({ id: '4', source: 'B' }),
  ];
  const out = L.sourceBreakdown(items);
  assert.deepEqual(out, [{ source: 'B', count: 3 }, { source: 'A', count: 1 }]);
});

test('sourceBreakdown 条数相同时按信源名升序排列（稳定）', () => {
  const items = [
    item({ id: '1', source: 'Zeta' }),
    item({ id: '2', source: 'Alpha' }),
    item({ id: '3', source: 'Mid' }),
  ];
  const out = L.sourceBreakdown(items);
  assert.deepEqual(out.map((x) => x.source), ['Alpha', 'Mid', 'Zeta']);
});

test('sourceBreakdown 超过 topN 时合并「其他」，其 count 等于剩余之和且排在最后', () => {
  const items = [
    item({ id: '1', source: 'S1' }),
    item({ id: '2', source: 'S1' }),
    item({ id: '3', source: 'S2' }),
    item({ id: '4', source: 'S3' }),
    item({ id: '5', source: 'S4' }),
    item({ id: '6', source: 'S5' }),
    item({ id: '7', source: 'S6' }),
    item({ id: '8', source: 'S7' }),
  ];
  const out = L.sourceBreakdown(items, 5);
  assert.equal(out.length, 6);
  assert.equal(out[out.length - 1].source, '其他');
  assert.equal(out[out.length - 1].isOther, true);
  // 7 个信源，S1 有 2 条、其余各 1 条：前 5 名是 S1(2)、S2、S3、S4、S5，
  // 剩下 S6、S7 各 1 条合并进「其他」，共 2 条。
  const totalInOther = out[out.length - 1].count;
  assert.equal(totalInOther, 2);
});

test('sourceBreakdown 不超过 topN 时不出现「其他」', () => {
  const items = [
    item({ id: '1', source: 'A' }),
    item({ id: '2', source: 'B' }),
  ];
  const out = L.sourceBreakdown(items, 5);
  assert.ok(!out.some((x) => x.isOther));
  assert.equal(out.length, 2);
});

test('sourceBreakdown 空数组返回空数组', () => {
  assert.deepEqual(L.sourceBreakdown([]), []);
});

// 以下测试覆盖 sourceBreakdown 新增的 pinned 参数：被 pin 的信源
// 永远出现在结果里，不会被并入「其他」。

test('sourceBreakdown pinned 为 undefined 时行为与不传一致', () => {
  const items = [
    item({ id: '1', source: 'S1' }),
    item({ id: '2', source: 'S1' }),
    item({ id: '3', source: 'S2' }),
    item({ id: '4', source: 'S3' }),
    item({ id: '5', source: 'S4' }),
    item({ id: '6', source: 'S5' }),
    item({ id: '7', source: 'S6' }),
    item({ id: '8', source: 'S7' }),
  ];
  const withoutPinned = L.sourceBreakdown(items, 5);
  const withUndefinedPinned = L.sourceBreakdown(items, 5, undefined);
  assert.deepEqual(withUndefinedPinned, withoutPinned);
});

test('sourceBreakdown pinned 为 null 时行为与不传一致', () => {
  const items = [
    item({ id: '1', source: 'S1' }),
    item({ id: '2', source: 'S1' }),
    item({ id: '3', source: 'S2' }),
    item({ id: '4', source: 'S3' }),
    item({ id: '5', source: 'S4' }),
    item({ id: '6', source: 'S5' }),
    item({ id: '7', source: 'S6' }),
    item({ id: '8', source: 'S7' }),
  ];
  const withoutPinned = L.sourceBreakdown(items, 5);
  const withNullPinned = L.sourceBreakdown(items, 5, null);
  assert.deepEqual(withNullPinned, withoutPinned);
});

test('sourceBreakdown pinned 为空串时行为与不传一致', () => {
  const items = [
    item({ id: '1', source: 'S1' }),
    item({ id: '2', source: 'S1' }),
    item({ id: '3', source: 'S2' }),
    item({ id: '4', source: 'S3' }),
    item({ id: '5', source: 'S4' }),
    item({ id: '6', source: 'S5' }),
    item({ id: '7', source: 'S6' }),
    item({ id: '8', source: 'S7' }),
  ];
  const withoutPinned = L.sourceBreakdown(items, 5);
  const withEmptyStringPinned = L.sourceBreakdown(items, 5, '');
  assert.deepEqual(withEmptyStringPinned, withoutPinned);
});

test('sourceBreakdown pin 一个会掉进「其他」的低频源，它单独出现且「其他」计数减少', () => {
  const items = [
    item({ id: '1', source: 'S1' }),
    item({ id: '2', source: 'S1' }),
    item({ id: '3', source: 'S2' }),
    item({ id: '4', source: 'S3' }),
    item({ id: '5', source: 'S4' }),
    item({ id: '6', source: 'S5' }),
    item({ id: '7', source: 'S6' }),
    item({ id: '8', source: 'S7' }),
  ];
  const out = L.sourceBreakdown(items, 5, 'S6');
  // 前 5 名：S1(2), S2(1), S3(1), S4(1), S5(1)
  // S6 本来在「其他」里，现在被 pin，单独提出来
  // 「其他」变成只有 S7
  assert.equal(out.length, 7); // S1, S2, S3, S4, S5, S6, 其他
  assert.deepEqual(out.map((x) => x.source), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', '其他']);
  assert.equal(out.find((x) => x.source === 'S6').count, 1);
  assert.equal(out.find((x) => x.isOther).count, 1); // 只有 S7 一条
});

test('sourceBreakdown pin 一个本来就在 topN 里的源，结果不变无重复', () => {
  const items = [
    item({ id: '1', source: 'S1' }),
    item({ id: '2', source: 'S1' }),
    item({ id: '3', source: 'S2' }),
    item({ id: '4', source: 'S3' }),
    item({ id: '5', source: 'S4' }),
    item({ id: '6', source: 'S5' }),
    item({ id: '7', source: 'S6' }),
    item({ id: '8', source: 'S7' }),
  ];
  const withoutPin = L.sourceBreakdown(items, 5);
  const withPin = L.sourceBreakdown(items, 5, 'S1');
  assert.deepEqual(withPin, withoutPin);
  // 确认没有重复
  assert.equal(withPin.filter((x) => x.source === 'S1').length, 1);
});

test('sourceBreakdown pin 后「其他」变 0 条则不输出「其他」', () => {
  const items = [
    item({ id: '1', source: 'S1' }),
    item({ id: '2', source: 'S1' }),
    item({ id: '3', source: 'S2' }),
    item({ id: '4', source: 'S3' }),
    item({ id: '5', source: 'S4' }),
    item({ id: '6', source: 'S5' }),
    item({ id: '7', source: 'S6' }),
  ];
  const out = L.sourceBreakdown(items, 5, 'S6');
  // 前 5 名：S1(2), S2(1), S3(1), S4(1), S5(1)
  // S6 本来在「其他」里，现在被 pin，单独提出来
  // 「其他」本来只有 S6，现在 S6 被提出，「其他」变成 0 条，不输出
  assert.ok(!out.some((x) => x.isOther));
  assert.deepEqual(out.map((x) => x.source), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
});

test('sourceBreakdown pin 一个在 items 里不存在的源，不产生 0 条的项', () => {
  const items = [
    item({ id: '1', source: 'S1' }),
    item({ id: '2', source: 'S1' }),
    item({ id: '3', source: 'S2' }),
    item({ id: '4', source: 'S3' }),
    item({ id: '5', source: 'S4' }),
    item({ id: '6', source: 'S5' }),
    item({ id: '7', source: 'S6' }),
    item({ id: '8', source: 'S7' }),
  ];
  const out = L.sourceBreakdown(items, 5, 'Nonexistent');
  const withoutPin = L.sourceBreakdown(items, 5);
  assert.deepEqual(out, withoutPin);
  // 确认 Nonexistent 没有出现
  assert.ok(!out.some((x) => x.source === 'Nonexistent'));
});

// 以下测试覆盖 countsBySource：信源管理页「今日」「最近 30 天」两列。
// today 只统计 days[0]（最新一天），window 统计传入的全部天数。

test('countsBySource：today 只统计第一天，window 统计全部天', () => {
  const days = [
    { date: '2026-07-27', items: [item({ id: '1', source: 'A' }), item({ id: '2', source: 'B' })] },
    { date: '2026-07-26', items: [item({ id: '3', source: 'A' })] },
  ];
  const out = L.countsBySource(days);
  assert.deepEqual(out.today, { A: 1, B: 1 });
  assert.deepEqual(out.window, { A: 2, B: 1 });
});

test('countsBySource：同一信源跨天累加', () => {
  const days = [
    { date: '2026-07-27', items: [item({ id: '1', source: 'A' })] },
    { date: '2026-07-26', items: [item({ id: '2', source: 'A' })] },
    { date: '2026-07-25', items: [item({ id: '3', source: 'A' })] },
  ];
  const out = L.countsBySource(days);
  assert.equal(out.today.A, 1);
  assert.equal(out.window.A, 3);
});

test('countsBySource：空 days 返回两个空对象', () => {
  assert.deepEqual(L.countsBySource([]), { today: {}, window: {} });
});

// 以下测试覆盖 buildStateExport / parseStateImport：信源管理页的
// 「导出已读与收藏」「导入已读与收藏」。这两个函数是纯的，FileReader
// 与 DOM 留在 ui.js 里，这里只测数据形状与容错。

test('buildStateExport：导出标星条目全文与已读 id 列表', () => {
  const items = [item({ id: '1' }), item({ id: '2' }), item({ id: '3' })];
  const out = L.buildStateExport(
    items,
    new Set(['id-1', 'id-3']),
    new Set(['id-2']),
    '2026-07-28T00:00:00.000Z',
  );
  assert.equal(out.version, 2);
  assert.equal(out.exportedAt, '2026-07-28T00:00:00.000Z');
  assert.deepEqual(out.items.map((x) => x.id), ['id-2']);
  assert.deepEqual(out.read, ['id-1', 'id-3']);
});

// 已读集合是无损备份：localStorage 里可能留着 30 天窗口之外、页面数据里
// 已经不存在的条目 id。这些 id 照样要导出——过滤掉就不是备份了。
test('buildStateExport：已读 id 不受当前条目集合限制，原样导出', () => {
  const out = L.buildStateExport(
    [item({ id: '1' })],
    new Set(['id-1', 'id-已经滚出窗口']),
    new Set(),
    '2026-07-28T00:00:00.000Z',
  );
  assert.deepEqual(out.read, ['id-1', 'id-已经滚出窗口']);
  assert.deepEqual(out.items, []);
});

test('buildStateExport：空状态导出两个空数组', () => {
  const out = L.buildStateExport([item({ id: '1' })], new Set(), new Set(), 'T');
  assert.deepEqual(out.items, []);
  assert.deepEqual(out.read, []);
});

test('parseStateImport：新版文件同时取出标星与已读', () => {
  const out = L.parseStateImport({ items: [{ id: 'a' }, { id: 'b' }], read: ['c', 'd'] });
  assert.equal(out.ok, true);
  assert.deepEqual(out.starIds, ['a', 'b']);
  assert.deepEqual(out.readIds, ['c', 'd']);
});

// 旧版导出文件只有 items 没有 read。必须照常导入标星，已读当作空——
// 否则用户手上早先导出的备份会直接报错，等于把备份作废了。
test('parseStateImport：兼容没有 read 字段的旧版文件', () => {
  const out = L.parseStateImport({ exportedAt: 'T', items: [{ id: 'a' }] });
  assert.equal(out.ok, true);
  assert.deepEqual(out.starIds, ['a']);
  assert.deepEqual(out.readIds, []);
});

test('parseStateImport：跳过缺 id 或 id 不是字符串的条目', () => {
  const out = L.parseStateImport({
    items: [{ id: 'a' }, {}, null, { id: 42 }, { id: '' }, { id: 'b' }],
    read: ['c', 42, null, '', 'd'],
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.starIds, ['a', 'b']);
  assert.deepEqual(out.readIds, ['c', 'd']);
});

test('parseStateImport：items 不是数组时报错', () => {
  const out = L.parseStateImport({ items: 'nope' });
  assert.equal(out.ok, false);
  assert.match(out.error, /items/);
});

// read 字段存在却不是数组，说明文件是坏的。这里宁可报错也不静默当成空：
// 静默会让用户以为已读导入成功了，实际一条都没进去。
test('parseStateImport：read 存在但不是数组时报错', () => {
  const out = L.parseStateImport({ items: [], read: { a: 1 } });
  assert.equal(out.ok, false);
  assert.match(out.error, /read/);
});

test('parseStateImport：null 或非对象时报错', () => {
  assert.equal(L.parseStateImport(null).ok, false);
  assert.equal(L.parseStateImport('x').ok, false);
});

test('导出再导入是一次无损往返', () => {
  const items = [item({ id: '1' }), item({ id: '2' })];
  const exported = L.buildStateExport(items, new Set(['id-1']), new Set(['id-2']), 'T');
  const round = L.parseStateImport(JSON.parse(JSON.stringify(exported)));
  assert.equal(round.ok, true);
  assert.deepEqual(round.starIds, ['id-2']);
  assert.deepEqual(round.readIds, ['id-1']);
});
