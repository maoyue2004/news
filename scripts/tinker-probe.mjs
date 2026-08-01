#!/usr/bin/env node
// 探测候选站点的 feed 地址。用法：
//   node scripts/tinker-probe.mjs https://a.com https://b.com
//   node scripts/tinker-probe.mjs --file candidates.txt
//   node scripts/tinker-probe.mjs --json            （探测 tinker/candidates.json 里 status=new 的项）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { probeSite } from '../lib/tinker/probe.mjs';

const CANDIDATES = 'tinker/candidates.json';
const CONCURRENCY = 6;

function urlsFromArgs(argv) {
  if (argv[0] === '--file') return readFileSync(argv[1], 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  if (argv[0] === '--json') {
    if (!existsSync(CANDIDATES)) return [];
    return JSON.parse(readFileSync(CANDIDATES, 'utf8')).filter((c) => c.status === 'new').map((c) => c.url);
  }
  return argv.filter(Boolean);
}

async function mapConcurrent(values, n, fn) {
  const out = [];
  for (let i = 0; i < values.length; i += n) {
    out.push(...(await Promise.all(values.slice(i, i + n).map(fn))));
    console.error(`已探测 ${Math.min(i + n, values.length)}/${values.length}`);
  }
  return out;
}

const urls = urlsFromArgs(process.argv.slice(2));
if (!urls.length) {
  console.error('用法：node scripts/tinker-probe.mjs <url...> | --file <path> | --json');
  process.exit(1);
}

const results = await mapConcurrent(urls, CONCURRENCY, probeSite);
const found = results.filter((r) => r.feed);
const missing = results.filter((r) => !r.feed);

console.log(`\n=== 找到 feed：${found.length}/${results.length} ===`);
for (const r of found.sort((a, b) => (a.ageDays ?? 9999) - (b.ageDays ?? 9999))) {
  const fresh = r.ageDays === null ? '无日期' : `${r.ageDays}天前`;
  console.log(`${fresh.padStart(7)} | ${String(r.count).padStart(3)}条 | 正文${(r.bodyRatio * 100).toFixed(0).padStart(3)}% | ${r.feed}`);
}

console.log(`\n=== 没找到 feed：${missing.length} ===`);
for (const r of missing) {
  const why = r.tried.slice(0, 2).map((t) => t.error).join(' / ');
  console.log(`${r.site}  —  ${why}`);
}

// 结构化结果落盘，供后续把成功项并入 sources.json。
writeFileSync('/tmp/tinker-probe.json', JSON.stringify(results, null, 2));
console.log('\n完整结果：/tmp/tinker-probe.json');
