import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishedAuthors } from '../scripts/tinker-authorsites.mjs';

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
