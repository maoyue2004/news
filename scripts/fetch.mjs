import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { collectFromFeed, collectFromItems } from '../lib/collect.mjs';
import { parseFeed } from '../lib/feed-parse.mjs';
import { fetchAdapterItems } from '../lib/source-adapters.mjs';
import { extractArticleText } from '../lib/enrich.mjs';
import { loadSeen, saveSeen, loadStatus, saveStatus, recordSuccess, recordFailure } from '../lib/store.mjs';

const DATA_DIR = 'data';
const UA = 'Mozilla/5.0 (compatible; ai-news-reader/1.0; +https://github.com/maoyue2004/news)';
const TIMEOUT_MS = 20000;
const CONCURRENCY = Number(process.env.FETCH_CONCURRENCY ?? 8);
const ENRICH_CONCURRENCY = Number(process.env.ENRICH_CONCURRENCY ?? 6);
const ENRICH_TIMEOUT_MS = 20000;
const THIN_THRESHOLD = 200;
const EXCERPT_CHARS = 2000;
const execFileAsync = promisify(execFile);

const requestedPublishedDates = new Set(
  (process.env.PUBLISHED_DATES ?? '').split(',').map((date) => date.trim()).filter(Boolean),
);

function todayInShanghai() {
  // 定时任务按北京时间跑，日期也要按北京时间算，否则跨零点会错位。
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function dateInShanghai(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

export function filterByPublishedDates(items, dates, fallbackDate) {
  if (!dates.size) return items;
  return items.filter((item) => dates.has(item.publishedAt ? dateInShanghai(item.publishedAt) : fallbackDate));
}

let xyzFeedQueue = Promise.resolve();

async function fetchFeedDirect(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 403) {
    // xyzfm 等少数 feed 托管服务会按 TLS/HTTP 客户端指纹拦截 Node fetch，
    // 但对同一 UA 的 curl 正常返回。只在明确 403 时回退，避免掩盖普通网络错误。
    try {
      const { stdout } = await execFileAsync('curl', [
        '--fail', '--silent', '--show-error', '--location',
        '--max-time', String(Math.ceil(TIMEOUT_MS / 1000)),
        '--user-agent', UA,
        '--header', 'Accept: application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        url,
      ], { maxBuffer: 20 * 1024 * 1024 });
      return stdout;
    } catch {
      throw new Error('HTTP 403');
    }
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function fetchFeed(url) {
  if (new URL(url).hostname !== 'feed.xyzfm.space') return fetchFeedDirect(url);
  const task = xyzFeedQueue.then(() => fetchFeedDirect(url));
  xyzFeedQueue = task.catch(() => {});
  return task;
}

async function fetchArticleHtml(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(ENRICH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

/**
 * 瘦条目（excerpt 太短，摘要环节没内容可依据）尝试抓原文页补正文。
 * 任何失败（超时、403、解析不出内容……）都静默跳过、保留原 excerpt，绝不中断整体抓取。
 * 只有明显更长（>=200 字且至少是原 excerpt 两倍）才替换，避免拿噪声文本替换掉本来就还行的摘要。
 */
async function enrichThinItem(item) {
  const original = item.excerpt.length;
  try {
    const html = await fetchArticleHtml(item.url);
    const extracted = extractArticleText(html, EXCERPT_CHARS);
    if (extracted.length >= THIN_THRESHOLD && extracted.length >= original * 2) {
      item.excerpt = extracted;
      return true;
    }
  } catch {
    // 静默跳过：网络失败、403 挡 bot、页面结构异常等都不应中断整体抓取流程。
  }
  return false;
}

async function enrichThinItems(items) {
  const targets = items.filter((it) => it.excerpt.length < THIN_THRESHOLD);
  let enriched = 0;
  for (let i = 0; i < targets.length; i += ENRICH_CONCURRENCY) {
    const batch = targets.slice(i, i + ENRICH_CONCURRENCY);
    const results = await Promise.all(batch.map(enrichThinItem));
    enriched += results.filter(Boolean).length;
  }
  for (const it of items) it.thin = it.excerpt.length < THIN_THRESHOLD;
  return { attempted: targets.length, enriched };
}

async function main() {
  const sources = JSON.parse(readFileSync('sources.json', 'utf8')).filter((s) => s.enabled && s.feed);
  const today = todayInShanghai();
  const now = new Date().toISOString();
  const seen = loadSeen(DATA_DIR);
  const collectionSeen = { ...seen };
  const refetchSeenDate = process.env.REFETCH_SEEN_DATE;
  if (refetchSeenDate) {
    for (const [id, seenDate] of Object.entries(collectionSeen)) {
      if (seenDate === refetchSeenDate) delete collectionSeen[id];
    }
  }
  const status = loadStatus(DATA_DIR);

  const items = [];
  const errors = [];

  for (let i = 0; i < sources.length; i += CONCURRENCY) {
    const batch = sources.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (source) => {
        try {
          const body = await fetchFeed(source.feed);
          const raw = source.adapter
            ? await fetchAdapterItems({ source, html: body, fetchText: fetchArticleHtml, now })
            : null;
          const got = requestedPublishedDates.size
            ? collectFromItems({
                source,
                raw: filterByPublishedDates(
                  raw ?? parseFeedItems(body),
                  requestedPublishedDates,
                  today,
                ),
                seen: collectionSeen,
                today,
                now,
              })
            : source.adapter
              ? collectFromItems({ source, raw, seen: collectionSeen, today, now })
              : collectFromFeed({ source, xml: body, seen: collectionSeen, today, now });
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

  const { attempted, enriched } = await enrichThinItems(items);

  // 只有真正写进 _pending 的条目才记进 seen，否则抓取失败会导致漏内容。
  for (const it of items) seen[it.id] = today;

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(`${DATA_DIR}/_pending.json`, JSON.stringify({ date: today, items, errors }, null, 2) + '\n');
  saveSeen(DATA_DIR, seen, today);
  saveStatus(DATA_DIR, status);

  console.log(`日期 ${today}：新条目 ${items.length} 条，失败 ${errors.length} 个源`);
  const thinCount = items.filter((it) => it.thin).length;
  console.log(`正文补全：尝试 ${attempted} 条，成功 ${enriched} 条，最终仍无正文（thin）${thinCount} 条`);
  const stale = Object.entries(status).filter(([, s]) => s.consecutiveFailures >= 7);
  if (stale.length) {
    console.log('\n连续失败 7 天以上的源（需要人工处理）：');
    for (const [name, s] of stale) console.log(`  ${name} — ${s.lastErrorMessage}（连续 ${s.consecutiveFailures} 次）`);
  }
}

function parseFeedItems(xml) {
  // 复用 collectFromFeed 的解析入口之外，定向补抓需要先按发布时间筛选原始条目。
  return parseFeed(xml).items;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
