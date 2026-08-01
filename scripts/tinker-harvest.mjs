#!/usr/bin/env node
/**
 * 从中文独立博客索引里批量筛选值得订阅的博客。
 *
 * 为什么需要它：用搜索引擎找个人博客几乎无效，搜出来的全是 CSDN / 知乎这类
 * SEO 平台页。中文独立博客的真实分布在社区维护的索引里，
 * 而且这样的索引不止一个——单靠 timqian 那份会系统性偏向大陆站点，
 * 繁体中文圈几乎捞不到。所以这里同时吃多个索引，格式各异（CSV / OPML / Markdown），
 * 统一抽出「候选 feed 地址」这一件事，剩下的交给同一套评估逻辑。
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
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseFeed } from '../lib/feed-parse.mjs';
import { htmlToText } from '../lib/html-text.mjs';
import { matchVocab } from '../lib/tinker/vocab.mjs';
import { scoreItem } from '../lib/tinker/relevance.mjs';
import { UA, BROWSER_UA } from '../lib/tinker/probe.mjs';

/**
 * 候选池。加新索引只要往这里加一条：给出 url 和把正文变成候选列表的解析函数。
 * 名字可以留空——评估阶段会从 feed 自己的 <title> 里取，比索引里的人工标注更准。
 */
const INDEXES = [
  {
    id: 'timqian',
    url: 'https://raw.githubusercontent.com/timqian/chinese-independent-blogs/master/blogs-original.csv',
    parse: parseCsv,
  },
  {
    id: 'blogcn',
    url: 'https://raw.githubusercontent.com/RSS-Renaissance/awesome-blogCN-feeds/master/feedlist.opml',
    parse: parseOpml,
  },
  {
    id: 'top-rss',
    url: 'https://raw.githubusercontent.com/weekend-project-space/top-rss-list/main/README.md',
    parse: parseMarkdown,
  },
  {
    id: 'awesome-rss',
    url: 'https://raw.githubusercontent.com/xiangyugongzuoliu/awesome-rss-feeds-list/main/LIST.md',
    parse: parseMarkdown,
  },
];
const SOURCES = 'tinker/sources.json';
/**
 * 人工否决过的 feed。
 *
 * 没有这份名单时，扩源脚本不记得任何判断，每跑一次就把同样几个源重新提名一遍，
 * 我就得重新判一遍——实测第二轮里 5 个命中都是上一轮已经否决过的
 * （腾讯技术工程、小米技术、宝玉的分享……）。
 * 有些否决理由机器判不出来（「大厂官方号」和个人实践文在文本上分不开），
 * 所以判断只能靠人做一次，然后记下来。
 */
const DENYLIST = 'tinker/denylist.json';
const CONCURRENCY = Number(process.env.HARVEST_CONCURRENCY ?? 20);
const TIMEOUT_MS = Number(process.env.HARVEST_TIMEOUT_MS ?? 12000);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const ACTIVE_DAYS = Number(flag('days', 120));
/** 命中门槛。1-2 篇往往是顺带提一句，3 篇起才说明这个博主真的在写这个主题。 */
const MIN_HITS = Number(flag('min-hits', 2));
/**
 * 近 20 篇的时间跨度下限（天）。媒体站日更十几条，20 篇可能只跨两三天；
 * 个人博客不会。这是区分「个人博客」和「媒体」最省事也最可靠的一个信号。
 */
const MIN_SPAN_DAYS = Number(flag('min-span', 14));
const MERGE = args.includes('--merge');
/** 只跑某个索引，调试用。不给就全跑。 */
const ONLY = flag('index', null);

/** 只看技术向的标签，「摄影」「生活」这类整片跳过，省掉大半抓取量。 */
const TECH_TAGS = /编程|技术|开发|前端|后端|运维|开源|AI|机器学习|数据|算法|安全|效率|工具|极客|Linux|云计算|架构/i;

/** OPML：只认 xmlUrl 属性。 */
export function parseOpml(text) {
  const out = [];
  for (const m of text.matchAll(/<outline\b[^>]*>/g)) {
    const tag = m[0];
    const feed = /xmlUrl=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!feed?.startsWith('http')) continue;
    const name = /text=["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
    const url = /htmlUrl=["']([^"']+)["']/i.exec(tag)?.[1] ?? feed;
    out.push({ name, url, feed, tags: '技术' });
  }
  return out;
}

