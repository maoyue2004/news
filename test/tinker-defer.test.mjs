import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSeen, DEFER_ROUNDS, DEFER_TTL_DAYS } from '../lib/tinker/defer.mjs';
import { triage } from '../lib/tinker/relevance.mjs';

const TODAY = '2026-08-23';

/** 造一条能过分数线的条目：标题命中工具词 + 第一人称动作 + 够长的正文。 */
function item(i, source) {
  return {
    id: `id${i}`,
    source,
    kind: 'search',
    url: `https://example.com/${i}`,
    titleOriginal: `我用 Claude Code 折腾了一个东西 ${i}`,
    excerpt: `我把 Claude Code 接进项目，踩了几个坑，记录一下过程和结果。${'实测细节。'.repeat(80)}`,
    publishedAt: '2026-08-22T00:00:00.000Z',
    preScore: 0,
    preReasons: [],
  };
}

test('被名额挡掉的条目标 gated，被规则毙掉的不标', () => {
  // 一个源供给压倒性多：远超 PER_SOURCE_QUOTA * QUOTA_RELAX，但名单远没满
  const items = Array.from({ length: 40 }, (_, i) => item(i, '掘金搜索'));
  // 一条注定被规则毙掉的（招聘帖，硬毙）
  const job = item(99, '掘金搜索');
  job.titleOriginal = '招聘 高级后端工程师 30-60K 双休';
  const { shortlist, rejected } = triage([...items, job], { cap: 60 });

  assert.ok(shortlist.length < 60, '名单不该被单源填满');
  const gated = rejected.filter((r) => r.gated);
  assert.ok(gated.length > 0, '应有条目因单源配额落选并标 gated');
  for (const r of gated) assert.match(r.reasons.at(-1), /配额|上限|名额/);

  const byRule = rejected.find((r) => r.id === 'id99');
  assert.ok(byRule, '招聘帖应被毙掉');
  assert.equal(byRule.gated, undefined, '规则判断的落选不是 gated');
});

test('规则落选记 seen，名额落选不记、攒轮次', () => {
  const ids = ['a', 'b', 'c'];
  const gatedIds = new Set(['b', 'c']);
  const r1 = planSeen({ ids, gatedIds, deferred: {}, today: TODAY });
  assert.deepEqual(r1.seenIds, ['a']);
  assert.deepEqual(Object.keys(r1.deferred).sort(), ['b', 'c']);
  assert.equal(r1.deferred.b.attempts, 1);
  assert.deepEqual(r1.promoted, []);
});

test('攒够 DEFER_ROUNDS 轮仍没排上队就落成结论', () => {
  let deferred = {};
  for (let round = 1; round < DEFER_ROUNDS; round += 1) {
    const r = planSeen({ ids: ['b'], gatedIds: new Set(['b']), deferred, today: TODAY });
    assert.deepEqual(r.seenIds, [], `第 ${round} 轮不该记 seen`);
    deferred = r.deferred;
  }
  const last = planSeen({ ids: ['b'], gatedIds: new Set(['b']), deferred, today: TODAY });
  assert.deepEqual(last.seenIds, ['b']);
  assert.deepEqual(last.promoted.map((p) => p.id), ['b']);
  assert.equal(last.deferred.b, undefined, '落成结论后要从待定账本里清掉');
});

test('闸门分开记：被三道不同的闸各挡一次，不是同一件事被记了三遍', () => {
  // 2026-08-26 加的。原来账本只有 attempts，「配额挡两次 + thin 挡一次」和
  // 「同一道闸连挡三次」落进去是同一个 attempts: 3，于是「这批永久出局的条目
  // 主要死在哪道闸上」这个问题——也就是下次该调 cap 还是调配额的唯一依据——答不出来。
  const gates = ['quota', 'thin', 'cap'];
  let deferred = {};
  for (const gate of gates.slice(0, DEFER_ROUNDS - 1)) {
    const r = planSeen({ ids: ['b'], gatedIds: new Map([['b', gate]]), deferred, today: TODAY });
    deferred = r.deferred;
  }
  assert.deepEqual(deferred.b.gates, { quota: 1, thin: 1 });
  assert.equal(deferred.b.last, 'thin');

  const last = planSeen({ ids: ['b'], gatedIds: new Map([['b', 'cap']]), deferred, today: TODAY });
  assert.deepEqual(last.promoted, [{ id: 'b', gates: { quota: 1, thin: 1, cap: 1 } }]);
});

test('同一道闸连挡，计数累加在同一个键上', () => {
  let deferred = {};
  for (let round = 1; round < DEFER_ROUNDS; round += 1) {
    deferred = planSeen({ ids: ['b'], gatedIds: new Map([['b', 'quota']]), deferred, today: TODAY }).deferred;
  }
  assert.deepEqual(deferred.b.gates, { quota: DEFER_ROUNDS - 1 });
});

test('传 Set 仍然可用，只是记不出闸门', () => {
  // 向后兼容：老账本里的条目没有 gates 字段，不能因此崩掉或凭空造一个闸门出来。
  const r = planSeen({ ids: ['b'], gatedIds: new Set(['b']), deferred: {}, today: TODAY });
  assert.equal(r.deferred.b.attempts, 1);
  assert.equal(r.deferred.b.gates, undefined, '没有闸门信息时不要编一个');
});

test('triage 给每条名额落选标出是哪道闸', () => {
  const items = Array.from({ length: 40 }, (_, i) => item(i, '掘金搜索'));
  const { rejected } = triage(items, { cap: 60 });
  const gated = rejected.filter((r) => r.gated);
  assert.ok(gated.length > 0);
  for (const r of gated) {
    assert.ok(['quota', 'forum-share', 'cap', 'thin'].includes(r.gate), `未知闸门：${r.gate}`);
    // 机器读的 gate 和人读的 reasons 必须说同一件事，否则就是 2026-08-22 那一脚。
    if (r.gate === 'quota') assert.match(r.reasons.at(-1), /单源配额已满/);
    if (r.gate === 'cap') assert.match(r.reasons.at(-1), /超出当日入围上限/);
  }
  assert.ok(gated.some((r) => r.gate === 'quota'), '单源供给压倒性多时该由配额闸挡下');
});

test('中途排上队（不再 gated）就按结论记 seen', () => {
  const first = planSeen({ ids: ['b'], gatedIds: new Set(['b']), deferred: {}, today: TODAY });
  const second = planSeen({ ids: ['b'], gatedIds: new Set(), deferred: first.deferred, today: TODAY });
  assert.deepEqual(second.seenIds, ['b']);
  assert.equal(second.deferred.b, undefined);
});

test('这一轮没再出现的待定条目留在账本里，超过窗口才清', () => {
  const fresh = { x: { first: '2026-08-22', attempts: 1 } };
  const kept = planSeen({ ids: [], gatedIds: new Set(), deferred: fresh, today: TODAY });
  assert.equal(kept.deferred.x.attempts, 1, '源今天没返回它，不代表它排不上队');

  const old = { x: { first: '2026-07-01', attempts: 1 } };
  const dropped = planSeen({ ids: [], gatedIds: new Set(), deferred: old, today: TODAY });
  assert.equal(dropped.deferred.x, undefined, `超过 ${DEFER_TTL_DAYS} 天就清掉`);
  assert.deepEqual(dropped.seenIds, [], '清掉不等于记 seen——它根本没被抓到过第二次');
});
