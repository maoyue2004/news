import { htmlToText } from '../html-text.mjs';

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

/** 掘金搜索。匿名可调，无需 cookie。id_type=2 表示只搜文章。 */
export async function searchJuejin(query, { ua, limit = 20 } = {}) {
  const url = 'https://api.juejin.cn/search_api/v1/search'
    + `?aid=2608&spider=0&query=${encodeURIComponent(query)}`
    + `&id_type=2&cursor=0&limit=${limit}&search_type=0&sort_type=0&version=1`;
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

const SEARCHERS = {
  juejin: (query, opts) => searchJuejin(query, opts),
  v2ex: (query, opts) => searchV2ex(query, opts),
  discourse: (query, opts) => searchDiscourse(query, opts),
  segmentfault: (query, opts) => searchSegmentFault(query, opts),
};

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

  const byLink = new Map();
  const failures = [];
  for (const query of queries) {
    try {
      const rows = await searcher(query, { ua, origin: source.origin, afterDate, limit: source.limit ?? 20 });
      for (const row of rows) {
        if (!row.link || byLink.has(row.link)) continue;
        byLink.set(row.link, { ...row, contentHtml: htmlToText(row.contentHtml, 2000), query });
      }
    } catch (err) {
      failures.push(`${query}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, source.delayMs ?? 400));
  }
  if (failures.length === queries.length) {
    throw new Error(`全部 ${queries.length} 个查询失败，例如 ${failures[0]}`);
  }
  return { items: [...byLink.values()], failures };
}
