#!/usr/bin/env node
/**
 * 从**已收录博客的友链页**里发现新博客。
 *
 * 为什么需要第二条扩源通道：`tinker-harvest.mjs` 走的是社区索引（OPML / CSV /
 * Markdown 名录），而 LESSONS 已经给那条路判了死刑——同样四个索引连扫四轮
 * 命中 19 → 12 → 7 → 0，第五、第六个索引（lotosbin / bloghub）单扫下来
 * 一个 7 命中、一个 0 命中。名录这个池子是有限的，而且几拨人挑的其实是同一批人。
 *
 * 友链页是**结构上不同的一条边**：名录是「有人把你收进榜单」，友链是
 * 「写博客的人自己认识谁」。后者天然偏个人、偏小众、偏不上榜的站点，
 * 正是名录系统性漏掉的那一批。而且它自带一个名录给不了的信号——
 * **入链数**：被三个已收录博主同时挂在友链里的站，比只被一个人挂的更可能同频。
 *
 * 判据完全复用 `tinker-harvest.mjs` 的 `evaluate()`，不另立一套近似标准
 * （LESSONS：「选源判据要用系统自己的评分器」）。denylist 也照吃，
 * 否则每跑一次就把否掉的站重新提名一遍。
 *
 * 用法：
 *   node scripts/tinker-blogroll.mjs                  # 只列友链域名和入链数，不抓 feed
 *   node scripts/tinker-blogroll.mjs --evaluate       # 探 feed + 跑评分器，给出可并入的命中列表
 *   node scripts/tinker-blogroll.mjs --evaluate --min-links 2
 *   node scripts/tinker-blogroll.mjs --evaluate --write tinker/candidates.txt
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { declaredFeeds, gradeFeed, UA } from '../lib/tinker/probe.mjs';
import { evaluate, PODCAST_HOST, looksLikeAudio } from './tinker-harvest.mjs';

const SOURCES = 'tinker/sources.json';
const DENYLIST = 'tinker/denylist.json';
const CONCURRENCY = Number(process.env.BLOGROLL_CONCURRENCY ?? 12);
const TIMEOUT_MS = Number(process.env.BLOGROLL_TIMEOUT_MS ?? 12000);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const EVALUATE = args.includes('--evaluate');
/**
 * 入链数门槛。1 是「只有一个人挂过它」，也是默认值。
 *
 * 2026-08-11 第一次跑的时候默认设的是 2，理由听起来很顺：候选有 1473 个，
 * 而「被两三个已收录博主同时挂着」显然更可能同频，先吃高的那一头省时间。
 * 结果第二轮把 1473 个全跑完，**本轮质量最高、也是创刊以来单站最高的
 * `qiyec.site`（近 20 篇 14 篇够上收录线）只被一个人挂过**。
 *
 * 所以：**入链数是吞吐启发式，不是质量启发式**。它可以用来决定先跑谁
 * （结果按它排序，高的先出），绝不能用来决定跑不跑。要分两趟就两趟都跑完。
 */
const MIN_LINKS = Number(flag('min-links', 1));
const WRITE = flag('write', null);
/**
 * 把「爬友链页」这一步的结果缓存下来。
 *
 * 收集和评估是两件事：收集要爬 207 个站、十几分钟，而评估的判据（min-hits、
 * days、min-span）是要反复调的。没有缓存的话每调一次参数就得重爬一遍友链页，
 * 这正是 harvest 那条「静默跑很久」的坑再走一遍。
 */
const CACHE = flag('cache', null);
/** 单个候选站点最多花多久。默认比 probe.mjs 的 15 秒短——这里要探上千个，死站不值得等。 */
const PROBE_TIMEOUT_MS = Number(flag('probe-timeout', 6000));

/**
 * 友链页的常见路径。中文博客圈这套命名高度收敛（Hexo / Hugo 的几套主题
 * 把「友情链接」固定在 /links 或 /friends），所以穷举比解析导航更省事也更全。
 */
