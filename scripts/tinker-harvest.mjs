#!/usr/bin/env node
/**
 * 从中文独立博客索引里批量筛选值得订阅的博客。
 *
 * 为什么需要它：用搜索引擎找个人博客几乎无效，搜出来的全是 CSDN / 知乎这类
 * SEO 平台页。中文独立博客的真实分布在社区维护的索引里
 * （timqian/chinese-independent-blogs 收了 1400+ 个，且都带 RSS 地址）。
 *
 * 但也不能整个灌进来——绝大多数博客一辈子不会写 agent。
 * 所以这里做的是**用数据选源**：把候选的 feed 全抓一遍，只留下
 *   1) 最近 N 天有更新（活着）
 *   2) 近期文章里真的命中 agent 词表（写这个主题）
 * 两个条件同时满足的。这比人工猜哪个博主可能写 agent 靠谱得多。
 *
 * 用法：
 *   node scripts/tinker-harvest.mjs                    # 跑一遍，打印候选
 *   node scripts/tinker-harvest.mjs --merge            # 直接并入 tinker/sources.json
 *   node scripts/tinker-harvest.mjs --days 180         # 放宽活跃度门槛
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseFeed } from '../lib/feed-parse.mjs';
import { htmlToText } from '../lib/html-text.mjs';
import { matchVocab, SOFT_TERMS } from '../lib/tinker/vocab.mjs';
import { UA, BROWSER_UA } from '../lib/tinker/probe.mjs';

const INDEX_URL = 'https://raw.githubusercontent.com/timqian/chinese-independent-blogs/master/blogs-original.csv';
const SOURCES = 'tinker/sources.json';
const CONCURRENCY = 20;
const TIMEOUT_MS = 12000;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const ACTIVE_DAYS = Number(flag('days', 120));
/** 命中门槛。1-2 篇往往是顺带提一句，3 篇起才说明这个博主真的在写这个主题。 */
const MIN_HITS = Number(flag('min-hits', 3));
const MERGE = args.includes('--merge');

/** 只看技术向的标签，「摄影」「生活」这类整片跳过，省掉大半抓取量。 */
const TECH_TAGS = /编程|技术|开发|前端|后端|运维|开源|AI|机器学习|数据|算法|安全|效率|工具|极客|Linux|云计算|架构/i;

function parseCsv(text) {
  const rows = [];
  for (const line of text.split('\n').slice(1)) {
    // 这个 CSV 的字段里不含逗号引号转义，简单切分即可；多切出来的并回 tags。
    const parts = line.split(',').map((s) => s.trim());
    if (parts.length < 3) continue;
    const [name, url, feed, ...rest] = parts;
    if (!feed?.startsWith('http')) continue;
    rows.push({ name, url, feed, tags: rest.join(',') });
  }
  return rows;
}

async function get(url, ua) {
  const res = await fetch(url, {
    headers: { 'user-agent': ua, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

/**
 * 判断一个博客值不值得订阅。
 * agent 相关性看的是**最近 20 篇的标题加正文**：偶尔提一句不算，
 * 要有多篇命中才说明这个博主真的在写这个主题。
 */
function evaluate(xml) {
  const { items = [] } = parseFeed(xml);
  if (!items.length) return { ok: false, why: '0 条' };

  const dated = items.map((it) => Date.parse(it.publishedAt)).filter((n) => !Number.isNaN(n));
  const latest = dated.length ? Math.max(...dated) : null;
  const ageDays = latest ? Math.round((Date.now() - latest) / 86400000) : null;
  if (ageDays === null) return { ok: false, why: '无日期' };
  if (ageDays > ACTIVE_DAYS) return { ok: false, why: `${ageDays} 天没更新` };

  let hitPosts = 0;
  const tools = new Set();
  for (const it of items.slice(0, 20)) {
    const text = `${it.title ?? ''}\n${htmlToText(it.contentHtml ?? '', 3000)}`;
    const v = matchVocab(text);
    const t = [...v.tools, ...v.topics];
    const soft = SOFT_TERMS.some((s) => text.toLowerCase().includes(s));
    if (t.length || soft) {
      hitPosts += 1;
      for (const id of t) tools.add(id);
    }
  }
  if (hitPosts < MIN_HITS) return { ok: false, why: `只有 ${hitPosts} 篇写到 agent`, ageDays };
  return { ok: true, ageDays, count: items.length, hitPosts, tools: [...tools] };
}

const csv = await (await fetch(INDEX_URL, { headers: { 'user-agent': UA } })).text();
const all = parseCsv(csv);
const candidates = all.filter((r) => TECH_TAGS.test(r.tags));
console.error(`索引共 ${all.length} 个博客，技术向 ${candidates.length} 个，开始抓 feed…`);

const current = JSON.parse(readFileSync(SOURCES, 'utf8'));
const existing = new Set(current.map((s) => s.feed).filter(Boolean));
/** 同一个博客常有多个 feed 地址（/feed.xml 和 /zh/index.xml），按域名再去一次重。 */
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const existingHosts = new Set(current.filter((s) => s.url).map((s) => host(s.url)));
const results = [];
for (let i = 0; i < candidates.length; i += CONCURRENCY) {
  await Promise.all(candidates.slice(i, i + CONCURRENCY).map(async (row) => {
    if (existing.has(row.feed) || existingHosts.has(host(row.url))) return;
    let xml;
    try {
      xml = await get(row.feed, UA);
    } catch (err) {
      if (!/HTTP (403|429)/.test(err.message)) return;
      try { xml = await get(row.feed, BROWSER_UA); } catch { return; }
    }
    try {
      const verdict = evaluate(xml);
      if (verdict.ok) results.push({ ...row, ...verdict });
    } catch {
      // feed 解析失败的直接丢掉，不值得为一个坏 feed 中断整轮
    }
  }));
  console.error(`  ${Math.min(i + CONCURRENCY, candidates.length)}/${candidates.length}`);
}

results.sort((a, b) => b.hitPosts - a.hitPosts || a.ageDays - b.ageDays);
console.log(`\n=== 命中 ${results.length} 个：近 20 篇里 ≥${MIN_HITS} 篇写到 agent，且 ${ACTIVE_DAYS} 天内活跃 ===`);
for (const r of results) {
  console.log(`${String(r.hitPosts).padStart(2)}/20 篇 | ${String(r.ageDays).padStart(3)}天前 | ${r.name.slice(0, 16).padEnd(16)} | ${r.feed}`);
  if (r.tools.length) console.log(`         工具：${r.tools.join(', ')}`);
}

if (MERGE) {
  const sources = JSON.parse(readFileSync(SOURCES, 'utf8'));
  for (const r of results) {
    sources.push({
      name: r.name, url: r.url, feed: r.feed, kind: 'blog', enabled: true,
      desc: `中文独立博客，近 20 篇里有 ${r.hitPosts} 篇写到 agent${r.tools.length ? `（${r.tools.slice(0, 4).join('/')}）` : ''}。`,
    });
  }
  writeFileSync(SOURCES, JSON.stringify(sources, null, 2) + '\n');
  console.log(`\n已并入 ${SOURCES}，现共 ${sources.length} 个源`);
}
