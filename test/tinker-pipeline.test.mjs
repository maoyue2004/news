import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectRaw } from '../lib/tinker/collect.mjs';
import { searchJuejin, searchV2ex, searchDiscourse, searchSegmentFault, fetchSearchItems } from '../lib/tinker/search-adapters.mjs';
import { declaredFeeds, candidateFeedUrls, gradeFeed } from '../lib/tinker/probe.mjs';
import { buildHtml, validate } from '../scripts/tinker-build.mjs';
import { needsEnrich, enrich, fetchAllSources, threadBodyHtml } from '../scripts/tinker-fetch.mjs';

const src = { name: '测试源', kind: 'blog' };
const today = '2026-08-01';
const now = '2026-08-01T00:00:00.000Z';

test('collectRaw 保留 author / metrics / tags / matchedQuery', () => {
  const [item] = collectRaw({
    source: src, seen: {}, today, now,
    raw: [{
      title: '标题', link: 'https://e.com/a', publishedAt: now, contentHtml: '<p>正文</p>',
      author: '张三', metrics: { views: 10 }, tags: ['ai'], query: 'Claude Code 实践',
    }],
  });
  assert.equal(item.author, '张三');
  assert.deepEqual(item.metrics, { views: 10 });
  assert.deepEqual(item.tags, ['ai']);
  assert.equal(item.matchedQuery, 'Claude Code 实践');
  assert.equal(item.excerpt, '正文');
});

test('collectRaw 丢掉超出时间窗和已见过的条目', () => {
  const raw = [
    { title: '新', link: 'https://e.com/new', publishedAt: now, contentHtml: '' },
    { title: '旧', link: 'https://e.com/old', publishedAt: '2026-06-01T00:00:00Z', contentHtml: '' },
    { title: '见过', link: 'https://e.com/seen', publishedAt: now, contentHtml: '' },
  ];
  const seenId = collectRaw({ source: src, raw: [raw[2]], seen: {}, today, now })[0].id;
  const got = collectRaw({ source: src, raw, seen: { [seenId]: today }, today, now });
  assert.deepEqual(got.map((i) => i.titleOriginal), ['新']);
});

test('collectRaw 同一次运行内同链接只留一条', () => {
  const raw = [
    { title: 'A', link: 'https://e.com/x', publishedAt: now, contentHtml: '' },
    { title: 'B', link: 'https://e.com/x?utm_source=rss', publishedAt: now, contentHtml: '' },
  ];
  assert.equal(collectRaw({ source: src, raw, seen: {}, today, now }).length, 1);
});

/* ---- 搜索适配器：用桩 fetch 验证字段映射，不打真实接口 ---- */

function stubFetch(payload, { status = 200, body = null } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: status < 400, status,
    text: async () => (body ?? JSON.stringify(payload)),
  });
  return () => { globalThis.fetch = original; };
}

test('searchJuejin 把 ctime 秒级时间戳转成 ISO，并拼出文章链接', async () => {
  const restore = stubFetch({
    err_no: 0,
    data: [{
      result_model: {
        article_info: { article_id: '123', title: '标题', brief_content: '摘要', ctime: '1785600000', view_count: 900, digg_count: 3 },
        author_user_info: { user_name: '作者' },
      },
    }],
  });
  try {
    const [item] = await searchJuejin('Claude Code');
    assert.equal(item.link, 'https://juejin.cn/post/123');
    assert.equal(item.publishedAt, new Date(1785600000 * 1000).toISOString());
    assert.equal(item.author, '作者');
    assert.equal(item.metrics.views, 900);
  } finally { restore(); }
});

test('searchJuejin 必须按最新排序，不能用综合排序', async () => {
  // sort_type=0（综合）返回的是历史高热文章：2026-08-03 实测「Claude Code 踩坑」
  // 20 条里 21 天窗口内 0 条，最新一条是 6-19，整批被下游的时间窗丢掉。
  // 这曾让一整批派生查询词看起来「长期零产出」，实际是排序参数选错了。
  let seen = null;
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen = String(url);
    return { ok: true, status: 200, text: async () => JSON.stringify({ err_no: 0, data: [] }) };
  };
  try {
    await searchJuejin('Claude Code 踩坑');
    assert.match(seen, /sort_type=1(&|$)/);
  } finally { globalThis.fetch = original; }
});

