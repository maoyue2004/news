import { htmlToText } from '../html-text.mjs';
import { TOOLS, TOPICS } from './vocab.mjs';

/**
 * 搜索型信源。
 *
 * 和 feed 型信源的根本区别：feed 是「这个作者最近写了什么」，搜索是「全站有谁写了这个主题」。
 * 个人博客月更、且十篇里可能只有一篇聊 agent，光靠 feed 覆盖不到主题的长尾；
 * 反过来，平台的 latest feed 又全是无关内容。搜索型源填的正是这块。
 *
 * 每个适配器统一返回 collect.mjs 认识的 raw 形状：{ title, link, publishedAt, contentHtml }。
 */

const DEFAULT_TIMEOUT = 20000;

async function getJson(url, { ua, timeout = DEFAULT_TIMEOUT, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': ua, accept: 'application/json, */*', ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // Cloudflare 挑战页会以 200 返回 HTML。当作失败处理，否则会被记成「搜到 0 条」，
    // 把一次访问受阻误报成「今天没人写这个主题」。
    throw new Error('返回的不是 JSON（可能是反爬挑战页）');
  }
}

function iso(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * 掘金搜索。匿名可调，无需 cookie。id_type=2 表示只搜文章。
 *
 * `sort_type=1`（最新）不是可选项，是必需的。原来用的 `sort_type=0`（综合排序）
 * 返回的是历史高热文章，2026-08-03 实测：「Claude Code 踩坑」20 条结果里
 * **21 天窗口内 0 条**，最新一条是 6-19；换成 sort_type=1 之后同一个词
 * 20 条里 18 条在窗口内，最新就是当天。sort_type=2（最热）和 0 一样是 0 条。
 *
 * 这解释了一个一直没查清的现象：轮转派生出来的长尾查询词看起来「长期零产出」。
 * 那不是没人写这些主题，是掘金只肯把几个月前的热文排在前面，
 * 而下游 `collectRaw` 有 21 天窗口，于是整批被丢掉。
 * 同一轮 30 个查询里 23 个零产出，全部是派生词，而 6 个核心词都有货——
 * 这个过于整齐的分布正是这个 bug 的指纹（核心词热度高，老文章里也混得进新的）。
 */
export async function searchJuejin(query, { ua, limit = 20 } = {}) {
  const url = 'https://api.juejin.cn/search_api/v1/search'
    + `?aid=2608&spider=0&query=${encodeURIComponent(query)}`
    + `&id_type=2&cursor=0&limit=${limit}&search_type=0&sort_type=1&version=1`;
  const data = await getJson(url, { ua });
  if (data.err_no) throw new Error(`掘金返回 err_no=${data.err_no} ${data.err_msg ?? ''}`);
  const out = [];
  for (const row of data.data ?? []) {
    const info = row.result_model?.article_info;
    if (!info?.article_id || !info.title) continue;
    const author = row.result_model?.author_user_info?.user_name;
    out.push({
      title: info.title,
      link: `https://juejin.cn/post/${info.article_id}`,
      publishedAt: iso(Number(info.ctime) * 1000),
      contentHtml: info.brief_content ?? '',
      author,
      metrics: { views: info.view_count, likes: info.digg_count, comments: info.comment_count },
    });
  }
  return out;
}

/** V2EX 全站搜索。官方无搜索 API，sov2ex 是社区维护的 ES 索引，匿名可用。 */
export async function searchV2ex(query, { ua, limit = 20 } = {}) {
  const url = `https://www.sov2ex.com/api/search?q=${encodeURIComponent(query)}&size=${limit}&sort=created`;
  const data = await getJson(url, { ua });
  const out = [];
  for (const hit of data.hits ?? []) {
    const s = hit._source ?? {};
    if (!s.id || !s.title) continue;
    out.push({
      title: s.title,
      link: `https://www.v2ex.com/t/${s.id}`,
      // sov2ex 的 created 是不带时区的 ISO 串，实测对应 UTC。
      publishedAt: iso(`${s.created}Z`),
      contentHtml: s.content ?? '',
      author: s.member,
      metrics: { comments: Number(s.replies) || 0 },
    });
  }
  return out;
}

/**
 * Discourse 论坛搜索（小众软件 meta、linux.do 等都是 Discourse）。
 * 用 after: 限定时间窗，否则搜索默认按相关度返回多年前的老帖，
 * 每天都会把同一批历史帖重新捞一遍。
 */
export async function searchDiscourse(query, { ua, origin, afterDate, limit = 20 } = {}) {
  const q = afterDate ? `${query} after:${afterDate}` : query;
  const url = `${origin}/search.json?q=${encodeURIComponent(q)}`;
  const data = await getJson(url, { ua });
  const blurbByTopic = new Map();
  for (const p of data.posts ?? []) {
    if (!blurbByTopic.has(p.topic_id)) blurbByTopic.set(p.topic_id, p.blurb ?? '');
  }
  const out = [];
  for (const t of (data.topics ?? []).slice(0, limit)) {
    if (!t.id || !t.title) continue;
    out.push({
      title: t.title,
      link: `${origin}/t/topic/${t.id}`,
      publishedAt: iso(t.created_at),
      contentHtml: blurbByTopic.get(t.id) ?? '',
      metrics: { comments: t.posts_count ?? 0 },
      tags: t.tags ?? [],
    });
  }
  return out;
}

/**
 * SegmentFault 搜索。
 *
 * 它没有开放 API，但搜索页是 Next.js 服务端渲染的，结果就躺在 __NEXT_DATA__ 里，
 * 比解析 DOM 稳得多——页面改版会动 class 名，不太会动这个数据结构。
 * 试过但不通的同类：知乎 search_v3（要签名头）、CSDN so.csdn.net（反爬）、
 * 博客园 zzk（客户端渲染）、rsshub.app（Cloudflare 403）。
 */
export async function searchSegmentFault(query, { ua, limit = 20 } = {}) {
  const url = `https://segmentfault.com/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'user-agent': ua, accept: 'text/html,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const m = /__NEXT_DATA__[^>]*>(\{[\s\S]*?\})<\/script>/.exec(html);
  if (!m) throw new Error('页面里没有 __NEXT_DATA__（可能改版或被反爬挡了）');
  let rows;
  try {
    rows = JSON.parse(m[1]).props.pageProps.initialState.search.result.rows ?? [];
  } catch (err) {
    throw new Error(`解析 __NEXT_DATA__ 失败：${err.message}`);
  }
  const out = [];
  for (const row of rows.slice(0, limit)) {
    if (row.type !== 'article') continue;
    const c = row.contents ?? {};
    if (!c.url || !c.title) continue;
    out.push({
      title: c.title,
      link: new URL(c.url, 'https://segmentfault.com').href,
      publishedAt: iso(Number(c.created) * 1000),
      contentHtml: c.excerpt ?? '',
      metrics: { comments: Number(c.comments) || 0, votes: Number(c.votes) || 0 },
    });
  }
  return out;
}

/**
 * 方格子 vocus（台湾最大的中文写作平台）。
 *
 * 它和上面四个的区别是**没有全文搜索**：`/api/search?q=` 和 `/api/search/contents?q=`
 * 都恒返回空数组（2026-08-15 实测），网页上的 `/search` 路径直接 404。
 * 能用的只有标签：`api.vocus.cc/api/contents?tag=<标签>&sort=publishAt&order=desc`。
 *
 * 所以这个适配器把「查询词」翻译成「标签」：从查询词里认出词表里的产品/概念名，
 * 拿它当标签发请求。派生查询词的形状是 `<名字> <实践词>`，所以这一步等价于
 * 把后缀削掉；认不出名字的查询词直接跳过（返回空，不算失败）——
 * 手写的长尾词（「AI 编程 踩坑」这类）在标签体系里本来就没有对应物。
 *
 * 标签是用户手打的，同一个产品会有带空格和不带空格两种写法，实测差别很大：
 * `Claude Code` 只有 4 条，`ClaudeCode` 有 15 条。两种都发，合并去重。
 *
 * **按 publishAt 降序是必需的**，理由和掘金 `sort_type=1` 那条完全一样
 * （见 `searchJuejin` 的注释）：没有时间排序的平台搜索不能要。
 *
 * 付费文章（`isPay`）跳过：正文补全拿不到，读者点过去也是一堵墙。
 */
const VOCUS_TAG_CACHE = new Map();

export function vocusTagsFor(query, vocabNames) {
  const q = String(query ?? '').toLowerCase();
  // 最长优先：`Claude Code` 和 `Codex` 同时出现在「Claude Code 指挥 Codex」这类词里时，
  // 取更长的那个才是这条查询真正在问的东西。
  const hit = [...vocabNames]
    .sort((a, b) => b.length - a.length)
    .find((name) => q.includes(name.toLowerCase()));
  if (!hit) return [];
  const compact = hit.replace(/\s+/g, '');
  return compact === hit ? [hit] : [hit, compact];
}

export async function searchVocus(query, { ua, limit = 20, vocabNames = [] } = {}) {
  const out = [];
  const seen = new Set();
  for (const tag of vocusTagsFor(query, vocabNames)) {
    let rows = VOCUS_TAG_CACHE.get(tag);
    if (!rows) {
      const url = 'https://api.vocus.cc/api/contents'
        + `?num=${limit}&order=desc&page=1&sort=publishAt&tag=${encodeURIComponent(tag)}`;
      const data = await getJson(url, { ua });
      rows = data.contents ?? [];
      VOCUS_TAG_CACHE.set(tag, rows);
    }
    for (const row of rows) {
      const id = row.contentId ?? row._id;
      if (!id || !row.title || seen.has(id)) continue;
      if (row.isPay || row.article?.isPay) continue;
      seen.add(id);
      out.push({
        title: row.title,
        link: `https://vocus.cc/article/${id}`,
        publishedAt: iso(row.publishAt),
        contentHtml: row.article?.abstract ?? '',
        metrics: { views: row.pageview, likes: row.likeCount, comments: row.commentCount },
        tags: row.tags ?? [],
      });
    }
  }
  return out;
}