/**
 * Markdown 索引没有固定结构，只能靠 URL 形态猜哪些是 feed。
 * 宁可多收——非 feed 的地址在评估阶段解析失败会自然淘汰，成本只是一次请求。
 */
const FEED_LIKE = /\/(feed|rss|atom)(\.(xml|json))?\/?$|\.(xml|atom)$|\/feed\/|\/rss\//i;

/**
 * 播客 / 音频源。用户要的是文章，音频进来只会占名额还没法读。
 * 靠 URL 认已知播客托管，靠 <enclosure type="audio/*"> 认通用情况——
 * 实测两者都需要：ximalaya 的专辑 URL 看不出是音频，
 * 而 justinyan.me/feed/podcast 这种自建的又不在托管名单里。
 */
export const PODCAST_HOST = /ximalaya\.com|xiaoyuzhoufm\.com|fireside\.fm|typlog\.io|anchor\.fm|buzzsprout|libsyn|podbean|feed\.xyzfm|\/podcast/i;

export function looksLikeAudio(xml) {
  return /<enclosure[^>]+type=["']audio\//i.test(xml) || /<itunes:/i.test(xml);
}

export function parseMarkdown(text) {
  const seen = new Set();
  const out = [];
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) {
    const feed = m[0].replace(/[.,;]$/, '');
    if (!FEED_LIKE.test(feed) || seen.has(feed)) continue;
    if (/github\.com|githubusercontent|w3\.org|example\./i.test(feed)) continue;
    seen.add(feed);
    out.push({ name: '', url: feed, feed, tags: '技术' });
  }
  return out;
}

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
 * 判断一个 feed 值不值得订阅。
 *
 * 第一版的判据是「近 20 篇里有几篇提到 agent」。它是个不错的**相关性**过滤，
 * 却是个糟糕的**质量**过滤——实测从「订阅数最多」的榜单里捞出来的全是
 * 36氪、钛媒体、爱范儿、极客公园这类媒体：它们每天报道 AI，这个门槛轻松达标，
 * 而它们恰恰是这个项目最不想要的东西。
 *
 * 现在改成两条：
 *   1) 直接用系统自己的评分器跑一遍近期文章，看有几篇是**它真的会收**的。
 *      判据和日常筛选完全一致，不再是另一套近似标准。
 *   2) 近 20 篇的时间跨度不能太短。媒体日更十几条，个人博客不会。
 */
function evaluate(xml) {
  const parsed = parseFeed(xml);
  const { items = [] } = parsed;
  if (!items.length) return { ok: false, why: '0 条' };

  const dated = items.map((it) => Date.parse(it.publishedAt)).filter((n) => !Number.isNaN(n));
  if (!dated.length) return { ok: false, why: '无日期' };
  const latest = Math.max(...dated);
  const ageDays = Math.round((Date.now() - latest) / 86400000);
  if (ageDays > ACTIVE_DAYS) return { ok: false, why: `${ageDays} 天没更新` };

  const recent = items.slice(0, 20);
  const recentDates = recent.map((it) => Date.parse(it.publishedAt)).filter((n) => !Number.isNaN(n));
  const spanDays = recentDates.length > 1
    ? Math.round((Math.max(...recentDates) - Math.min(...recentDates)) / 86400000)
    : 0;
  if (recent.length >= 10 && spanDays < MIN_SPAN_DAYS) {
    return { ok: false, why: `近 ${recent.length} 篇只跨 ${spanDays} 天，像媒体不像个人博客`, ageDays };
  }

  let passPosts = 0;
  const tools = new Set();
  const topics = new Set();
  for (const it of recent) {
    const excerpt = htmlToText(it.contentHtml ?? '', 3000);
    const r = scoreItem({ title: it.title ?? '', excerpt, kind: 'blog' });
    if (r.verdict === 'shortlist') {
      passPosts += 1;
      for (const id of r.tools) tools.add(id);
      for (const id of r.topics) topics.add(id);
    }
  }
  if (passPosts < MIN_HITS) return { ok: false, why: `近期只有 ${passPosts} 篇够格`, ageDays };
  return {
    ok: true, ageDays, count: items.length, hitPosts: passPosts, spanDays,
    tools: [...tools], topics: [...topics], feedTitle: (parsed.title ?? '').trim(),
  };
}

