import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { collectFromFeed } from '../lib/collect.mjs';
import { loadSeen, saveSeen, loadStatus, saveStatus, recordSuccess, recordFailure } from '../lib/store.mjs';

const DATA_DIR = 'data';
const UA = 'Mozilla/5.0 (compatible; ai-news-reader/1.0; +https://github.com/maoyue2004/news)';
const TIMEOUT_MS = 20000;
const CONCURRENCY = 8;

function todayInShanghai() {
  // 定时任务按北京时间跑，日期也要按北京时间算，否则跨零点会错位。
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function main() {
  const sources = JSON.parse(readFileSync('sources.json', 'utf8')).filter((s) => s.enabled && s.feed);
  const today = todayInShanghai();
  const now = new Date().toISOString();
  const seen = loadSeen(DATA_DIR);
  const status = loadStatus(DATA_DIR);

  const items = [];
  const errors = [];

  for (let i = 0; i < sources.length; i += CONCURRENCY) {
    const batch = sources.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (source) => {
        try {
          const xml = await fetchFeed(source.feed);
          const got = collectFromFeed({ source, xml, seen, today, now });
          items.push(...got.items);
          recordSuccess(status, source.name, now);
        } catch (err) {
          errors.push({ source: source.name, message: err.message });
          recordFailure(status, source.name, now, err.message);
        }
      }),
    );
    console.error(`已抓取 ${Math.min(i + CONCURRENCY, sources.length)}/${sources.length}`);
  }

  items.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  // 只有真正写进 _pending 的条目才记进 seen，否则抓取失败会导致漏内容。
  for (const it of items) seen[it.id] = today;

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(`${DATA_DIR}/_pending.json`, JSON.stringify({ date: today, items, errors }, null, 2) + '\n');
  saveSeen(DATA_DIR, seen, today);
  saveStatus(DATA_DIR, status);

  console.log(`日期 ${today}：新条目 ${items.length} 条，失败 ${errors.length} 个源`);
  const stale = Object.entries(status).filter(([, s]) => s.consecutiveFailures >= 7);
  if (stale.length) {
    console.log('\n连续失败 7 天以上的源（需要人工处理）：');
    for (const [name, s] of stale) console.log(`  ${name} — ${s.lastErrorMessage}（连续 ${s.consecutiveFailures} 次）`);
  }
}

await main();
