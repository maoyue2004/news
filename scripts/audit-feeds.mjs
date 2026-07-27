// 体检已启用的 feed：条目数、最新条目日期、有正文的条目占比。
// 用来发现探测选错的 feed（僵尸存根、窄分类页）和只给标题的瘦 feed。
import { readFileSync } from 'node:fs';
import { parseFeed } from '../lib/feed-parse.mjs';
import { htmlToText } from '../lib/html-text.mjs';

const UA = 'Mozilla/5.0 (compatible; ai-news-reader/1.0; +https://github.com/maoyue2004/news)';
const CONCURRENCY = 8;

async function auditOne(source) {
  try {
    const res = await fetch(source.feed, {
      headers: { 'user-agent': UA, accept: '*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return { name: source.name, error: `HTTP ${res.status}` };
    const { items } = parseFeed(await res.text());
    const dates = items.map((i) => (i.publishedAt ? Date.parse(i.publishedAt) : NaN)).filter((n) => !Number.isNaN(n));
    const newest = dates.length ? new Date(Math.max(...dates)).toISOString().slice(0, 10) : null;
    const withBody = items.filter((i) => htmlToText(i.contentHtml, 2000).length >= 200).length;
    return {
      name: source.name,
      type: source.type,
      count: items.length,
      newest,
      bodyRatio: items.length ? Math.round((withBody / items.length) * 100) : 0,
    };
  } catch (err) {
    return { name: source.name, type: source.type, error: err.message };
  }
}

const sources = JSON.parse(readFileSync('sources.json', 'utf8')).filter((s) => s.enabled && s.feed);
const results = [];
for (let i = 0; i < sources.length; i += CONCURRENCY) {
  results.push(...(await Promise.all(sources.slice(i, i + CONCURRENCY).map(auditOne))));
}

const today = Date.now();
const stale = results.filter((r) => r.newest && (today - Date.parse(r.newest)) / 86400000 > 60);
const tiny = results.filter((r) => !r.error && r.count <= 3);
const thin = results.filter((r) => !r.error && r.bodyRatio < 30);
const errored = results.filter((r) => r.error);

console.log('=== 僵尸 feed（最新条目超过 60 天）===');
stale.forEach((r) => console.log(`  ${r.name} (${r.type}) — 最新 ${r.newest}，共 ${r.count} 条`));
console.log('\n=== 条目数异常少（<=3 条）===');
tiny.forEach((r) => console.log(`  ${r.name} (${r.type}) — ${r.count} 条，最新 ${r.newest}`));
console.log('\n=== 瘦 feed（有正文的条目 <30%，摘要将无内容可写）===');
thin.forEach((r) => console.log(`  ${r.name} (${r.type}) — ${r.bodyRatio}% 有正文，共 ${r.count} 条`));
console.log('\n=== 抓取出错 ===');
errored.forEach((r) => console.log(`  ${r.name} — ${r.error}`));
console.log(`\n合计体检 ${results.length} 个源`);
