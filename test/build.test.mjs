import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHtml } from '../scripts/build.mjs';

function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'news-build-'));
  const data = join(root, 'data');
  mkdirSync(data, { recursive: true });
  writeFileSync(join(root, 'sources.json'), JSON.stringify([
    { name: 'A', url: 'https://a.com/', feed: 'https://a.com/feed', type: 'blog', lang: 'en', enabled: true, desc: 'd' },
  ]));
  writeFileSync(join(data, 'status.json'), JSON.stringify({ A: { lastSuccess: '2026-07-27T00:00:00.000Z', lastError: null, lastErrorMessage: null, consecutiveFailures: 0 } }));
  writeFileSync(join(data, '2026-07-27.json'), JSON.stringify({
    date: '2026-07-27', generatedAt: '2026-07-27T00:00:00.000Z',
    items: [{ id: 'x1', source: 'A', type: 'blog', lang: 'en', url: 'https://a.com/1', titleOriginal: 'T', titleZh: '标题', summaryZh: '摘要', publishedAt: '2026-07-27T00:00:00.000Z', brief: false }],
    errors: [],
  }));
  writeFileSync(join(data, '2026-01-01.json'), JSON.stringify({ date: '2026-01-01', items: [], errors: [] }));
  return root;
}

test('构建产出 dist/index.html', () => {
  const root = fixtureRepo();
  buildHtml({ root, today: '2026-07-27' });
  assert.ok(existsSync(join(root, 'dist', 'index.html')));
});

test('产出的页面内嵌了当天数据', () => {
  const root = fixtureRepo();
  buildHtml({ root, today: '2026-07-27' });
  const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
  const m = html.match(/<script type="application\/json" id="reader-data">([\s\S]*?)<\/script>/);
  const data = JSON.parse(m[1]);
  assert.equal(data.days.length, 1);
  assert.equal(data.days[0].items[0].titleZh, '标题');
  assert.equal(data.sources.length, 1);
  assert.equal(data.status.A.consecutiveFailures, 0);
});

test('构建时裁掉超过 35 天的日文件', () => {
  const root = fixtureRepo();
  buildHtml({ root, today: '2026-07-27' });
  assert.equal(existsSync(join(root, 'data', '2026-01-01.json')), false);
  assert.equal(existsSync(join(root, 'data', '2026-07-27.json')), true);
});

test('【修复】日文件里的条目缺字段时构建抛错，而不是静默产出残页', () => {
  const root = fixtureRepo();
  writeFileSync(join(root, 'data', '2026-07-27.json'), JSON.stringify({
    date: '2026-07-27', generatedAt: '2026-07-27T00:00:00.000Z',
    items: [{ id: 'x1', source: 'A', type: 'blog', url: 'https://a.com/1', titleOriginal: 'T', titleZh: '标题', summaryZh: '摘要', publishedAt: '2026-07-27T00:00:00.000Z', brief: false }],
    errors: [],
  }));
  assert.throws(() => buildHtml({ root, today: '2026-07-27' }), /2026-07-27/);
});

test('构建返回摘要信息供日志使用', () => {
  const root = fixtureRepo();
  const res = buildHtml({ root, today: '2026-07-27' });
  assert.equal(res.dayCount, 1);
  assert.equal(res.itemCount, 1);
  assert.ok(res.bytes > 0);
});
