import { readFileSync, writeFileSync } from 'node:fs';
import { parseFeed } from '../lib/feed-parse.mjs';

// 部分站点（如 founderpark.net）会拒绝 bot 风格的 UA，实测换成浏览器 UA 才能连上。
// 这不是为了绕过反爬，只是让正常的 feed 请求不被误伤。
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT_MS = 15000;

/** 这些链接指向搜索结果页，本身不是内容站点，不存在 feed。 */
export function isUndiscoverable(url) {
  return /weixin\.sogou\.com|zhihu\.com\/search|podcasts\.apple\.com\/.*\/search/.test(url);
}

export function candidateFeedUrls(siteUrl) {
  const paths = ['feed', 'rss', 'rss.xml', 'feed.xml', 'atom.xml', 'index.xml', 'feed/'];
  const out = [];
  let u;
  try {
    u = new URL(siteUrl);
  } catch {
    return out;
  }
  const base = u.origin + u.pathname.replace(/\/$/, '');
  const root = u.origin;
  for (const p of paths) out.push(`${base}/${p}`);
  if (base !== root) for (const p of paths) out.push(`${root}/${p}`);
  return [...new Set(out)];
}

export function youtubeChannelIdFromHtml(html) {
  const meta = html.match(/itemprop="identifier"\s+content="(UC[\w-]{20,})"/);
  if (meta) return meta[1];
  const ext = html.match(/"externalId"\s*:\s*"(UC[\w-]{20,})"/);
  if (ext) return ext[1];
  const canonical = html.match(/channel\/(UC[\w-]{20,})/);
  if (canonical) return canonical[1];
  return null;
}

async function get(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

/** 从站点 HTML 的 <link rel="alternate"> 里读官方声明的 feed 地址。这是最可靠的一条路。 */
function declaredFeedFromHtml(html, baseUrl) {
  const re = /<link\b[^>]*>/gi;
  for (const tag of html.match(re) ?? []) {
    if (!/rel=["']?alternate/i.test(tag)) continue;
    if (!/type=["'](application\/(rss|atom)\+xml)["']/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i);
    if (href) {
      try {
        return new URL(href[1], baseUrl).toString();
      } catch {
        /* 忽略无法解析的相对地址 */
      }
    }
  }
  return null;
}

async function verifyFeed(url) {
  const xml = await get(url);
  const { items } = parseFeed(xml);
  if (items.length === 0) throw new Error('feed 里没有条目');
  return items.length;
}

async function discoverOne(source) {
  if (isUndiscoverable(source.url)) {
    return { feed: null, reason: '链接指向搜索结果页，不是内容站点，没有可用 feed' };
  }

  // YouTube 频道：从频道页解析 channelId，再拼官方 feed。
  if (/youtube\.com\/@/.test(source.url)) {
    const html = await get(source.url);
    const id = youtubeChannelIdFromHtml(html);
    if (!id) return { feed: null, reason: '无法从 YouTube 频道页解析出 channelId' };
    const feed = `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
    await verifyFeed(feed);
    return { feed, reason: null };
  }

  // 先看站点自己声明的 feed。
  try {
    const html = await get(source.url);
    const declared = declaredFeedFromHtml(html, source.url);
    if (declared) {
      await verifyFeed(declared);
      return { feed: declared, reason: null };
    }
  } catch {
    /* 站点首页拿不到也不要紧，继续试常见路径 */
  }

  for (const candidate of candidateFeedUrls(source.url)) {
    try {
      await verifyFeed(candidate);
      return { feed: candidate, reason: null };
    } catch {
      /* 试下一个 */
    }
  }
  return { feed: null, reason: '试遍常见 feed 路径均未找到可用 feed' };
}

async function main() {
  const sources = JSON.parse(readFileSync('sources.json', 'utf8'));
  const results = [];
  const CONCURRENCY = 8;

  for (let i = 0; i < sources.length; i += CONCURRENCY) {
    const batch = sources.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (s) => {
        try {
          return { source: s, ...(await discoverOne(s)) };
        } catch (err) {
          return { source: s, feed: null, reason: `探测出错：${err.message}` };
        }
      }),
    );
    results.push(...settled);
    console.error(`已探测 ${Math.min(i + CONCURRENCY, sources.length)}/${sources.length}`);
  }

  const updated = results.map(({ source, feed, reason }) =>
    feed
      ? { ...source, feed, enabled: true }
      : { ...source, feed: null, enabled: false, disabledReason: reason },
  );

  writeFileSync('sources.json', JSON.stringify(updated, null, 2) + '\n');

  const ok = updated.filter((s) => s.enabled);
  console.log(`\n可抓取 ${ok.length} / ${updated.length}`);
  console.log('\n--- 未找到 feed ---');
  for (const s of updated.filter((s) => !s.enabled)) {
    console.log(`  ${s.name}  (${s.type}/${s.lang})  — ${s.disabledReason}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