const LINK_PATHS = [
  'links', 'links/', 'friends', 'friends/', 'link', 'link/', 'friend', 'friend/',
  'links.html', 'friends.html', 'links/index.html', 'blogroll', 'blogroll/',
];

/** 导航里指向友链页的锚文本。穷举路径漏掉的（自定义路径）靠它捡回来。 */
const LINK_ANCHOR = /友链|友情链接|朋友们|link exchange|blogroll/i;

/**
 * 不可能是个人博客的域名。友链页里混着大量这类链接：备案查询、
 * 主题作者、CDN、图床、社交账号、以及「本站由 X 驱动」的页脚。
 * 不滤掉的话入链数排行前几十全是 github.com 和 beian.miit.gov.cn。
 */
const NOT_A_BLOG = new RegExp([
  'github\\.(com|io/?$)', 'gitee\\.com', 'gitlab\\.com', 'npmjs\\.com', 'stackoverflow',
  'twitter\\.com', 'x\\.com', 'facebook', 'instagram', 'linkedin', 'youtube', 'youtu\\.be',
  'weibo\\.', 'zhihu\\.com', 'juejin\\.', 'csdn\\.net', 'cnblogs\\.com', 'segmentfault',
  'bilibili\\.com', 'douban\\.com', 'xiaohongshu', 'telegram', 't\\.me', 'qq\\.com',
  'taobao', 'tmall', 'jd\\.com', 'amazon', 'apple\\.com', 'microsoft\\.com', 'google\\.',
  'wikipedia', 'w3\\.org', 'creativecommons\\.org', 'beian\\.', 'miit\\.gov\\.cn',
  'gravatar', 'cloudflare', 'vercel\\.(app|com)$', 'netlify\\.(app|com)$', 'cdn',
  'hexo\\.io', 'gohugo\\.io', 'jekyllrb', 'wordpress\\.(org|com)$', 'typecho\\.org',
  'travellings\\.', 'foreverblog\\.cn', 'boke\\.lu', 'zhaoolee', 'icp\\.',
  'mail\\.', 'mailto', 'rsshub', 'feedly', 'inoreader', 'follow\\.is',
].join('|'), 'i');

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };

