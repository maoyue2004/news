import test from 'node:test';
import assert from 'node:assert/strict';
import { dateInShanghai, filterByPublishedDates } from '../scripts/fetch.mjs';

test('定向补抓按北京时间的发布时间归日', () => {
  const items = [
    { title: 'before midnight UTC', publishedAt: '2026-07-31T15:59:59Z' },
    { title: 'after midnight Shanghai', publishedAt: '2026-07-31T16:00:00Z' },
    { title: 'missing date', publishedAt: null },
  ];
  assert.equal(dateInShanghai(items[0].publishedAt), '2026-07-31');
  assert.equal(dateInShanghai(items[1].publishedAt), '2026-08-01');
  assert.deepEqual(
    filterByPublishedDates(items, new Set(['2026-08-01']), '2026-08-01').map((item) => item.title),
    ['after midnight Shanghai', 'missing date'],
  );
});
