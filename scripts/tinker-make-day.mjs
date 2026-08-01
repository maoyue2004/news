#!/usr/bin/env node
// 一次性辅助脚本：把编辑决定（index -> 评语）套用到 _pending.json 的入围名单上，
// 生成 tinker/data/<date>.json。日常由 routine 里的 LLM 直接写日文件，这个脚本
// 只在本地手工评审时用来省掉重复抄 id / url / publishedAt 的工作。
import { readFileSync } from 'node:fs';
import { saveDay } from '../lib/store.mjs';

const DATA_DIR = 'tinker/data';
const pending = JSON.parse(readFileSync(`${DATA_DIR}/_pending.json`, 'utf8'));
const decisions = JSON.parse(readFileSync(process.argv[2], 'utf8'));

const items = [];
for (const [key, d] of Object.entries(decisions.picks)) {
  const src = pending.shortlist[Number(key)];
  if (!src) throw new Error(`入围名单里没有第 ${key} 条`);
  if (d.drop) continue;
  items.push({
    id: src.id,
    source: src.source,
    kind: src.kind,
    url: src.url,
    titleOriginal: src.titleOriginal,
    titleZh: d.titleZh ?? src.titleOriginal,
    summaryZh: d.summaryZh,
    whyRead: d.whyRead,
    rating: d.rating,
    tools: d.tools ?? src.tools,
    publishedAt: src.publishedAt,
    ...(src.author ? { author: src.author } : {}),
    ...(src.thin ? { thin: true } : {}),
    preScore: src.preScore,
  });
}
items.sort((a, b) => b.rating - a.rating || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

saveDay(DATA_DIR, pending.date, {
  date: pending.date,
  generatedAt: new Date().toISOString(),
  dailyNote: decisions.dailyNote,
  items,
  reviewed: pending.shortlist.length,
  dropped: pending.shortlist.length - items.length,
  stats: pending.stats,
  errors: pending.errors,
});
console.log(`已写 ${DATA_DIR}/${pending.date}.json：评审 ${pending.shortlist.length} 条，收录 ${items.length} 条`);
