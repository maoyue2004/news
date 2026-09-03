import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectTargets, mergeIntoShortlist, THIN_THRESHOLD } from '../lib/tinker/reenrich.mjs';

const long = (n = THIN_THRESHOLD + 50) => '正'.repeat(n);

function item(id, source, excerpt) {
  return { id, source, url: `https://example.com/${id}`, titleOriginal: id, excerpt, thin: excerpt.length < THIN_THRESHOLD };
}

test('只挑被熔断那些源的 thin 条目', () => {
  const items = [
    item('a', '掘金搜索', '只有标题'),
    item('b', '掘金搜索', long()),        // 有正文，不重复要
    item('c', '博客园首页', '只有标题'),   // 没被熔断的源，thin 是结论不是故障
  ];
  const got = selectTargets({ items, sources: ['掘金搜索'] });
  assert.deepEqual(got.map((it) => it.id), ['a']);
});

test('limit 是请求预算的上限', () => {
  const items = Array.from({ length: 10 }, (_, i) => item(`i${i}`, '掘金搜索', '短'));
  assert.equal(selectTargets({ items, sources: ['掘金搜索'], limit: 3 }).length, 3);
});

test('预算先花在入围名单里的 thin 条目上', () => {
  const items = [
    item('gated1', '掘金搜索', '短'),
    item('gated2', '掘金搜索', '短'),
    item('shortlisted', '掘金搜索', '短'),
  ];
  const got = selectTargets({ items, sources: ['掘金搜索'], limit: 2, priorityIds: ['shortlisted'] });
  assert.deepEqual(got.map((it) => it.id), ['shortlisted', 'gated1']);
});

test('救回来的正文写回入围名单，其余字段不动', () => {
  const shortlist = [
    { id: 'a', excerpt: '只有标题', thin: true, preScore: 11, preReasons: ['标题命中：codex'] },
    { id: 'b', excerpt: '只有标题', thin: true, preScore: 9 },
  ];
  const fresh = [
    { id: 'a', excerpt: long(), tail: '结尾四百字' },
    { id: 'b', excerpt: '还是只有标题' },   // 这一轮仍然没救回来
  ];
  const updated = mergeIntoShortlist(shortlist, fresh);
  assert.deepEqual(updated, ['a']);
  assert.equal(shortlist[0].thin, false);
  assert.equal(shortlist[0].tail, '结尾四百字');
  assert.equal(shortlist[0].preScore, 11, '分数是抓取那一轮的账，错时补全不改写');
  assert.deepEqual(shortlist[0].preReasons, ['标题命中：codex']);
  assert.equal(shortlist[1].thin, true, '没救回来的照旧是 thin');
});

test('不会用更短的正文盖掉已经有的那份', () => {
  const shortlist = [{ id: 'a', excerpt: long(600), thin: false }];
  const updated = mergeIntoShortlist(shortlist, [{ id: 'a', excerpt: long() }]);
  assert.deepEqual(updated, []);
  assert.equal(shortlist[0].excerpt.length, 600);
});
