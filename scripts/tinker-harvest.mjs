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
import { UA, BROWSER_UA, declaredFeeds, gradeFeed } from '../lib/tinker/probe.mjs';

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
  /**
   * 第五个索引，2026-08-06 加。
   *
   * 前四个已经榨干了：同样 2986 个 feed 连扫四轮，命中数 19 → 12 → 7 → 0（第四轮的
   * 7 个全部是第三轮的落选者）。LESSONS 写着「别再跑同样的 harvest，去找第五个索引」，
   * 这就是那第五个：1328 条 feed 的单文件 OPML，格式和 blogcn 一样，直接复用 parseOpml。
   * 重叠肯定有（都是中文博客圈），但去重和 denylist 都在下游，白扫的成本只是几分钟。
   */
  {
    id: 'lotosbin',
    url: 'https://raw.githubusercontent.com/lotosbin/opml-list/master/data/feed.opml',
    parse: parseOpml,
  },
  /**
   * 第六个索引，2026-08-07 加。shidenggui/bloghub（独立博客导航站的后端数据）。
   *
   * 和 timqian 同一份 CSV 表头（Introduction, Address, RSS feed, tags, Ignore），
   * 直接复用 parseCsv。376 条 feed，和 timqian 的 1331 条比对过：
   * **重叠 223 条，净新增 153 条**——不算多，但它是另一拨人按另一套标准挑的
   * （收录标准写着「原创内容，有一定比例的非技术内容」，偏向真人博客而非技术媒体），
   * 正是 LESSONS 说的「扩源缺的是名录」那类增量。
   */
  {
    id: 'bloghub',
    url: 'https://raw.githubusercontent.com/shidenggui/bloghub/master/backend/assets/blogs-original.csv',
    parse: parseCsv,
  },
  /**
   * 第七个索引，2026-08-28 加：qianguyihao/blog-list（中文博客琅琊榜，605 站）。
   * LESSONS 里它从 2026-08-06 起就挂着「待接」，一直没接。
   *
   * 接它有两个理由和前六个都不同：
   *   1) 收录标准是「持续更新、高质量、阅读体验良好」，而且**明确不接受自荐**——
   *      timqian 那份是自荐 PR 攒出来的，两者的偏差方向天然不同。
   *   2) 它**按主题分了目录**，有一页就叫「五、人工智能」。前六个索引全是一锅端，
   *      这是第一个能只订它的相关分区的名录。
   * 所以这里只接三个分区（人工智能 / 技术博客 / 数字花园），别的（人间烟火、
   * 经典重温、术业专攻）不碰——它们不是这个项目要的东西，扫了也是白扫。
   *
   * 但接它之前先撞上了一件事，见 parseSiteList 的注释：**这份索引列的是站点，不是 feed。**
   */
  ...['05-人工智能', '06-技术博客', '04-数字花园'].map((page) => ({
    id: `qianguyihao-${page.slice(0, 2)}`,
    url: `https://raw.githubusercontent.com/qianguyihao/blog-list/master/${encodeURIComponent(page)}.md`,
    parse: parseSiteList,
  })),
  /**
   * 第八个索引，2026-08-31 周更体检加：fuxiaoai/tidings-rss（718 源的目录，
   * 分 14 类，README 里就是一张全表，`Catalog last checked: 2026-08-20`）。
   *
   * LESSONS 写着「社区索引这条路已经榨干，别再接第七个了」——那条结论 08-28 接
   * qianguyihao 时就已经被数据推翻过一次（174 个候选并入 8 个，命中率 4.6%，
   * 比友链页收尾那轮高一个量级）。这里是第二次：判据不是「还能不能找到名录」，
   * 是**这份名录是不是另一拨人按另一套标准挑的**。
   *
   * 先过 LESSONS 那两道准入问：
   *   1) **按字节数比一遍，确认不是镜像**（`awesome-rss-feeds` 那次的教训）：
   *      README 153356 字节，和在用的 `awesome-rss-feeds-list/LIST.md`（216297）
   *      不是同一份文件，格式也完全不同（这份是带 tag 列的 Markdown 表）。
   *   2) **它是不是只是同一批人**：470 行带 `chinese` 标签，其中 61 行归在
   *      `Personal Blogs`、279 行归在 `Engineering & Technology`；抽出来的
   *      373 个非公众号域名里有 watermelonabc / geofftools / ystyle / innei /
   *      dorck / mingnify / ryanuo / tw93 / sjdhome 这些**已经在 sources.json 里**的，
   *      说明重叠是真的存在，但那也正说明这份表的口味对得上。
   *
   * **只取带 `chinese` 标签的行**，理由和 qianguyihao 只接三个分区不同：
   * 那次筛的是主题（而 LESSONS 提醒过「分区选的是名录作者的分类法，不是你的」），
   * 这次筛的是**语种**——这份刊物是中文的，英文源进来一律撞 `MIN_CJK_RATIO`，
   * 扫它们只是白花四百次请求。语种不是口味判断，没有那条坑。
   *
   * 用 `parseSiteList` 不用 `parseMarkdown`：表里每行既有主页链接又有 `[RSS](…)`，
   * 前者按 host 归并、显式 RSS 优先，正是 08-28 那条「索引有两种形状」要的形状。
   * 顺带把 wechat2rss 那批公众号行一起滤掉——LESSONS 里
   * 「微信公众号（wechat2rss 免费列表）」是已探明不通的路。
   */
  {
    id: 'tidings',
    url: 'https://raw.githubusercontent.com/fuxiaoai/tidings-rss/main/README.md',
    parse: (text) => parseSiteList(
      text.split('\n')
        .filter((l) => l.startsWith('|') && /(^|[ ,|])chinese([ ,|]|$)/.test(l) && !/wechat/i.test(l))
        .join('\n'),
    ),
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

/**
 * 不属于任何人的博客的域名：平台、商店、社交、公司官网、工具站。
 * 站点列表型索引里这些混得比 feed 列表型多得多——正文里随手引一个链接就进来了。
 */
const NOT_A_BLOG = /(^|\.)(github|githubusercontent|gitee|gitlab|twitter|x|zhihu|juejin|csdn|cnblogs|segmentfault|oschina|bilibili|weibo|douban|jianshu|medium|substack|youtube|youtu|wikipedia|apple|google|microsoft|baidu|jd|taobao|tmall|amazon|instagram|facebook|linkedin|telegram|discord|npmjs|w3|mozilla|vercel|netlify|cloudflare|notion|figma|okjike|okjk|xiaoyuzhoufm|ximalaya|visualstudio|gohugo|astro|hexo|wordpress|typora|16personalities|openart|gaoding)\.[a-z.]+$/i;

/**
 * 站点列表：一份索引可以列 feed，也可以只列**主页**。
 *
 * 2026-08-28 接 qianguyihao/blog-list 时撞上的：那份索引 605 个站，正文里几乎全是
 * `- https://example.com/` 这样的主页地址，只有少数条目额外附一行「RSS 订阅」。
 * 拿 parseMarkdown（只认 URL 形态像 feed 的）去读它三个分区的结果是
 * **217 个域名里只抽出 8 条**——96% 静默丢掉，而且丢掉的方式和「这个索引没什么增量」
 * 长得一模一样：命中数低，日志上一句话都不会多说。
 * （形状同 LESSONS 那条「凡是靠『返回空』判断结束的循环都要交叉验证」：
 * 解析器读不动和索引真的没货，输出是同一个数字。）
 *
 * 所以这里返回 `feed: null`，把「这个站的 feed 在哪」推迟到下游去探。
 */
export function parseSiteList(text) {
  /** host → { origin, feed }。同一个站在索引里常出现好几次（主页、某篇文章、RSS 那一行）。 */
  const byHost = new Map();
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) {
    const raw = m[0].replace(/[.,;、）]+$/, '');
    let u;
    try { u = new URL(raw); } catch { continue; }
    const h = u.hostname.replace(/^www\./, '');
    if (NOT_A_BLOG.test(h)) continue;
    // 索引里同一个人可能既给主页又给某篇文章的深链，一律退回站点根——
    // 探 feed 要的是站点，不是那一篇。
    const row = byHost.get(h) ?? { name: '', url: u.origin, feed: null, tags: '技术' };
    // 显式写出来的 RSS 地址永远优于我们猜的，哪怕它排在主页后面才出现。
    if (FEED_LIKE.test(raw) && !row.feed) row.feed = raw;
    byHost.set(h, row);
  }
  return [...byHost.values()];
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

/** 探 feed 时先试站点自己声明的，再试这几条常见路径。顺序即优先级。 */
const QUICK_FEED_PATHS = ['feed', 'atom.xml', 'index.xml', 'rss.xml', 'feed.xml'];
const PROBE_TIMEOUT_MS = Number(process.env.HARVEST_PROBE_TIMEOUT_MS ?? 6000);

/**
 * 给一个只有主页的候选找 feed。找不到就返回 null，调用方直接跳过——
 * 「探不到 feed」和「feed 不够格」在这条管线里是同一个结果，不必区分。
 */
async function resolveFeed(siteUrl) {
  const attempts = [];
  try {
    const html = await fetch(siteUrl, {
      headers: { 'user-agent': BROWSER_UA, accept: 'text/html,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    }).then((r) => (r.ok ? r.text() : ''));
    attempts.push(...declaredFeeds(html, siteUrl));
  } catch {
    // 首页挂了仍然试常见路径：有的站首页是 JS 壳，feed 却是静态文件。
  }
  const base = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`;
  for (const p of QUICK_FEED_PATHS) {
    try { attempts.push(new URL(p, base).toString()); } catch { /* ignore */ }
  }
  const tried = [...new Set(attempts)].slice(0, 6);
  const hits = await Promise.all(tried.map(async (url) => {
    try {
      const xml = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      }).then((r) => (r.ok ? r.text() : ''));
      return gradeFeed(xml).ok ? url : null;
    } catch { return null; }
  }));
  // 保持 tried 的顺序：声明的 feed 排在穷举的前面，站点主 feed 优先。
  return hits.find(Boolean) ?? null;
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
export function evaluate(xml) {
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

/**
 * denylist → 被否决的域名集合。
 *
 * 否决要按**域名**生效，不能只认那一条 feed URL：api.xgo.ing 这类 RSS 网关
 * 每个用户一条 `/rss/user/<hash>`，2026-08-03 否掉的是 `.../user/5b632b7f…`，
 * 2026-08-04 harvest 拿着 `.../user/665fc884…` 又提名了一次——同一个站能生成
 * 无限条互不相同的 URL，逐条记永远追不上。
 * 例外是 wechat2rss 这种一个域名下挂几百个互不相干公众号的聚合网关：
 * 那里否的是某个号不是整个域名，用 `scope: "feed"` 标出来单独放行。
 *
 * **2026-08-31 周更体检修的那半：只读 `d.feed` 会漏掉 denylist 里 16% 的条目。**
 * 这份账本有两种写法——早期（wechat2rss 那批）记 `feed`，而从 08-21 起凡是
 * 「探到一个站点、判它不够格」落下来的都记 `url`（75 条里 12 条），
 * 因为落盘那一刻手上根本没有 feed 地址。两个 key 一直并存，而读的人只认前一个，
 * 于是那 12 条**从写下那天起就没生效过**。
 * 症状今天当场量到：本轮 harvest 4 个命中里有 2 个（imsuk.cn、fuwari.oh1.top）
 * 是 08-24 亲手否掉并写进 denylist 的，命中列表里一字不差地又提名了一遍。
 * 这是 LESSONS 那条「否决要记到机器会读的地方」的第四次复发，
 * 前三次错在**没记**，这次错在**记了、读的人只读了一半**——
 * 08-21 写 `tinker-authorsites.mjs` 时用的就是 `d.feed ?? d.url ?? d.domain`，
 * 只是没有人回头把先写的两个发现脚本一起改。
 *
 * 所以这里导出一份实现给 `tinker-blogroll.mjs` 共用：这个洞的成因正是
 * 「同一个判据在两个脚本里各写了一遍，其中一个没跟上」。
 */
export function deniedHostsFrom(denylist) {
  const h = (u) => {
    const s = String(u ?? '').trim();
    if (!s) return null;
    try { return new URL(s).hostname.replace(/^www\./, ''); } catch { /* 不是完整 URL，往下走 */ }
    // `domain` 那一类记的是裸主机名（`c.com`），`new URL()` 会直接抛。
    // 只认「像主机名」的形状，免得把随手写的一句话变成一个假域名混进集合。
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s) ? s.toLowerCase().replace(/^www\./, '') : null;
  };
  return new Set(
    (denylist ?? [])
      .filter((d) => d.scope !== 'feed')
      .map((d) => h(d.feed ?? d.url ?? d.domain ?? ''))
      .filter(Boolean),
  );
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
// 键要能容下 feed 为 null 的行（站点列表型索引），否则第一条之后全被当成重复丢掉。
const byFeed = new Map();
for (const r of all) { const k = r.feed ?? r.url; if (!byFeed.has(k)) byFeed.set(k, r); }
const candidates = [...byFeed.values()];
console.error(`合计 ${all.length} 条，去重后 ${candidates.length} 个候选，开始抓 feed…`);

/** 同一个博客常有多个 feed 地址（/feed.xml 和 /zh/index.xml），按域名再去一次重。 */
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const denylist = existsSync(DENYLIST) ? JSON.parse(readFileSync(DENYLIST, 'utf8')) : [];
const denied = new Set(denylist.map((d) => d.feed ?? d.url).filter(Boolean));
/** 否决按域名生效，两种 key 都读。判据和理由见 `deniedHostsFrom` 的注释。 */
const deniedHosts = deniedHostsFrom(denylist);
const current = JSON.parse(readFileSync(SOURCES, 'utf8'));
const existing = new Set(current.map((s) => s.feed).filter(Boolean));
/**
 * 「已经收录了」也按域名比，而且 `url` 和 `feed` 两边都要比。
 *
 * 2026-08-31 周更体检量到的：本轮最高分候选 heyuanfei.com（15/20）其实**早就在
 * sources.json 里**，只是订的是 `leonhe.cn`——同一个站的两个域名，两份 feed
 * 字节数完全相同（188722，113 条），每一条 <link> 指向的都是 heyuanfei.com。
 * 这道闸原来只比 `s.url` 的主机名，两个域名不同名，于是它被当成新候选提名了一遍，
 * 差一点就把同一个作者收成两个源（LESSONS 里「同一个人被拆成两个站」那一族的第四个变体：
 * 前三个是按主题分站、按时间搬家、同一个平台报两次名，这次是**一个站挂两个域名**）。
 * 治本的一半已经做了（把那条源的 url/feed 改成正的那个域名），
 * 这里是治标的一半：两个字段的主机名都进集合，下次换个字段写也拦得住。
 */
const existingHosts = new Set(
  current.flatMap((s) => [s.url, s.feed]).filter(Boolean).map((u) => host(u)).filter(Boolean),
);
const results = [];
for (let i = 0; i < candidates.length; i += CONCURRENCY) {
  await Promise.all(candidates.slice(i, i + CONCURRENCY).map(async (row) => {
    if (existingHosts.has(host(row.url))) return;
    if (deniedHosts.has(host(row.url))) return;
    // 只列主页的索引：先探一次 feed 在哪。用的是 blogroll 那套「首页拿
    // <link rel=alternate>，拿不到就试几条常见路径」的快探法，而不是
    // probeSite()——后者串行试十来条路径、每条 15 秒超时，一个死站三分多钟
    // （LESSONS：探上千个候选时不能用 probeSite）。
    if (!row.feed) {
      const found = await resolveFeed(row.url);
      if (!found) return;
      row = { ...row, feed: found };
    }
    if (existing.has(row.feed)) return;
    if (denied.has(row.feed) || deniedHosts.has(host(row.feed))) return;
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
