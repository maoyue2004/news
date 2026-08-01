#!/usr/bin/env node
// 用 tinker/data/_raw.json 离线重放筛选规则，不联网、不写 seen。
// 改完 relevance.mjs 或 vocab.mjs 后跑它，看名单怎么变。
//   node scripts/tinker-retriage.mjs            列出入围名单
//   node scripts/tinker-retriage.mjs --rejected 列出被毙的高分条目（查误杀）
//   node scripts/tinker-retriage.mjs --write    把重筛结果覆盖回 _pending.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { triage } from '../lib/tinker/relevance.mjs';

const RAW = 'tinker/data/_raw.json';
const PENDING = 'tinker/data/_pending.json';

if (!existsSync(RAW)) {
  console.error(`没有 ${RAW}。先跑一次 npm run tinker:fetch。`);
  process.exit(1);
}

const { date, items } = JSON.parse(readFileSync(RAW, 'utf8'));
const { shortlist, rejected } = triage(items);
const flags = new Set(process.argv.slice(2));

const bySource = new Map();
for (const it of shortlist) bySource.set(it.source, (bySource.get(it.source) ?? 0) + 1);

console.log(`${date}：原始 ${items.length} 条 → 入围 ${shortlist.length} 条，筛掉 ${rejected.length} 条`);
console.log(`来源分布（${bySource.size} 个源）：${[...bySource].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join('、')}\n`);

if (flags.has('--rejected')) {
  console.log('=== 被毙掉但分数最高的 30 条（查误杀）===');
  for (const it of rejected.sort((a, b) => b.score - a.score).slice(0, 30)) {
    console.log(`${String(it.score).padStart(3)} | ${it.source.slice(0, 12).padEnd(12)} | ${it.title.slice(0, 48)}`);
    console.log(`      ${it.reasons.join('；').slice(0, 110)}`);
  }
} else {
  for (const it of shortlist) {
    console.log(`${String(it.preScore).padStart(3)} | ${it.source.slice(0, 12).padEnd(12)} | ${it.titleOriginal.slice(0, 54)}`);
    if (flags.has('--why')) console.log(`      ${it.preReasons.join('；').slice(0, 120)}`);
  }
}

if (flags.has('--write')) {
  const pending = JSON.parse(readFileSync(PENDING, 'utf8'));
  pending.shortlist = shortlist;
  pending.rejected = rejected;
  pending.stats = { ...pending.stats, shortlisted: shortlist.length, rejected: rejected.length };
  writeFileSync(PENDING, JSON.stringify(pending, null, 2) + '\n');
  console.log(`\n已把重筛结果写回 ${PENDING}`);
}
