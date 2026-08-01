#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { extractArticleText } from '../lib/enrich.mjs';
import { loadSeen, saveSeen, loadStatus, saveStatus, recordSuccess, recordFailure } from '../lib/store.mjs';
import { collectFeed, collectRaw } from '../lib/tinker/collect.mjs';
import { fetchSearchItems, isSearchSource } from '../lib/tinker/search-adapters.mjs';
import { triage } from '../lib/tinker/relevance.mjs';
import { queriesForDate } from '../lib/tinker/vocab.mjs';
import { UA, BROWSER_UA } from '../lib/tinker/probe.mjs';

const SOURCES = 'tinker/sources.json';
const DATA_DIR = 'tinker/data';
const TIMEOUT_MS = 20000;
const CONCURRENCY = Number(process.env.TINKER_CONCURRENCY ?? 6);
const ENRICH_CONCURRENCY = 5;
const QUERIES_PER_DAY = Number(process.env.TINKER_QUERIES ?? 12);
const THIN_THRESHOLD = 250;
const EXCERPT_CHARS = 2500;
/** LLM 环节一次能认真读完的上限。超过这个数，质量判断会退化成走过场。 */
const SHORTLIST_CAP = Number(process.env.TINKER_SHORTLIST_CAP ?? 60);

function todayInShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function daysAgo(date, n) {
  return new Date(Date.parse(`${date}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
}

async function get(url, { ua = UA, accept = '*/*', timeout = TIMEOUT_MS } = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': ua, accept },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

/**
 * 正文补全。规则筛选看的是标题 + 摘要，feed 只给标题时几乎必然误判，
 * 所以这一步要在 triage **之前**做，而不是像信源罗盘那样只为写摘要服务。
 */
async function enrich(items) {
  const targets = items.filter((it) => it.excerpt.length < THIN_THRESHOLD);
  let ok = 0;
  for (let i = 0; i < targets.length; i += ENRICH_CONCURRENCY) {
    await Promise.all(targets.slice(i, i + ENRICH_CONCURRENCY).map(async (item) => {
      const before = item.excerpt.length;
      try {
        const html = await get(item.url, { ua: BROWSER_UA, accept: 'text/html,*/*' });
        const text = extractArticleText(html, EXCERPT_CHARS);
        if (text.length >= THIN_THRESHOLD && text.length >= before * 2) {
          item.excerpt = text;
          ok += 1;
        }
      } catch {
        // 抓不到原文页很常见（反爬、超时、登录墙）。保留 feed 给的摘要继续走，
        // 绝不因为补全失败就丢掉条目。
      }
    }));
  }
  for (const it of items) it.thin = it.excerpt.length < THIN_THRESHOLD;
  return { attempted: targets.length, enriched: ok };
}

async function main() {
  const all = JSON.parse(readFileSync(SOURCES, 'utf8'));
  const sources = all.filter((s) => s.enabled);
  const today = todayInShanghai();
  const now = new Date().toISOString();
  const seen = loadSeen(DATA_DIR);
  const status = loadStatus(DATA_DIR);
  const queries = queriesForDate(today, QUERIES_PER_DAY);

  const items = [];
  const errors = [];
  const perSource = {};

  for (let i = 0; i < sources.length; i += CONCURRENCY) {
    await Promise.all(sources.slice(i, i + CONCURRENCY).map(async (source) => {
      try {
        let got;
        if (isSearchSource(source)) {
          const { items: raw, failures } = await fetchSearchItems({
            source, queries, ua: BROWSER_UA, afterDate: daysAgo(today, 21),
          });
          got = collectRaw({ source, raw, seen, today, now });
          if (failures.length) errors.push({ source: source.name, message: `部分查询失败（${failures.length}/${queries.length}）`, partial: true });
        } else {
          const xml = await get(source.feed, {
            ua: source.browserUa ? BROWSER_UA : UA,
            accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
          });
          got = collectFeed({ source, xml, seen, today, now });
        }
        items.push(...got);
        perSource[source.name] = got.length;
        recordSuccess(status, source.name, now);
      } catch (err) {
        errors.push({ source: source.name, message: err.message });
        recordFailure(status, source.name, now, err.message);
      }
    }));
    console.error(`已抓取 ${Math.min(i + CONCURRENCY, sources.length)}/${sources.length}`);
  }

  // 同一篇文章会同时出现在博客 feed 和掘金搜索里。itemId 基于归一化 URL，
  // 跨源天然去重；这里只需处理同一次运行内的碰撞。
  const byId = new Map();
  for (const it of items) if (!byId.has(it.id)) byId.set(it.id, it);
  const unique = [...byId.values()];

  const { attempted, enriched } = await enrich(unique);

  mkdirSync(DATA_DIR, { recursive: true });
  // 补全后、筛选前的完整快照。规则要长期调，每次改完都重抓一遍要两分半钟、
  // 还会把 seen 写脏，根本没法迭代。有了这份缓存，scripts/tinker-retriage.mjs
  // 能离线重放当天的筛选并和上一版对比。不进 git（体积大且每天变）。
  writeFileSync(`${DATA_DIR}/_raw.json`, JSON.stringify({ date: today, items: unique }, null, 2) + '\n');

  const { shortlist, rejected } = triage(unique, { cap: SHORTLIST_CAP });

  // 只有真正写进 _pending 的才记 seen。被规则毙掉的也要记——
  // 否则每天都会把同一批噪声重新抓一遍、重新扣一遍分。
  for (const it of unique) seen[it.id] = today;

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(`${DATA_DIR}/_pending.json`, JSON.stringify({
    date: today,
    generatedAt: now,
    queries,
    stats: {
      sources: sources.length,
      fetched: unique.length,
      shortlisted: shortlist.length,
      rejected: rejected.length,
      thin: unique.filter((it) => it.thin).length,
      enriched,
      enrichAttempted: attempted,
      failedSources: errors.filter((e) => !e.partial).length,
    },
    perSource,
    shortlist,
    rejected,
    errors,
  }, null, 2) + '\n');
  saveSeen(DATA_DIR, seen, today);
  saveStatus(DATA_DIR, status);

  const s = { fetched: unique.length, shortlisted: shortlist.length, rejected: rejected.length };
  console.log(`\n${today}：抓到 ${s.fetched} 条，规则入围 ${s.shortlisted} 条，筛掉 ${s.rejected} 条`);
  console.log(`正文补全：尝试 ${attempted}，成功 ${enriched}`);
  console.log(`今日查询词（${queries.length}）：${queries.join('、')}`);
  if (errors.length) {
    console.log(`\n抓取失败 ${errors.length} 个源：`);
    for (const e of errors) console.log(`  ${e.source} — ${e.message}`);
  }
  const stale = Object.entries(status).filter(([, v]) => v.consecutiveFailures >= 7);
  if (stale.length) {
    console.log('\n连续失败 7 天以上（需人工处理）：');
    for (const [name, v] of stale) console.log(`  ${name} — ${v.lastErrorMessage}（连续 ${v.consecutiveFailures} 次）`);
  }
  const zero = Object.entries(perSource).filter(([, n]) => n === 0).map(([n]) => n);
  if (zero.length) console.log(`\n本次零产出的源（${zero.length}）：${zero.join('、')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