test('searchJuejin 在 err_no 非零时抛错，不静默返回空', async () => {
  const restore = stubFetch({ err_no: 403, err_msg: 'forbidden', data: [] });
  try {
    await assert.rejects(() => searchJuejin('x'), /err_no=403/);
  } finally { restore(); }
});

test('searchV2ex 把无时区的 created 当 UTC 处理', async () => {
  const restore = stubFetch({ hits: [{ _source: { id: '999', title: '帖子', content: '正文', created: '2026-07-31T11:35:13', member: 'someone', replies: '4' } }] });
  try {
    const [item] = await searchV2ex('Cursor');
    assert.equal(item.link, 'https://www.v2ex.com/t/999');
    assert.equal(item.publishedAt, '2026-07-31T11:35:13.000Z');
    assert.equal(item.metrics.comments, 4);
  } finally { restore(); }
});

test('searchDiscourse 把 posts 的 blurb 贴回对应 topic', async () => {
  const restore = stubFetch({
    posts: [{ topic_id: 7, blurb: '这是正文摘要' }, { topic_id: 7, blurb: '第二楼，不该覆盖第一楼' }],
    topics: [{ id: 7, title: '主题', created_at: '2026-07-25T00:00:00Z', posts_count: 9, tags: ['mcp'] }],
  });
  try {
    const [item] = await searchDiscourse('MCP', { origin: 'https://meta.example.net' });
    assert.equal(item.link, 'https://meta.example.net/t/topic/7');
    assert.equal(item.contentHtml, '这是正文摘要');
    assert.deepEqual(item.tags, ['mcp']);
  } finally { restore(); }
});

test('搜索接口返回 HTML 挑战页时按失败处理，而不是「搜到 0 条」', async () => {
  const restore = stubFetch(null, { body: '<html><title>Just a moment...</title></html>' });
  try {
    await assert.rejects(() => searchV2ex('x'), /不是 JSON/);
  } finally { restore(); }
});

