import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishedAuthors, needsQuery, ledgerEntry, MAX_LOOKUP_ATTEMPTS } from '../scripts/tinker-authorsites.mjs';

/** 造一份只有两天的日文件目录，避免测试跟着真实 tinker/data 一起变。 */
function fixture(days) {
  const dir = mkdtempSync(join(tmpdir(), 'authorsites-'));
  for (const [date, items] of Object.entries(days)) {
    writeFileSync(join(dir, `${date}.json`), JSON.stringify({ date, items }));
  }
  // 非日期文件（_pending / seen 这些）不能被当成日文件读进来。
  writeFileSync(join(dir, '_pending.json'), JSON.stringify({ shortlist: [] }));
  return dir;
}

test('按平台和作者归并，同一个人的多篇合成一条', () => {
  const dir = fixture({
    '2026-08-01': [
      { url: 'https://juejin.cn/post/1', author: '甲', titleOriginal: '甲的第一篇' },
      { url: 'https://www.v2ex.com/t/9', author: 'lee', titleOriginal: '论坛帖' },
    ],
    '2026-08-02': [
      { url: 'https://juejin.cn/post/2', author: '甲', titleOriginal: '甲的第二篇' },
    ],
  });
  const rows = publishedAuthors(dir);
  assert.equal(rows.length, 2);
  const jia = rows.find((r) => r.author === '甲');
  assert.equal(jia.platform, 'juejin');
  assert.deepEqual(jia.titles, ['甲的第一篇', '甲的第二篇']);
  // firstSeen 记的是第一次出现的那天，账本靠它说明这条是从哪天的收录来的。
  assert.equal(jia.firstSeen, '2026-08-01');
  assert.equal(rows.find((r) => r.author === 'lee').platform, 'v2ex');
});

const 甲 = { platform: 'juejin', author: '甲', firstSeen: '2026-08-01' };

test('网络类失败一个字都不写账本，下轮重查', () => {
  assert.equal(ledgerEntry(甲, { failed: 'profile 接口请求失败' }, undefined), null);
  // 而失败之后账本里没有这一条，所以下一轮还会查。
  assert.equal(needsQuery(undefined), true);
});

test('查到结论（有站 / 明确没有站）就落账，不再重查', () => {
  const hit = ledgerEntry(甲, { site: 'https://example.com', github: 'jia' }, undefined);
  assert.equal(hit.site, 'https://example.com');
  assert.equal(hit.checkedFrom, '2026-08-01');
  assert.equal(needsQuery(hit), false);
  // 404 是答案不是失败：用户名查不到人，照常落账。
  const gone = ledgerEntry(甲, { site: null, note: 'members/show 404（用户名查不到人）' }, undefined);
  assert.equal(gone.pending, undefined);
  assert.equal(needsQuery(gone), false);
});

test('反查不到 user_id 先挂 pending，攒够轮次才落成结论', () => {
  const miss = { site: null, pending: true, note: '搜索接口反查不到 user_id' };
  let entry;
  for (let i = 1; i < MAX_LOOKUP_ATTEMPTS; i += 1) {
    entry = ledgerEntry(甲, miss, entry);
    assert.equal(entry.attempts, i);
    assert.equal(entry.pending, true, `第 ${i} 轮应仍然可重查`);
    assert.equal(needsQuery(entry), true);
  }
  entry = ledgerEntry(甲, miss, entry);
  assert.equal(entry.attempts, MAX_LOOKUP_ATTEMPTS);
  assert.equal(entry.pending, undefined);
  assert.match(entry.note, /连续 3 轮/);
  assert.equal(needsQuery(entry), false);
});

test('没有 profile 接口的平台和缺作者名的条目一律跳过，不进账本', () => {
  const dir = fixture({
    '2026-08-03': [
      { url: 'https://www.cnblogs.com/x/p/1', author: '博客园作者', titleOriginal: 'A' },
      { url: 'https://segmentfault.com/a/1', author: 'sf', titleOriginal: 'B' },
      { url: 'https://juejin.cn/post/3', author: '', titleOriginal: '匿名条目' },
      { url: 'https://juejin.cn/post/4', titleOriginal: '没有 author 字段' },
    ],
  });
  assert.deepEqual(publishedAuthors(dir), []);
});
