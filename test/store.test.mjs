import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadSeen, saveSeen, loadStatus, saveStatus,
  recordSuccess, recordFailure,
  saveDay, loadRecentDays, pruneDayFiles,
} from '../lib/store.mjs';

function tmp() {
  return mkdtempSync(join(tmpdir(), 'news-store-'));
}

test('seen 文件不存在时返回空对象', () => {
  assert.deepEqual(loadSeen(tmp()), {});
});

test('seen 写入后能读回', () => {
  const d = tmp();
  saveSeen(d, { abc: '2026-07-27' }, '2026-07-27');
  assert.deepEqual(loadSeen(d), { abc: '2026-07-27' });
});

test('seen 裁掉超过 45 天的条目', () => {
  const d = tmp();
  saveSeen(d, { old: '2026-01-01', fresh: '2026-07-20' }, '2026-07-27');
  const got = loadSeen(d);
  assert.equal('old' in got, false);
  assert.equal(got.fresh, '2026-07-20');
});

test('seen 保留刚好 45 天前的条目', () => {
  const d = tmp();
  saveSeen(d, { edge: '2026-06-12' }, '2026-07-27'); // 相隔 45 天
  assert.ok('edge' in loadSeen(d));
});

test('status 记录成功会清零连续失败次数', () => {
  const status = { A: { lastSuccess: null, lastError: '2026-07-26T00:00:00.000Z', lastErrorMessage: 'boom', consecutiveFailures: 3 } };
  recordSuccess(status, 'A', '2026-07-27T00:00:00.000Z');
  assert.equal(status.A.consecutiveFailures, 0);
  assert.equal(status.A.lastSuccess, '2026-07-27T00:00:00.000Z');
});

test('status 记录失败会累加连续失败次数', () => {
  const status = {};
  recordFailure(status, 'B', '2026-07-27T00:00:00.000Z', 'HTTP 503');
  recordFailure(status, 'B', '2026-07-28T00:00:00.000Z', 'HTTP 503');
  assert.equal(status.B.consecutiveFailures, 2);
  assert.equal(status.B.lastErrorMessage, 'HTTP 503');
  assert.equal(status.B.lastSuccess, null);
});

test('status 写入后能读回', () => {
  const d = tmp();
  const status = {};
  recordSuccess(status, 'A', '2026-07-27T00:00:00.000Z');
  saveStatus(d, status);
  assert.equal(loadStatus(d).A.consecutiveFailures, 0);
});

test('saveDay 与 loadRecentDays 按日期倒序返回', () => {
  const d = tmp();
  saveDay(d, '2026-07-25', { date: '2026-07-25', items: [], errors: [] });
  saveDay(d, '2026-07-27', { date: '2026-07-27', items: [], errors: [] });
  const days = loadRecentDays(d, '2026-07-27', 30);
  assert.deepEqual(days.map((x) => x.date), ['2026-07-27', '2026-07-25']);
});

test('loadRecentDays 只看窗口内的日期', () => {
  const d = tmp();
  saveDay(d, '2026-07-27', { date: '2026-07-27', items: [], errors: [] });
  saveDay(d, '2026-05-01', { date: '2026-05-01', items: [], errors: [] });
  const days = loadRecentDays(d, '2026-07-27', 30);
  assert.deepEqual(days.map((x) => x.date), ['2026-07-27']);
});

test('pruneDayFiles 删掉窗口外的日文件并返回文件名', () => {
  const d = tmp();
  saveDay(d, '2026-07-27', { date: '2026-07-27', items: [], errors: [] });
  saveDay(d, '2026-05-01', { date: '2026-05-01', items: [], errors: [] });
  const removed = pruneDayFiles(d, '2026-07-27', 35);
  assert.deepEqual(removed, ['2026-05-01.json']);
  assert.equal(existsSync(join(d, '2026-05-01.json')), false);
  assert.equal(existsSync(join(d, '2026-07-27.json')), true);
});

test('pruneDayFiles 不碰 seen.json 和 status.json', () => {
  const d = tmp();
  writeFileSync(join(d, 'seen.json'), '{}');
  writeFileSync(join(d, 'status.json'), '{}');
  pruneDayFiles(d, '2026-07-27', 35);
  assert.equal(existsSync(join(d, 'seen.json')), true);
  assert.equal(existsSync(join(d, 'status.json')), true);
});