async function get(url, ua = UA, accept = 'text/html,*/*', timeout = TIMEOUT_MS) {
  const res = await fetch(url, {
    headers: { 'user-agent': ua, accept },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

/** 从 HTML 里抽出所有站外链接的 origin。同一个域名在一页里出现多次只算一次。 */
export function outboundOrigins(html, selfHost) {
  const out = new Map();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    const href = m[1];
    if (!/^https?:\/\//i.test(href)) continue;
    const h = host(href);
    if (!h || h === selfHost || h.endsWith(`.${selfHost}`) || selfHost.endsWith(`.${h}`)) continue;
    if (NOT_A_BLOG.test(h)) continue;
    // 深链（文章页）不是友链，友链指向的是站点根。带路径的只在没有根链接时兜底。
    let origin;
    try { origin = new URL(href).origin; } catch { continue; }
    if (!out.has(h)) out.set(h, origin);
  }
  return out;
}

/**
 * 找出一个站点的友链页。先看首页导航里有没有明确的锚文本，
 * 再穷举常见路径。**只取前两个命中**——有的站把友链拆成好几页，
 * 全抓一遍收益递减，而每多一页就是一次超时风险。
 */
async function findBlogrollPages(siteUrl) {
  const found = [];
  const selfHost = host(siteUrl);
  let homeHtml = '';
  try { homeHtml = await get(siteUrl); } catch { /* 首页挂了就只能靠穷举 */ }

  for (const m of homeHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)) {
    const [, href, text] = m;
    if (!LINK_ANCHOR.test(text) && !LINK_ANCHOR.test(href)) continue;
    try {
      const u = new URL(href, siteUrl);
      if (host(u.toString()) === selfHost) found.push(u.toString());
    } catch { /* 坏链接跳过 */ }
  }
  for (const p of LINK_PATHS) {
    try { found.push(new URL(p, siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`).toString()); } catch { /* ignore */ }
  }
  return { pages: [...new Set(found)], homeHtml, selfHost };
}

async function collectFrom(siteUrl) {
  const { pages, homeHtml, selfHost } = await findBlogrollPages(siteUrl);
  if (!selfHost) return new Map();
  const hits = new Map();
  let opened = 0;
  for (const page of pages) {
    if (opened >= 2) break;
    let html;
    if (page === siteUrl && homeHtml) html = homeHtml;
    else {
      try { html = await get(page); } catch { continue; }
    }
    // 友链页的特征是「一页里几十个站外域名」。个位数的多半是抓错了页
    // （404 页面、about 页），算进去只会稀释入链数这个信号。
    const origins = outboundOrigins(html, selfHost);
    if (origins.size < 3) continue;
    opened += 1;
    for (const [h, origin] of origins) if (!hits.has(h)) hits.set(h, origin);
  }
  return hits;
}

/**
 * 快速探 feed。
 *
 * 不用 `probe.mjs` 的 `probeSite()`：那个是**串行**试十来个候选路径、每个 15 秒超时，
 * 一个死站要耗掉三分多钟。探几十个候选没问题，探一千多个就是几个小时——
 * 实测跑到 96/1473 用了 25 分钟，按这个速度要六小时，只能中途终止（和 LESSONS
 * 里「五索引 harvest 估算三个多小时、日更那轮等不起」是同一个形状）。
 *
 * 这里换成：首页抓一次拿声明的 feed，拿不到就**并发**试 4 条最常见的路径。
 * 代价是漏掉那些把 feed 放在冷门路径又不在 <link> 里声明的站——
 * 这类站在中文博客圈是少数，用命中率换一个数量级的吞吐是划算的。
 */
const QUICK_PATHS = ['atom.xml', 'feed', 'index.xml', 'rss.xml'];
const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*';

async function quickProbe(siteUrl) {
  const attempts = [];
  try {
    const html = await get(siteUrl, UA, 'text/html,*/*', PROBE_TIMEOUT_MS);
    attempts.push(...declaredFeeds(html, siteUrl));
  } catch { /* 首页挂了仍然试常见路径：有的站首页是 JS 壳但 feed 是静态文件 */ }
  const base = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`;
  for (const p of QUICK_PATHS) {
    try { attempts.push(new URL(p, base).toString()); } catch { /* ignore */ }
  }
  const tried = [...new Set(attempts)].slice(0, 6);
  const results = await Promise.all(tried.map(async (url) => {
    try {
      const xml = await get(url, UA, FEED_ACCEPT, PROBE_TIMEOUT_MS);
      return gradeFeed(xml).ok ? { url, xml } : null;
    } catch { return null; }
  }));
  // 保持 tried 的顺序：声明的 feed 排在穷举的前面，站点主 feed 优先。
  return results.find(Boolean) ?? null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sources = JSON.parse(readFileSync(SOURCES, 'utf8'));
  const denylist = existsSync(DENYLIST) ? JSON.parse(readFileSync(DENYLIST, 'utf8')) : [];
  const deniedHosts = new Set(denylist.filter((d) => d.scope !== 'feed').map((d) => host(d.feed)).filter(Boolean));
  const knownHosts = new Set();
  for (const s of sources) {
    for (const u of [s.url, s.feed]) { const h = host(u); if (h) knownHosts.add(h); }
  }

  /** host → { origin, from: Set<博客名> }。from 的大小就是入链数。 */
  const inbound = new Map();
  if (CACHE && existsSync(CACHE)) {
    for (const [h, v] of Object.entries(JSON.parse(readFileSync(CACHE, 'utf8')))) {
      inbound.set(h, { origin: v.origin, from: new Set(v.from) });
    }
    console.error(`从缓存 ${CACHE} 读回 ${inbound.size} 个站外域名，跳过爬取`);
  } else {
    const seeds = sources
      .filter((s) => s.kind === 'blog' && s.enabled !== false && s.url)
      .map((s) => ({ name: s.name, url: s.url }));
    console.error(`${seeds.length} 个已收录博客，开始找友链页…`);
    for (let i = 0; i < seeds.length; i += CONCURRENCY) {
      await Promise.all(seeds.slice(i, i + CONCURRENCY).map(async (seed) => {
        let hits;
        try { hits = await collectFrom(seed.url); } catch { return; }
        for (const [h, origin] of hits) {
          if (!inbound.has(h)) inbound.set(h, { origin, from: new Set() });
          inbound.get(h).from.add(seed.name);
        }
      }));
      console.error(`  ${Math.min(i + CONCURRENCY, seeds.length)}/${seeds.length}，已见到 ${inbound.size} 个站外域名`);
    }
    if (CACHE) {
      const dump = {};
      for (const [h, v] of inbound) dump[h] = { origin: v.origin, from: [...v.from] };
      writeFileSync(CACHE, JSON.stringify(dump, null, 2) + '\n');
      console.error(`已缓存到 ${CACHE}，下次带 --cache 就不用重爬`);
    }
  }

  const fresh = [...inbound.entries()]
    .filter(([h]) => !knownHosts.has(h) && !deniedHosts.has(h))
    .map(([h, v]) => ({ host: h, origin: v.origin, links: v.from.size, from: [...v.from] }))
    .filter((r) => r.links >= MIN_LINKS)
    .sort((a, b) => b.links - a.links || a.host.localeCompare(b.host));

  console.log(`\n=== 友链页里出现、且不在 sources.json / denylist 里的域名：${fresh.length} 个（入链 ≥${MIN_LINKS}）===`);
  for (const r of fresh.slice(0, 60)) {
    console.log(`${String(r.links).padStart(2)} 入链 | ${r.host.padEnd(32)} | ${r.from.slice(0, 3).join(', ')}`);
  }
  if (fresh.length > 60) console.log(`… 另有 ${fresh.length - 60} 个只列在 --write 的文件里`);

  if (WRITE) {
    writeFileSync(WRITE, fresh.map((r) => r.origin).join('\n') + '\n');
    console.log(`\n已写入 ${WRITE}（${fresh.length} 个候选站点）`);
  }

  if (!EVALUATE) {
    console.log('\n（加 --evaluate 才会探 feed 并跑评分器）');
    process.exit(0);
  }

  console.error(`\n开始探 ${fresh.length} 个候选的 feed 并评估…`);
  const passed = [];
  for (let i = 0; i < fresh.length; i += CONCURRENCY) {
    await Promise.all(fresh.slice(i, i + CONCURRENCY).map(async (cand) => {
      let probed;
      try { probed = await quickProbe(cand.origin); } catch { return; }
      if (!probed) return;
      if (PODCAST_HOST.test(probed.url) || looksLikeAudio(probed.xml)) return;
      try {
        const verdict = evaluate(probed.xml);
        if (verdict.ok) passed.push({ ...cand, feed: probed.url, ...verdict });
      } catch { /* 坏 feed 丢掉 */ }
    }));
    console.error(`  ${Math.min(i + CONCURRENCY, fresh.length)}/${fresh.length}`);
  }

  passed.sort((a, b) => b.hitPosts - a.hitPosts || a.ageDays - b.ageDays);
  console.log(`\n=== 命中 ${passed.length} 个（判据与 tinker-harvest 完全一致）===`);
  for (const r of passed) {
    const name = (r.feedTitle || r.host).slice(0, 20);
    console.log(`${String(r.hitPosts).padStart(2)}/20 够格 | ${String(r.ageDays).padStart(3)}天前 | 跨${String(r.spanDays).padStart(3)}天 | ${String(r.links)} 入链 | ${name.padEnd(20)} | ${r.feed}`);
    const tags = [...r.tools, ...r.topics];
    if (tags.length) console.log(`             ${tags.join(', ')}`);
    console.log(`             来自友链：${r.from.slice(0, 4).join(', ')}`);
  }
  console.log('\n命中列表要人工过一遍再并入（大厂官方号 / 翻译站机器判不出来，见 LESSONS）。');
}