if (import.meta.url !== `file://${process.argv[1]}`) {
  // 被 import（测试）时只暴露解析函数，不跑抓取。
} else {
const all = [];
for (const idx of INDEXES) {
  if (ONLY && idx.id !== ONLY) continue;
  try {
    const body = await (await fetch(idx.url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) })).text();
    const rows = idx.parse(body).filter((r) => TECH_TAGS.test(r.tags));
    console.error(`索引 ${idx.id}：${rows.length} 个候选`);
    all.push(...rows);
  } catch (err) {
    // 单个索引挂掉不该让整轮扩源作废，其他索引照跑。
    console.error(`索引 ${idx.id} 拉取失败：${err.message}`);
  }
}
const byFeed = new Map();
for (const r of all) if (!byFeed.has(r.feed)) byFeed.set(r.feed, r);
const candidates = [...byFeed.values()];
console.error(`合计 ${all.length} 条，去重后 ${candidates.length} 个候选，开始抓 feed…`);

const denied = existsSync(DENYLIST)
  ? new Set(JSON.parse(readFileSync(DENYLIST, 'utf8')).map((d) => d.feed))
  : new Set();
const current = JSON.parse(readFileSync(SOURCES, 'utf8'));
const existing = new Set(current.map((s) => s.feed).filter(Boolean));
/** 同一个博客常有多个 feed 地址（/feed.xml 和 /zh/index.xml），按域名再去一次重。 */
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const existingHosts = new Set(current.filter((s) => s.url).map((s) => host(s.url)));
const results = [];
for (let i = 0; i < candidates.length; i += CONCURRENCY) {
  await Promise.all(candidates.slice(i, i + CONCURRENCY).map(async (row) => {
    if (existing.has(row.feed) || existingHosts.has(host(row.url))) return;
    if (denied.has(row.feed)) return;
    if (PODCAST_HOST.test(row.feed)) return;
    let xml;
    try {
      xml = await get(row.feed, UA);
    } catch (err) {
      if (!/HTTP (403|429)/.test(err.message)) return;
      try { xml = await get(row.feed, BROWSER_UA); } catch { return; }
    }
    if (looksLikeAudio(xml)) return;
    try {
      const verdict = evaluate(xml);
      // 索引里的人工标注常年失修，feed 自己声明的标题更可信。
      if (verdict.ok) results.push({ ...row, ...verdict, name: verdict.feedTitle || row.name || new URL(row.feed).hostname });
    } catch {
      // feed 解析失败的直接丢掉，不值得为一个坏 feed 中断整轮
    }
  }));
  console.error(`  ${Math.min(i + CONCURRENCY, candidates.length)}/${candidates.length}`);
}

results.sort((a, b) => b.hitPosts - a.hitPosts || a.ageDays - b.ageDays);
console.log(`\n=== 命中 ${results.length} 个：近 20 篇里 ≥${MIN_HITS} 篇够上收录线，${ACTIVE_DAYS} 天内活跃，且不是媒体节奏 ===`);
for (const r of results) {
  console.log(`${String(r.hitPosts).padStart(2)}/20 够格 | ${String(r.ageDays).padStart(3)}天前 | 跨${String(r.spanDays).padStart(3)}天 | ${r.name.slice(0, 18).padEnd(18)} | ${r.feed}`);
  const tags = [...r.tools, ...r.topics];
  if (tags.length) console.log(`             ${tags.join(', ')}`);
}

if (MERGE) {
  // 去重集合必须在**写入时**重算。只信启动时那份的话，
  // 同一个脚本跑两次就会把同一批源追加两次——实测踩过，
  // 12 个源各进了两遍。周更体检会反复跑这个脚本，这里必须幂等。
  const sources = JSON.parse(readFileSync(SOURCES, 'utf8'));
  const haveFeed = new Set(sources.map((x) => x.feed).filter(Boolean));
  const haveHost = new Set(sources.filter((x) => x.url).map((x) => host(x.url)));
  let added = 0;
  for (const r of results) {
    if (haveFeed.has(r.feed) || haveHost.has(host(r.url))) continue;
    haveFeed.add(r.feed);
    haveHost.add(host(r.url));
    added += 1;
    sources.push({
      name: r.name, url: r.url, feed: r.feed, kind: 'blog', enabled: true,
      desc: `中文独立博客，近 20 篇里有 ${r.hitPosts} 篇够上收录线${r.tools.length ? `（${r.tools.slice(0, 4).join('/')}）` : ''}。`,
    });
  }
  writeFileSync(SOURCES, JSON.stringify(sources, null, 2) + '\n');
  console.log(`\n已并入 ${added} 个（跳过 ${results.length - added} 个重复），现共 ${sources.length} 个源`);
}
}
