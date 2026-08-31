import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readableCorpus, readabilityLines, MUTED_MIN_ITEMS } from '../lib/tinker/corpus.mjs';

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
