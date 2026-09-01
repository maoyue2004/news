import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readableCorpus, readabilityLines, MUTED_MIN_ITEMS, samplingWindows, samplingWindowLines } from '../lib/tinker/corpus.mjs';

const rows = (n, source, thin) => Array.from({ length: n }, (_, i) => ({ source, thin: i < thin }));

test('分母是可读语料，不是全部条目', () => {
  const c = readableCorpus([...rows(10, 'A', 6), ...rows(4, 'B', 0)]);
  assert.equal(c.total, 14);
  assert.equal(c.thin, 6);
  assert.equal(c.readable, 8);
});

test('大面积读不到正文的源会被标出来——这正是 2026-09-01 掘金熔断那次的形状', () => {
  // 掘金 121 条里 76 条 thin，而 MACHINE_REPORT 就是照着掘金那批稿子写的：
  // 它当天 0 命中，读不出「模板换了」，只读得出「没有考场」。
  const c = readableCorpus([...rows(121, '掘金搜索', 76), ...rows(20, '博客园首页', 0)]);
  assert.deepEqual(c.muted, ['掘金搜索']);
  const line = readabilityLines([...rows(121, '掘金搜索', 76), ...rows(20, '博客园首页', 0)]).join('\n');
  assert.match(line, /掘金搜索/);
  assert.match(line, /63%/);
});

test('样本太小不判哑——几条 thin 说明不了这个源今天没考场', () => {
  const small = rows(MUTED_MIN_ITEMS - 1, '某博客', MUTED_MIN_ITEMS - 1);
  assert.deepEqual(readableCorpus(small).muted, []);
  // 同样全是 thin，条数够了才算
  const big = rows(MUTED_MIN_ITEMS, '某博客', MUTED_MIN_ITEMS);
  assert.deepEqual(readableCorpus(big).muted, ['某博客']);
});

test('恰好一半 thin 就算哑，边界含在内', () => {
  assert.deepEqual(readableCorpus(rows(10, 'A', 5)).muted, ['A']);
  assert.deepEqual(readableCorpus(rows(10, 'A', 4)).muted, []);
});

test('空语料不炸，也不报出哑源', () => {
  const c = readableCorpus([]);
  assert.equal(c.total, 0);
  assert.equal(c.readable, 0);
  assert.deepEqual(c.muted, []);
  assert.equal(readabilityLines([]).length, 1);
});

// —— 采样窗口 ——
// 2026-09-02 加。判一个源「没什么货」之前先量它的窗口有多宽，
// 而这三次（NodeSeek 21 分钟、iThome 327 分钟、博客园首页 12.8 小时）的症状完全一样。

const dated = (n, source, spanHours) => Array.from({ length: n }, (_, i) => ({
  source,
  publishedAt: new Date(Date.UTC(2026, 8, 2, 0, 0, 0) + (i * spanHours * 3600000) / Math.max(n - 1, 1)).toISOString(),
}));

test('条数顶到 feed 上限、跨度不足一天 → 标成窄窗口', () => {
  const rows = samplingWindows(dated(20, '博客园首页', 12.8));
  assert.equal(rows[0].n, 20);
  assert.ok(Math.abs(rows[0].spanHours - 12.8) < 0.01);
  assert.equal(rows[0].narrow, true);
});

test('条数太少不算窄窗口——月更博客一轮本来就只有几条', () => {
  const rows = samplingWindows(dated(3, '某月更博客', 0.5));
  assert.equal(rows[0].narrow, false);
});

test('跨度够一天以上的不算——那是我们真的看全了', () => {
  const rows = samplingWindows(dated(20, '某搜索源', 480));
  assert.equal(rows[0].narrow, false);
});

test('publishedAt 缺失或解析不了的条目不参与，也不炸', () => {
  const rows = samplingWindows([{ source: 'A' }, { source: 'A', publishedAt: '不是时间' }]);
  assert.deepEqual(rows, []);
  assert.deepEqual(samplingWindowLines([]), []);
});

test('窄窗口的源会被点名，宽的不会', () => {
  const text = samplingWindowLines([
    ...dated(20, 'NodeSeek', 1.7),
    ...dated(20, '某搜索源', 480),
  ]).join('\n');
  assert.match(text, /NodeSeek：20 条只跨 1\.7 小时/);
  assert.doesNotMatch(text, /某搜索源/);
});
