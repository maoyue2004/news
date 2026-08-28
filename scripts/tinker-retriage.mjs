#!/usr/bin/env node
// 用 tinker/data/_raw.json 离线重放筛选规则，不联网、不写 seen。
// 改完 relevance.mjs 或 vocab.mjs 后跑它，看名单怎么变。
//   node scripts/tinker-retriage.mjs            列出入围名单
//   node scripts/tinker-retriage.mjs --rejected 列出被毙的高分条目（查误杀）
//   node scripts/tinker-retriage.mjs --write    把重筛结果覆盖回 _pending.json
//   node scripts/tinker-retriage.mjs --probe '欢迎\s*star'   量一个候选词表条目
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { triage, titleKey } from '../lib/tinker/relevance.mjs';

const RAW = 'tinker/data/_raw.json';
const PENDING = 'tinker/data/_pending.json';
const DATA_DIR = 'tinker/data';

/**
 * `--probe <正则>`：给「要不要把这个词加进词表」这个问题一份数据。
 *
 * LESSONS 定的规矩是「加词前先量唯一命中数和误伤」，但一直没有工具，
 * 于是每次都手写一段一次性脚本——2026-08-21 那次就手写错了：
 * 拿 `excerpt` 当语料量「结尾挂仓库链接」这个形状，得到 0 误伤，
 * 换成 `tail` 才看见误伤的是当天的 5 分精选。
 * 原因就是 08-20 记下的那条：**excerpt 截在 2500 字符，被截掉的那一半正好是结尾**，
 * 拿它量结尾判据等于把误伤藏起来。
 *
 * 所以这里把三个取样口径分开报，并且自动拿已发布的日文件对一遍——
 * 命中里只要有已收录条目，就是误伤，不用自己去比对。
 */
function probe(pattern, items) {
  const re = new RegExp(pattern, 'i');
  const published = new Map();
  for (const f of readdirSync(DATA_DIR).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))) {
    for (const it of JSON.parse(readFileSync(`${DATA_DIR}/${f}`, 'utf8')).items ?? []) {
      published.set(it.url, `${it.rating} 分 ${f.slice(0, 10)}`);
    }
  }
  const scopes = {
    '标题+开头 400': (it) => `${it.titleOriginal ?? ''}\n${(it.excerpt ?? '').slice(0, 400)}`,
    '真结尾 tail': (it) => it.tail ?? '',
    '全文 excerpt': (it) => it.excerpt ?? '',
  };
  const haveTail = items.filter((it) => it.tail).length;
  console.log(`\n=== 量 /${pattern}/ ===（语料 ${items.length} 条，其中带真结尾的 ${haveTail} 条）`);
  for (const [name, pick] of Object.entries(scopes)) {
    const pool = name === '真结尾 tail' ? items.filter((it) => it.tail) : items;
    const hits = pool.filter((it) => re.test(pick(it)));
    const bad = hits.filter((it) => published.has(it.url));
    console.log(`${name.padEnd(14)} 命中 ${String(hits.length).padStart(3)} / ${String(pool.length).padStart(3)}`
      + `，其中已收录条目 ${bad.length} 条${bad.length ? '  ← 误伤' : ''}`);
    for (const it of hits.slice(0, 12)) {
      const tag = published.get(it.url);
      console.log(`    ${tag ? `★${tag}` : '      '}  ${(it.titleOriginal ?? '').slice(0, 52)}`);
    }
    if (hits.length > 12) console.log(`    …… 另有 ${hits.length - 12} 条`);
  }
  console.log('\n判据（LESSONS）：逐条看完命中、0 误伤、样本量够，三条都成立才加。');
}

if (!existsSync(RAW)) {
  console.error(`没有 ${RAW}。先跑一次 npm run tinker:fetch。`);
  process.exit(1);
}

const { date, items } = JSON.parse(readFileSync(RAW, 'utf8'));
const argv = process.argv.slice(2);
const probeAt = argv.indexOf('--probe');
if (probeAt !== -1) {
  const pattern = argv[probeAt + 1];
  if (!pattern) {
    console.error("用法：node scripts/tinker-retriage.mjs --probe '欢迎\\s*star'");
    process.exit(1);
  }
  probe(pattern, items);
  process.exit(0);
}

/**
 * 已收录条目的标题集合，和 `tinker-fetch` 用同一份口径。
 *
 * 2026-08-29 补的：这个脚本原来直接 `triage(items)`，不传 `publishedTitles`，
 * 于是它给出的名单和管线真正会产出的名单**不是同一份**——当天离线重放时
 * atbug 那篇《Docker Sandboxes 的隔离例外》堂堂正正出现在名单里，
 * 而它 08-21 就已经从 SegmentFault 收过、还是当天的 5 分精选，
 * 管线里被「严格同题」那道闸挡得好好的。差点照着这份名单把它再发一次。
 *
 * 形状是 LESSONS 那条「选源判据要用系统自己的评分器」「量别名要用系统自己的
 * 匹配器」的第三次复发，只是这次犯规的是**诊断工具**而不是判据：
 * 一个和管线口径不一致的离线工具，报出来的差异有一部分是它自己造的。
 */
function loadPublishedTitles() {
  const titles = new Set();
  for (const name of readdirSync(DATA_DIR)) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
    try {
      for (const item of JSON.parse(readFileSync(`${DATA_DIR}/${name}`, 'utf8')).items ?? []) {
        titles.add(titleKey(item.titleOriginal));
      }
    } catch { /* 半截文件不该拖垮离线重放 */ }
  }
  titles.delete('');
  return titles;
}

const { shortlist, rejected } = triage(items, { publishedTitles: loadPublishedTitles() });
const flags = new Set(argv);

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
