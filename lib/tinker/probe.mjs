import { parseFeed } from '../feed-parse.mjs';

/**
 * 探测一个站点的 feed 地址。
 *
 * 与 scripts/discover-feeds.mjs 的区别：那个脚本服务于「信源罗盘」的 96 个源，
 * 混杂了播客目录、YouTube 频道等专用逻辑。折腾志的候选源全部是个人博客与内容平台，
 * 只需要两条路径：站点 HTML 里声明的 <link rel=alternate>，以及常见 feed 路径穷举。
 * 单独实现可以让这里保持小而可测，不被播客那套逻辑拖着走。
 */

export const UA = 'Mozilla/5.0 (compatible; agent-tinker-log/1.0; +https://github.com/maoyue2004/news)';

/**
 * linux.do 这类 Discourse 站点对声明自己是 bot 的 UA 直接 403，
 * 但对普通浏览器 UA 正常返回公开 RSS。诚实 UA 是默认，拿不到时才回退。
 */
export const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT_MS = 15000;

/** 常见 feed 路径。顺序即优先级：越靠前的越可能是站点主 feed。 */
const FEED_PATHS = [
  'feed', 'rss', 'atom.xml', 'index.xml', 'feed.xml', 'rss.xml',
  'feed/', 'rss/', 'feeds/posts/default', 'blog/feed', 'posts/index.xml',
];

export function declaredFeeds(html, baseUrl) {
  const out = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel=["']?[^"'>]*alternate/i.test(tag)) continue;
    // 属性值不一定带引号——黑暗執行緒写的是 type=application/rss+xml，
    // 只匹配带引号的形式会漏掉一批手写模板的站点。
    if (!/type=["']?application\/(rss|atom)\+xml["'\s>]/i.test(tag)) continue;
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1] ?? /href=([^\s"'>]+)/i.exec(tag)?.[1];
    if (!href) continue;
    try {
      out.push(new URL(href, baseUrl).toString());
    } catch {
      // 相对地址解析失败就跳过，不值得为一个坏 link 标签中断整次探测。
    }
  }
  return [...new Set(out)];
}

/**
 * 候选站点写成什么形状的都有，探测之前统一补上 scheme。
 *
 * 2026-09-03 踩的：`tinker-authorsites.mjs` 从平台 profile 接口拿到的 `website`
 * 字段是**裸域名**（`wxjback.com`），照原样写进 `candidates.txt`；
 * 而 `tinker-probe.mjs --file` 读出来直接交给 `new URL()`，于是报
 * 「首页抓取失败：Failed to parse URL from wxjback.com」——
 * 这行字和「这个站探不出 feed」在结果里长得一模一样，
 * 09-02 的复盘就照着它记成了「首页两轮都是 HTTP 502，下轮重探」，
 * 也就是说这个候选**从来没有真的被探过一次**，而账上写的是探过了。
 *
 * 形状是 LESSONS 那条「一份账本的 schema 演化过，就要去问所有读它的地方跟上了没有」
 * 的第二次复发（第一次是 denylist 的 `feed` / `url` 两种 key 只有一个脚本跟上了），
 * 也是「解析器读不动和真的没货长得一模一样」的又一例。
 * 修法照那条写的后半句：不在调用点各补一个 `??`——那正是这个洞的成因——
 * 抽一个共用函数出来并给它一条测试。
 */
export function normalizeCandidateUrl(line) {
  const s = String(line ?? '').trim();
  if (!s) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
}

export function candidateFeedUrls(siteUrl) {
  let u;
  try {
    u = new URL(siteUrl);
  } catch {
    return [];
  }
  const base = u.origin + u.pathname.replace(/\/$/, '');
  const out = FEED_PATHS.map((p) => `${base}/${p}`);
  if (base !== u.origin) out.push(...FEED_PATHS.map((p) => `${u.origin}/${p}`));
  return [...new Set(out)];
}

/**
 * feed 的「可用」标准不只是能解析出 XML。只有一条目、或全部条目都没有日期的 feed
 * 在日更管线里等同于死源：要么反复重复同一条，要么没法判断新鲜度。
 * 探测阶段就把这些标出来，比上线后靠 status.json 慢慢发现快得多。
 */
export function gradeFeed(xml) {
  const parsed = parseFeed(xml);
  const items = parsed.items ?? [];
  if (!items.length) return { ok: false, reason: '解析出 0 条' };
  const dated = items.filter((it) => it.publishedAt);
  const withBody = items.filter((it) => (it.contentHtml ?? '').length > 400);
  const latest = dated.length
    ? dated.map((it) => Date.parse(it.publishedAt)).sort((a, b) => b - a)[0]
    : null;
  return {
    ok: true,
    title: parsed.title ?? '',
    count: items.length,
    datedRatio: dated.length / items.length,
    bodyRatio: withBody.length / items.length,
    latestAt: latest ? new Date(latest).toISOString() : null,
    ageDays: latest ? Math.round((Date.now() - latest) / 86400000) : null,
  };
}

async function get(url, ua, accept, timeout) {
  const res = await fetch(url, {
    headers: { 'user-agent': ua, accept },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

/**
 * 先用诚实 UA，只有在被拒（403/429）时才回退到浏览器 UA。
 * 返回实际生效的 UA，调用方据此在 sources.json 里记 `browserUa`，
 * 抓取阶段就不用每次都先撞一次 403。
 */
export async function fetchText(url, { timeout = TIMEOUT_MS, accept = '*/*', ua } = {}) {
  if (ua) return { text: await get(url, ua, accept, timeout), ua };
  try {
    return { text: await get(url, UA, accept, timeout), ua: UA };
  } catch (err) {
    if (!/HTTP (403|429)/.test(err.message)) throw err;
    return { text: await get(url, BROWSER_UA, accept, timeout), ua: BROWSER_UA };
  }
}

const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*';

export async function probeSite(siteUrl) {
  const tried = [];
  const attempts = [];

  try {
    const { text } = await fetchText(siteUrl, { accept: 'text/html,*/*' });
    attempts.push(...declaredFeeds(text, siteUrl));
  } catch (err) {
    tried.push({ url: siteUrl, error: `首页抓取失败：${err.message}` });
  }
  attempts.push(...candidateFeedUrls(siteUrl));

  for (const url of [...new Set(attempts)]) {
    try {
      const { text, ua } = await fetchText(url, { accept: FEED_ACCEPT });
      const grade = gradeFeed(text);
      if (grade.ok) return { site: siteUrl, feed: url, browserUa: ua === BROWSER_UA, ...grade, tried };
      tried.push({ url, error: grade.reason });
    } catch (err) {
      tried.push({ url, error: err.message });
    }
  }
  return { site: siteUrl, feed: null, ok: false, tried };
}
