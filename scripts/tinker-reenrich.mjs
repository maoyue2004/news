#!/usr/bin/env node
/**
 * 错时补全。用法（在日更那一轮跑完、隔上几十分钟之后）：
 *
 *   node scripts/tinker-reenrich.mjs              # 只看结果，不写盘
 *   node scripts/tinker-reenrich.mjs --write      # 把救回的正文写回 _raw / _pending
 *   node scripts/tinker-reenrich.mjs --source 掘金搜索 --limit 40
 *
 * 判据和边界写在 `lib/tinker/reenrich.mjs` 的头注释里。一句话：
 * 抓取那一轮的两次补全隔 60 秒，落在同一个限流窗口里；这一步把「再要一次」
 * 挪到几十分钟以后，别的什么都不改。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { enrich } from './tinker-fetch.mjs';
import { selectTargets, mergeIntoShortlist } from '../lib/tinker/reenrich.mjs';

const DATA_DIR = 'tinker/data';
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const WRITE = argv.includes('--write');
const LIMIT = Number(flag('limit', 80));

const rawPath = `${DATA_DIR}/_raw.json`;
const pendingPath = `${DATA_DIR}/_pending.json`;
if (!existsSync(rawPath) || !existsSync(pendingPath)) {
  console.error('缺 _raw.json 或 _pending.json——错时补全要在当轮抓取之后跑。');
  process.exit(1);
}
const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
const pending = JSON.parse(readFileSync(pendingPath, 'utf8'));

const only = flag('source');
const sources = only ? [only] : (pending.stats?.enrichMuted ?? []);
if (!sources.length) {
  console.log('本轮没有源被补全熔断，不用错时补全。');
  process.exit(0);
}

const shortlistIds = (pending.shortlist ?? []).map((it) => it.id);
const targets = selectTargets({ items: raw.items, sources, limit: LIMIT, priorityIds: shortlistIds });
const inList = targets.filter((it) => shortlistIds.includes(it.id)).length;
console.log(`错时补全：${sources.join('、')}，thin 条目 ${targets.length} 条（其中入围名单 ${inList} 条，预算上限 ${LIMIT}）`);
if (!targets.length) process.exit(0);

// 这里刻意复用 enrich()：探针熔断、第二轮减半并发这些边界只该有一份实现。
const stats = await enrich(targets, { log: (m) => console.log(m) });
const recovered = targets.filter((it) => !it.thin);
console.log(`尝试 ${stats.attempted}，救回 ${recovered.length} 条（第二轮重试 ${stats.retryAttempted} 条，救回 ${stats.retried}）`);

const inShortlist = new Set((pending.shortlist ?? []).map((it) => it.id));
for (const it of recovered) {
  console.log(`  ${inShortlist.has(it.id) ? '[入围]' : '[被名额挡下]'} ${it.excerpt.length} 字 | ${it.titleOriginal}`);
  console.log(`         ${it.url}`);
}

if (!WRITE) {
  console.log('\n（没有 --write，什么都没写盘）');
  process.exit(0);
}

const byId = new Map(recovered.map((it) => [it.id, it]));
for (const it of raw.items) {
  const fresh = byId.get(it.id);
  if (!fresh) continue;
  it.excerpt = fresh.excerpt;
  if (fresh.tail) it.tail = fresh.tail; else delete it.tail;
  it.thin = false;
}
writeFileSync(rawPath, JSON.stringify(raw, null, 2) + '\n');

const updated = mergeIntoShortlist(pending.shortlist ?? [], recovered);
if (updated.length) {
  pending.stats = { ...pending.stats, reenriched: recovered.length, reenrichedShortlist: updated.length };
  writeFileSync(pendingPath, JSON.stringify(pending, null, 2) + '\n');
}
console.log(`已写回 _raw.json（${recovered.length} 条），入围名单更新 ${updated.length} 条。`);