const SEARCHERS = {
  juejin: (query, opts) => searchJuejin(query, opts),
  v2ex: (query, opts) => searchV2ex(query, opts),
  discourse: (query, opts) => searchDiscourse(query, opts),
  segmentfault: (query, opts) => searchSegmentFault(query, opts),
  vocus: (query, opts) => searchVocus(query, opts),
};

/** 标签型平台（目前只有 vocus）用它把查询词还原成产品/概念名。 */
const VOCAB_NAMES = [...TOOLS, ...TOPICS].map((t) => t.name);

export function isSearchSource(source) {
  return Boolean(source.search) && Object.hasOwn(SEARCHERS, source.search);
}

/**
 * 跑一个搜索源的一批查询词，合并去重。
 * 单个查询失败不算整源失败——搜索接口偶发超时很常见，
 * 只有全部查询都失败才向上抛，避免把一次抖动记成源挂了。
 */
export async function fetchSearchItems({ source, queries, ua, afterDate }) {
  const searcher = SEARCHERS[source.search];
  if (!searcher) throw new Error(`未知的搜索适配器：${source.search}`);

  /**
   * 每轮最多发几个查询。不写就是全发。
   *
   * 2026-08-11 加。小众软件论坛搜索「30 个查询挂 15 个」从创刊起天天记在
   * REVIEW 的「抓取失败」里，一直被当成「老问题，长期如此」——实测下来它不是
   * 站点抽风，是 **Discourse 的匿名搜索限流**：连发 30 个查询，实测第 8 个前后
   * 开始返回 `HTTP 429`（响应体是中文的「您执行此操作的次数过多」，
   * 没有 Retry-After 头可依），当轮 30 个里 23 个全部 429。
   *
   * 也就是说这个源每天有七成以上的查询是**发出去就注定被拒**的：白等 400ms×23、
   * 白占一次出口请求，还把「部分查询失败」这条噪声天天写进错误列表，
   * 掩盖掉真正该被看见的失败。
   *
   * 不改成「429 就退避重试」，是因为退避要按分钟计（限流窗口是分钟级），
   * 而这个源在近 10 天里收录数是 0——为它给日更管线加几分钟等待不划算。
   * 改成按额度截断：发得出去的照发，发不出去的干脆不发。
   * 轮转池每天切片不同，所以被截掉的词第二天仍有机会轮到。
   */
  const limit = source.maxQueries ?? queries.length;
  const byLink = new Map();
  const failures = [];
  for (const query of queries.slice(0, limit)) {
    try {
      const rows = await searcher(query, {
        ua,
        origin: source.origin,
        afterDate,
        limit: source.limit ?? 20,
        vocabNames: VOCAB_NAMES,
      });
      for (const row of rows) {
        if (!row.link || byLink.has(row.link)) continue;
        byLink.set(row.link, { ...row, contentHtml: htmlToText(row.contentHtml, 2000), query });
      }
    } catch (err) {
      failures.push(`${query}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, source.delayMs ?? 400));
  }
  // 「整源失败」要按**实际发出去的**条数判，不能拿轮转池的总数当分母——
  // 截断之后两者不再相等，用总数会让一个全挂的源被当成部分失败混过去。
  const attempted = Math.min(limit, queries.length);
  if (attempted > 0 && failures.length === attempted) {
    throw new Error(`全部 ${attempted} 个查询失败，例如 ${failures[0]}`);
  }
  return { items: [...byLink.values()], failures, attempted };
}
