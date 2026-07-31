import { readFileSync, writeFileSync } from 'node:fs';
import { parseFeed } from '../lib/feed-parse.mjs';

// 诚实标识自己并留下项目地址，方便站点管理员在需要时联系。
// 曾试过伪装成浏览器 UA，实测对探测成功率没有任何提升（58/97 无变化），故不值得这么做。
const UA = 'Mozilla/5.0 (compatible; ai-news-reader/1.0; +https://github.com/maoyue2004/news)';
const TIMEOUT_MS = 15000;

/** 这些链接指向搜索结果页，且目前没有可查询的开放目录。 */
export function isUndiscoverable(url) {
  return /weixin\.sogou\.com|zhihu\.com\/search/.test(url);
}

export function appleSearchTerm(url) {
  try {
    const u = new URL(url);
    if (!/podcasts\.apple\.com$/.test(u.hostname) || !/\/search$/.test(u.pathname)) return null;
    return u.searchParams.get('term');
  } catch {
    return null;
  }
}

function normalizedPodcastName(name) {
  return name
    .toLowerCase()
    .replace(/\b(?:podcast|the|show)\b/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '');
}

export function podcastMatchScore(sourceName, collectionName) {
  const source = normalizedPodcastName(sourceName);
  const collection = normalizedPodcastName(collectionName);
  if (!source || !collection) return 0;
  if (source === collection) return 100;
  if (Math.min(source.length, collection.length) >= 5
      && (collection.startsWith(source) || source.startsWith(collection))) return 80;
  if (source.length >= 5 && collection.includes(source)) return 60;
  return 0;
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

/** Apple 的公开 Search API 会返回节目登记的原始 feedUrl。 */
async function podcastFeedFromApple(source) {
  const term = appleSearchTerm(source.url) || source.name;
  const candidates = [];
  for (const country of ['cn', 'us']) {
    const api = new URL('https://itunes.apple.com/search');
    api.searchParams.set('media', 'podcast');
    api.searchParams.set('entity', 'podcast');
    api.searchParams.set('limit', '15');
    api.searchParams.set('country', country);
    api.searchParams.set('term', term);
    const data = JSON.parse(await get(api.toString()));
    for (const result of data.results ?? []) {
      if (!result.feedUrl) continue;
      candidates.push({
        feed: result.feedUrl,
        score: podcastMatchScore(source.name, result.collectionName ?? ''),
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const candidate of candidates) {
    if (candidate.score < 60) break;
    try {
      await verifyFeed(candidate.feed);
      return candidate.feed;
    } catch {
      /* 目录里也可能残留已经失效的 feed，继续试同名候选。 */
    }
  }
  return null;
}

async function discoverOne(source) {
  // 手工适配的 HTML/归档/sitemap 入口不是 XML，discover 脚本不能拿
  // parseFeed 去误判它；可用性由 fetch 和 audit 通过对应 adapter 检查。
  if (source.adapter && source.feed) return { feed: source.feed, reason: null };

  // 已配置的 feed 先实抓验证。这样搜索结果页只是 source 展示地址时，
  // 不会把已经找到的独立 feed 又覆盖成 disabled。
  if (source.feed) {
    try {
      await verifyFeed(source.feed);
      return { feed: source.feed, reason: null };
    } catch {
      /* 旧 feed 失效时继续从目录、网页声明和常见路径重新发现。 */
    }
  }

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

  if (source.type === 'podcast' || appleSearchTerm(source.url)) {
    try {
      const feed = await podcastFeedFromApple(source);
      if (feed) return { feed, reason: null };
    } catch {
      /* Apple 目录偶发失败时，仍继续走网页声明和常见路径探测。 */
    }
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