test('searchSegmentFault 从 __NEXT_DATA__ 取结果，跳过非文章类型', async () => {
  const payload = {
    props: { pageProps: { initialState: { search: { result: { rows: [
      { type: 'article', contents: { title: '标题', url: '/a/1190000047730945', excerpt: '摘要', created: 1777166221, comments: 3, votes: 5 } },
      { type: 'question', contents: { title: '提问', url: '/q/123', created: 1777166221 } },
    ] } } } } },
  };
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    text: async () => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script>`,
  });
  try {
    const items = await searchSegmentFault('Claude Code');
    assert.equal(items.length, 1, '只收 article 类型');
    assert.equal(items[0].link, 'https://segmentfault.com/a/1190000047730945');
    assert.equal(items[0].publishedAt, new Date(1777166221 * 1000).toISOString());
    assert.equal(items[0].metrics.votes, 5);
  } finally { globalThis.fetch = original; }
});

test('searchSegmentFault 在页面结构变了时抛错，而不是当成搜到 0 条', async () => {
  // 它靠的是 Next.js 的内嵌数据，改版就会失效——必须报错，
  // 否则会被记成「今天没人写这个主题」，静默少一个源。
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '<html>改版了</html>' });
  try {
    await assert.rejects(() => searchSegmentFault('x'), /__NEXT_DATA__/);
  } finally { globalThis.fetch = original; }
});

/* ---- 探测器 ---- */

test('declaredFeeds 认得不带引号的 type 属性', () => {
  const html = '<link rel=alternate type=application/rss+xml href="/feed/rss/">';
  assert.deepEqual(declaredFeeds(html, 'https://blog.example.net/'), ['https://blog.example.net/feed/rss/']);
});

test('declaredFeeds 忽略非 feed 的 alternate（比如 hreflang）', () => {
  const html = '<link rel="alternate" hreflang="zh-hant" href="https://e.io/zh-hant"/>';
  assert.deepEqual(declaredFeeds(html, 'https://e.io/'), []);
});

test('candidateFeedUrls 同时试子路径和站点根', () => {
  const urls = candidateFeedUrls('https://e.com/blog/');
  assert.ok(urls.includes('https://e.com/blog/feed'));
  assert.ok(urls.includes('https://e.com/feed'));
});

test('gradeFeed 把解析出 0 条的 feed 判为不可用', () => {
  const empty = '<?xml version="1.0"?><rss version="2.0"><channel><title>空</title></channel></rss>';
  assert.equal(gradeFeed(empty).ok, false);
});

/* ---- 构建期校验 ---- */

test('validate 抓出缺字段，并指出是哪天哪一条', () => {
  assert.throws(
    () => validate([{ date: '2026-08-01', items: [{ id: 'a', source: 's', url: 'https://e.com/a', titleZh: 't', summaryZh: 's', rating: 3, tools: [], publishedAt: 'x' }] }]),
    /2026-08-01 有一条缺字段 "whyRead"/,
  );
});

test('validate 拒绝越界或非整数的 rating', () => {
  const day = (rating) => [{ date: '2026-08-01', items: [{ id: 'a', source: 's', url: 'https://e.com/a', titleZh: 't', summaryZh: 's', whyRead: 'w', rating, tools: [], publishedAt: 'x' }] }];
  assert.throws(() => validate(day(0)), /rating 必须是 1-5/);
  assert.throws(() => validate(day(6)), /rating 必须是 1-5/);
  assert.throws(() => validate(day(3.5)), /rating 必须是 1-5/);
  assert.doesNotThrow(() => validate(day(3)));
});

test('buildHtml 产出的页面内嵌数据可解析，且切断了 </script>', () => {
  const root = mkdtempSync(join(tmpdir(), 'tinker-'));
  mkdirSync(join(root, 'tinker', 'data'), { recursive: true });
  cpSync('templates/tinker', join(root, 'templates', 'tinker'), { recursive: true });
  writeFileSync(join(root, 'tinker', 'sources.json'), JSON.stringify([{ name: '源', url: 'https://e.com', kind: 'blog', desc: '' }]));
  writeFileSync(join(root, 'tinker', 'data', '2026-08-01.json'), JSON.stringify({
    date: '2026-08-01',
    dailyNote: '编者按',
    items: [{
      id: 'a', source: '源', kind: 'blog', url: 'https://e.com/a',
      titleOriginal: 'o', titleZh: '标题', whyRead: '理由',
      // 摘要里故意塞一个闭合标签，验证转义
      summaryZh: '摘要里有 </script> 这种东西', rating: 5, tools: ['claude-code'],
      publishedAt: '2026-08-01T00:00:00Z',
    }],
  }));

  // 模板是从 lib/tinker/render.mjs 的相对路径读的，构建只依赖 root 下的数据与 sources。
  const res = buildHtml({ root, today: '2026-08-01' });
  assert.equal(res.itemCount, 1);
  const html = readFileSync(join(root, 'dist', 'tinker.html'), 'utf8');
  assert.ok(!html.includes('这种东西 </script'), '</script> 必须被转义');
  const json = /<script type="application\/json" id="tinker-data">([\s\S]*?)<\/script>/.exec(html)[1];
  const parsed = JSON.parse(json.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>'));
  assert.equal(parsed.days[0].items[0].titleZh, '标题');
  assert.equal(parsed.names.tools['claude-code'], 'Claude Code');
  assert.equal(parsed.names.topics['mcp'], 'MCP');
  assert.equal(parsed.names.tools['mcp'], undefined, 'MCP 是话题不是工具，不该出现在工具表里');
});

test('【修复】论坛帖 feed 已给正文时不再补全（linux.do 话题页只有 JS 外壳）', () => {
  // Discourse 的 RSS 里就是首帖全文，而话题页在浏览器 UA 下没有正文，
  // 补全会用样式表碎片盖掉首帖，中文占比被拉到个位数后整条被毙。
  assert.equal(needsEnrich({ thread: true, excerpt: '首帖正文，比阈值短' }), false);
  // feed 什么都没给的论坛帖仍然要补全——那时候页面是唯一来源
  assert.equal(needsEnrich({ thread: true, excerpt: '' }), true);
  // 非论坛源不受影响
  assert.equal(needsEnrich({ excerpt: '短摘要' }), true);
  // 本来就够长的，谁都不补
  assert.equal(needsEnrich({ excerpt: 'x'.repeat(300) }), false);
});

test('【修复】V2EX 话题页只抽首帖，不把导航和回复算成正文', () => {
  // 2026-08-09：当天三条 V2EX 入围帖的首帖正文实测是 0 / 0 / 17 字符，
  // 但整页抽出来是 711 / 1305 / 793 字符，全部越过了「论坛短帖 <600 扣 3 分」那道闸，
  // 还从回复区白捡「正文经验词」的加分，以 7-9 分占掉三个评审席位。
  const chrome = 'Home Sign Up Sign In V2EX › OpenAI ';
  const replies = '1 someone 8h ago 本来就是今天重置啊 2 other 7h ago 我的也是今天重置 '.repeat(6);
  const footer = ' About · Help · Advertise · Blog · API · FAQ · 912 Online 创意工作者们的社区 ';

  // 首帖为空时 V2EX 连 topic_content 这个 div 都不生成 —— 必须得到 ''，不是 null
  const empty = `<html><body>${chrome}<div class="box">${replies}</div>${footer}</body></html>`;
  assert.equal(threadBodyHtml('https://www.v2ex.com/t/1232951', empty), '');

  // 首帖有内容时只切出首帖，回复和 chrome 都不要
  const body = '感觉 opencode go 首月套餐 $5 很诱人，但是不知道具体效果怎么样呢？';
  const full = `<html><body>${chrome}<div class="topic_content">${body}</div></div>${replies}${footer}</body></html>`;
  const scoped = threadBodyHtml('https://www.v2ex.com/t/1232641', full);
  assert.equal(scoped, body, '切出来的应当正好是首帖');
  assert.ok(!scoped.includes('本来就是今天重置啊'), '回复不能混进首帖');
  assert.ok(!scoped.includes('创意工作者们的社区'), '页脚不能混进首帖');

  // 没有切法的站返回 null，走原来的整页抽取，行为不变
  assert.equal(threadBodyHtml('https://linux.do/t/topic/2725432', full), null);
  assert.equal(threadBodyHtml('不是个 URL', full), null);
});

test('【修复】补全失败要重试一轮：掘金限流页是 HTTP 200，第二次要就给', async () => {
  // 2026-08-05：掘金文章页在补全阶段返回 `200 + x-tt-system-error: 3` 的
  // 2397 字节错误页，换任何 UA 都一样，是服务端限流不是反爬。当轮 16 条掘金
  // 入围条目全部 thin（=评审那一步一律不许收），隔几分钟重放救回 9 条。
  const body = '<html><body><article>' + '这是一篇真正的正文内容。'.repeat(40) + '</article></body></html>';
  const throttled = '<html><body>Please wait...</body></html>';
  const hits = new Map();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const n = (hits.get(url) ?? 0) + 1;
    hits.set(url, n);
    // 第一次限流、第二次给正文——正是实测到的行为
    return new Response(n === 1 ? throttled : body, { status: 200 });
  };
  try {
    const items = [
      { url: 'https://juejin.cn/post/1', excerpt: '短', thin: true },
      { url: 'https://juejin.cn/post/2', excerpt: '短', thin: true },
    ];
    const res = await enrich(items, { retryDelayMs: 0 });
    assert.equal(res.attempted, 2);
    assert.equal(res.retryAttempted, 2, '第一轮全军覆没，两条都该进重试');
    assert.equal(res.retried, 2, '第二轮该把两条都救回来');
    assert.equal(res.enriched, 2);
    assert.ok(items.every((it) => it.thin === false), '救回来之后不能再标 thin');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('【新】补全熔断：一个源探针窗口零产出就停发，剩下的不再问', async () => {
  // 2026-08-12：掘金 285 条里 284 条抓不到正文，第一轮 285 个请求换回 1 条，
  // 第二轮 291 个换回 0 条——一个源吃掉当轮 85% 的补全预算，产出接近零。
  // 而 LESSONS 记着「同一轮里接着重放，限流被打得更死」，所以这些必然失败的
  // 请求不只是白花时间，它们本身在加深限流。
  const throttled = '<html><body>Please wait...</body></html>';
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls += 1; return new Response(throttled, { status: 200 }); };
  try {
    const items = Array.from({ length: 200 }, (_, i) => (
      { source: '掘金搜索', url: `https://juejin.cn/post/${i}`, excerpt: '短', thin: true }
    ));
    const res = await enrich(items, { retryDelayMs: 0 });
    assert.equal(res.attempted, 200);
    assert.ok(calls < 200, `熔断后不该问完 200 个，实际发了 ${calls} 个`);
    assert.ok(res.enrichSkipped > 300, '两轮加起来该跳过三百多个请求');
    assert.deepEqual(res.enrichMuted, ['掘金搜索']);
    assert.ok(items.every((it) => it.thin === true), '跳过的仍然是 thin，不影响后续判定');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('补全熔断只按源算，一个源被熔断不牵连另一个源', async () => {
  const body = '<html><body><article>' + '正文内容足够长。'.repeat(60) + '</article></body></html>';
  const throttled = '<html><body>Please wait...</body></html>';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(
    String(url).includes('juejin') ? throttled : body, { status: 200 },
  );
  try {
    const items = [
      ...Array.from({ length: 120 }, (_, i) => (
        { source: '掘金搜索', url: `https://juejin.cn/post/${i}`, excerpt: '短', thin: true }
      )),
      ...Array.from({ length: 120 }, (_, i) => (
        { source: '博客园首页', url: `https://www.cnblogs.com/x/p/${i}`, excerpt: '短', thin: true }
      )),
    ];
    const res = await enrich(items, { retryDelayMs: 0 });
    assert.deepEqual(res.enrichMuted, ['掘金搜索'], '只有零产出的那个源该被熔断');
    assert.equal(res.enriched, 120, '正常的源一条都不能少');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('补全熔断不跨轮：第二轮从零开始探，限流恢复是概率性的', async () => {
  // LESSONS：掘金补全的重试 08-08/09/10 连续三天 0，08-11 救回 5 条。
  // 所以第一轮熔断了，第二轮（等过限流窗口之后）仍然要给它机会。
  const body = '<html><body><article>' + '这是一篇真正的正文内容。'.repeat(40) + '</article></body></html>';
  const throttled = '<html><body>Please wait...</body></html>';
  let pass = 1;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(pass === 1 ? throttled : body, { status: 200 });
  try {
    const items = Array.from({ length: 60 }, (_, i) => (
      { source: '掘金搜索', url: `https://juejin.cn/post/${i}`, excerpt: '短', thin: true }
    ));
    const res = await enrich(items, {
      retryDelayMs: 0,
      // 用等待那一刻当「限流窗口过去了」的开关
    });
    assert.ok(res.enrichSkipped > 0, '第一轮该熔断');
    pass = 2;
    const again = await enrich(items, { retryDelayMs: 0 });
    assert.equal(again.enriched, 60, '窗口过去之后该全部补回来，不能被上一轮的熔断记忆挡住');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('补全第一轮就成功的条目不会被重试第二次（重试要克制，别把限流打得更死）', async () => {
  const body = '<html><body><article>' + '正文内容足够长。'.repeat(60) + '</article></body></html>';
  const hits = new Map();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    hits.set(url, (hits.get(url) ?? 0) + 1);
    return new Response(body, { status: 200 });
  };
  try {
    const items = [{ url: 'https://example.com/a', excerpt: '短', thin: true }];
    const res = await enrich(items, { retryDelayMs: 0 });
    assert.equal(res.retryAttempted, 0);
    assert.equal(hits.get('https://example.com/a'), 1, '只该请求一次');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('【修复】抓取的 transient 503 要重试一轮，不能直接记成源失败', async () => {
  // 2026-08-06：当天 7 个「失败源」里 6 个其实是活的，503 来自出口代理
  // （x-deny-reason: resolve_failed，正文自称 transient）。而 SkyWT / 东方星痕
  // 已经因此连续 5 天记为失败，再过两天就会被点名停用。
  const sources = [{ name: '活的' }, { name: '抖了一下' }, { name: '真死了' }];
  const seen = new Map();
  const fetchOne = async (source) => {
    const n = (seen.get(source.name) ?? 0) + 1;
    seen.set(source.name, n);
    if (source.name === '活的') return [{ id: 'a' }];
    if (source.name === '真死了') throw new Error('HTTP 404');
    if (n === 1) throw new Error('HTTP 503');
    return [{ id: 'b' }];
  };

  const ok = [];
  const res = await fetchAllSources({
    sources, fetchOne, concurrency: 3, retryDelayMs: 0, log: () => {},
    onSuccess: (source, got) => ok.push([source.name, got.length]),
  });

  assert.equal(res.retryAttempted, 1, '只有 503 那个该进第二轮');
  assert.equal(res.retried, 1, '第二轮该把它救回来');
  assert.deepEqual(res.failed.map((f) => f.source.name), ['真死了']);
  assert.deepEqual(ok.sort(), [['抖了一下', 1], ['活的', 1]], '救回来的条目要真的进入结果');
  assert.equal(seen.get('真死了'), 1, 'HTTP 404 是站点的明确答复，不该重试');
  assert.equal(seen.get('活的'), 1, '第一轮就成功的不该被重试');
});

test('抓取重试补满轮次就认了，不再往下打', async () => {
  const hits = new Map();
  const fetchOne = async (source) => {
    hits.set(source.name, (hits.get(source.name) ?? 0) + 1);
    throw new Error('HTTP 503');
  };
  const res = await fetchAllSources({
    sources: [{ name: '一直 503' }], fetchOne, concurrency: 2, retryDelayMs: 0, retryRounds: 2,
    log: () => {}, onSuccess: () => {},
  });
  assert.equal(hits.get('一直 503'), 3, '第一轮 + 两轮补抓，总共三次');
  assert.equal(res.retried, 0);
  assert.deepEqual(res.failed.map((f) => f.message), ['HTTP 503']);
});

// 2026-08-07：东方星痕的真实形状——首页 200，240KB 的 atom.xml 连着 curl 三次，
// 前两次 Connection reset by peer，第三次 200。三次只隔几秒，所以不是
// 「抖动窗口比重试间隔长」，是每次连接独立地有概率被 reset。一轮补抓救不回它，
// 它因此连续 6 天记为失败，还有一天就会被当噪声点名停用。
test('抓取重试：前两次都被 reset、第三次才通的源要能救回来', async () => {
  const hits = new Map();
  const fetchOne = async (source) => {
    const n = (hits.get(source.name) ?? 0) + 1;
    hits.set(source.name, n);
    if (n < 3) throw new Error('Recv failure: ECONNRESET');
    return [{ id: 'late' }];
  };
  const ok = [];
  const res = await fetchAllSources({
    sources: [{ name: '大 feed 被 reset' }], fetchOne, concurrency: 2, retryDelayMs: 0, retryRounds: 2,
    log: () => {}, onSuccess: (source, got) => ok.push([source.name, got.length]),
  });
  assert.equal(hits.get('大 feed 被 reset'), 3);
  assert.equal(res.retried, 1, '第三轮救回来了');
  assert.deepEqual(res.failed, [], '不该再记 failure');
  assert.deepEqual(ok, [['大 feed 被 reset', 1]], '救回来的条目要真的进入结果');
});

test('maxQueries 截断每轮查询数，且「整源失败」按实际发出的条数判', async () => {
  // 小众软件论坛搜索从创刊起天天记「30 个查询挂 15 个」，一直被当成站点抽风。
  // 实测是 Discourse 匿名搜索限流：连发 30 个，第 8 个前后开始一律 HTTP 429，
  // 当轮 23 个查询是发出去就注定被拒的。截断之后不再白发。
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    sent.push(url);
    return { ok: true, status: 200, text: async () => JSON.stringify({ posts: [], topics: [] }) };
  };
  try {
    const queries = Array.from({ length: 30 }, (_, i) => `词${i}`);
    const source = { search: 'discourse', origin: 'https://meta.example.net', maxQueries: 8, delayMs: 0 };
    const { attempted } = await fetchSearchItems({ source, queries, ua: 'ua' });
    assert.equal(sent.length, 8, `只该发 8 个查询，实际 ${sent.length}`);
    assert.equal(attempted, 8, 'attempted 要报实际发出的条数，供上层算失败比例');

    // 没写 maxQueries 的源不受影响：全发。
    sent.length = 0;
    const { attempted: full } = await fetchSearchItems({ source: { ...source, maxQueries: undefined }, queries, ua: 'ua' });
    assert.equal(sent.length, 30);
    assert.equal(full, 30);
  } finally { globalThis.fetch = original; }
});

test('截断之后全挂的源仍然按整源失败抛出，不会被当成部分失败混过去', async () => {
  // 分母必须是实际发出的条数：拿轮转池总数当分母，8 发 8 挂只算「8/30 部分失败」。
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('HTTP 429'); };
  try {
    const queries = Array.from({ length: 30 }, (_, i) => `词${i}`);
    const source = { search: 'discourse', origin: 'https://meta.example.net', maxQueries: 8, delayMs: 0 };
    await assert.rejects(() => fetchSearchItems({ source, queries, ua: 'ua' }), /全部 8 个查询失败/);
  } finally { globalThis.fetch = original; }
});
