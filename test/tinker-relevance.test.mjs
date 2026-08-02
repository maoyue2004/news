import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreItem, triage, cjkRatio, SHORTLIST_THRESHOLD } from '../lib/tinker/relevance.mjs';
import { matchTools, matchTopics, matchVocab, queriesForDate, rotatingQueries, CORE_QUERIES, TOOLS } from '../lib/tinker/vocab.mjs';

const pass = (t, e = '') => scoreItem({ title: t, excerpt: e }).verdict === 'shortlist';

test('cjkRatio 只数汉字，忽略空白', () => {
  assert.equal(cjkRatio('   '), 0);
  assert.equal(cjkRatio('abcd'), 0);
  assert.ok(cjkRatio('我用 Claude Code 折腾了一天') > 0.4);
});

test('英文内容被语言门槛挡掉', () => {
  const r = scoreItem({ title: 'How I use Claude Code every day', excerpt: 'I tried it for a week and here is what I learned about the workflow.' });
  assert.equal(r.verdict, 'reject');
  assert.match(r.reasons[0], /中文占比/);
});

test('没有任何 agent 相关词的中文文章不入围', () => {
  assert.equal(pass('我折腾了三天终于把家里的 NAS 装好了', '踩了很多坑，记录一下配置过程和心得体会。'), false);
});

test('标题带工具名的第一人称实践稳定入围', () => {
  assert.ok(pass('我把 Claude Code 的 statusline 整理成了一个可版本化仓库', '踩了几个坑，记录配置过程。'));
  assert.ok(pass('用 Cursor 重写工作流一个月后的复盘', '实测下来有几个地方不如预期。'));
});

test('招聘帖直接毙掉，即使命中工具词', () => {
  const r = scoreItem({
    title: '全栈工程师 AI Agent + Web3 远程全职 45-50K',
    excerpt: '我们在用 Claude Code 和 Cursor，欢迎有实践经验的同学，薪资 45-50K。',
  });
  assert.equal(r.verdict, 'reject');
  assert.equal(r.reasons[0], '招聘 / 接单帖');
});

test('卖额度 / 拼车帖直接毙掉', () => {
  for (const title of [
    '自建 Cursor / Claude Code 中转接入服务，欢迎压测',
    'Claude Code 拼车，长期稳定',
    'Claude API 官方价 1.9 折起，新用户免费领 10 美元额度',
  ]) {
    assert.equal(scoreItem({ title, excerpt: '我自己用了很久，实测很稳定。' }).verdict, 'reject', title);
  }
});

test('短工具名按词边界匹配，不吃子串', () => {
  // dia / amp / zed 是踩过的真实误命中：diagram、example、realized
  assert.deepEqual(matchTools('让中文 ASCII diagram 图表对齐'), []);
  assert.deepEqual(matchTools('for example, this is fine'), []);
  assert.deepEqual(matchTools('I realized something'), []);
  // 中英混排仍然要能命中
  assert.ok(matchTools('用Zed写代码的体验').includes('zed'));
  assert.ok(matchTools('试了下 Amp 这个 agent').includes('amp'));
});

test('HTML 实体 &amp; 不能被当成 Amp', () => {
  // feed 正文里 &amp; 遍地都是，前后都不是拉丁字母，纯词边界规则拦不住。
  assert.deepEqual(matchTools('查询参数 a&amp;b 拼接'), []);
  assert.deepEqual(matchTools('see &amp;lt; here'), []);
});

test('新闻腔会被扣分，纯发布公告不入围', () => {
  const r = scoreItem({
    title: 'MCP 协议迎来史上最大更新，Claude 率先适配支持',
    excerpt: '官方正式发布 2026-07-28 规范，据悉这是协议诞生以来改动最激进的一次，重磅升级。',
  });
  assert.equal(r.verdict, 'reject');
});

test('求助帖被扣分', () => {
  const withQ = scoreItem({ title: '求教 Claude Code 怎么配置代理？', excerpt: '我折腾了半天没搞定，实践中一直报错。' });
  const withoutQ = scoreItem({ title: 'Claude Code 配置代理的折腾记录', excerpt: '我折腾了半天没搞定，实践中一直报错。' });
  assert.ok(withQ.score < withoutQ.score);
});

test('triage 按源配额裁剪，防止单一源淹没名单', () => {
  const mk = (i, source) => ({
    id: `id${i}`, source, url: `https://e.com/${i}`,
    titleOriginal: `我用 Claude Code 折腾了第 ${i} 个项目的实践记录`,
    excerpt: '踩坑心得，配置工作流，实测有效。',
  });
  const items = [
    ...Array.from({ length: 30 }, (_, i) => mk(i, '论坛')),
    ...Array.from({ length: 3 }, (_, i) => mk(100 + i, '博客')),
  ];
  const { shortlist } = triage(items, { cap: 10, quota: 4 });
  const forum = shortlist.filter((it) => it.source === '论坛').length;
  const blog = shortlist.filter((it) => it.source === '博客').length;
  assert.equal(blog, 3, '博客源的 3 条都该保住');
  assert.ok(forum <= 7, `论坛不该超过配额+补齐，实际 ${forum}`);
  assert.equal(shortlist.length, 10);
});

test('triage 把没进名单的 passed 条目也记进 rejected，不静默丢失', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({
    id: `id${i}`, source: `源${i}`, url: `https://e.com/${i}`,
    titleOriginal: `我用 Cursor 折腾了第 ${i} 个项目`,
    excerpt: '踩坑记录，配置心得。',
  }));
  const { shortlist, rejected } = triage(items, { cap: 5, quota: 2 });
  assert.equal(shortlist.length, 5);
  assert.equal(shortlist.length + rejected.length, items.length);
  assert.ok(rejected.some((r) => r.reasons.includes('超出当日入围上限，未进入人工评审')));
});

test('入围线是常量而不是魔数，改动会被测试看见', () => {
  assert.equal(SHORTLIST_THRESHOLD, 6);
});

test('核心词每天都跑，不参与轮转', () => {
  // 轮转的毛病是把「常年高产」和「碰运气」的词一视同仁，
  // 「Claude Code 实践」隔几天才轮到一次就是白白漏掉。
  for (const date of ['2026-08-02', '2026-08-05', '2026-09-17']) {
    const q = queriesForDate(date, 24);
    for (const core of CORE_QUERIES) assert.ok(q.includes(core), `${date} 少了核心词 ${core}`);
  }
});

test('长尾词轮转，两周内能覆盖全池', () => {
  const seen = new Set();
  for (let d = 0; d < 14; d += 1) {
    const date = new Date(Date.UTC(2026, 7, 2 + d)).toISOString().slice(0, 10);
    for (const q of queriesForDate(date, 30)) seen.add(q);
  }
  const total = rotatingQueries().length + CORE_QUERIES.length;
  assert.ok(seen.size >= total * 0.95, `14 天只覆盖了 ${seen.size}/${total}`);
});

test('查询词从词表自动派生，加了工具就自动有搜索覆盖', () => {
  // 手写查询和词表会脱节：每加一个工具都得记得同步加查询，漏一个这工具就永远搜不到。
  const pool = rotatingQueries();
  for (const id of ['openclaw', 'kimi-code', 'qoder']) {
    const name = TOOLS.find((t) => t.id === id).name;
    assert.ok(pool.some((q) => q.startsWith(name)), `${name} 没有派生出查询词`);
  }
  // 太泛的名字不派生，否则搜出来全是噪声。
  // 注意只断言「派生形式」不存在——手写词库里的 'Amp code 体验' 是刻意保留的，
  // 它带了 code 消歧，和光秃秃的 'Amp 实践' 不是一回事。
  for (const bad of ['Amp 实践', 'Amp 踩坑', 'Zed 实践', 'Manus 实践']) {
    assert.ok(!pool.includes(bad), `${bad} 太泛，不该派生`);
  }
});

test('查询数不足以容纳核心词时也不报错', () => {
  const q = queriesForDate('2026-08-02', 3);
  assert.equal(q.length, CORE_QUERIES.length, '核心词不该被截断');
});

test('同一天的查询词切片是稳定的', () => {
  assert.deepEqual(queriesForDate('2026-08-01', 12), queriesForDate('2026-08-01', 12));
});

test('产品自荐帖被重扣，真折腾长文不受影响', () => {
  const promo = scoreItem({
    title: '做了一个 Neovim 里的 AI 编程 Agent 前端 pi2.nvim，开源求交流',
    excerpt: '一直在用 Claude Code 做日常开发，我把它做成了插件，欢迎试用，求个 Star。',
    thread: true,
  });
  assert.equal(promo.verdict, 'reject');
  assert.ok(promo.reasons.includes('疑似产品自荐帖'));
});

test('论坛短帖扣分，但长度不是硬门槛', () => {
  const args = { title: '我把 Claude Code 的 statusline 折腾成了可版本化仓库', excerpt: '踩坑记录。' };
  const short = scoreItem({ ...args, thread: true });
  const long = scoreItem({ ...args, excerpt: '踩坑记录。'.repeat(400), thread: true });
  const blog = scoreItem({ ...args, thread: false });
  assert.ok(short.score < blog.score, '论坛短帖该比同内容的博客文低分');
  assert.ok(long.score > short.score, '论坛长帖该比短帖高分');
  assert.equal(short.verdict, 'shortlist', '够强的短帖仍要能入围，长度只是减分项');
});

test('连载章节体标题被扣分，正文里提到章节的正常文章不受影响', () => {
  // 2026-08-03：SegmentFault 的《OpenCode 源码详解》一天占了 5 席，收录 0 条。
  const chapter = scoreItem({
    title: '第27章 与同类项目的横向对比',
    excerpt: '《OpenCode 源码详解》系列教程。本文对比 OpenCode 与 Claude Code、Cursor、Crush 的定位差异，'
      + '内容核实自 opencode.ai/docs 及 DeepWiki 架构说明。'.repeat(20),
  });
  assert.ok(chapter.reasons.includes('连载章节体标题'));
  assert.equal(chapter.verdict, 'reject');

  const day = scoreItem({ title: 'Day 03：先搞懂三種角色', excerpt: '介紹 Claude Code CLI 的基本用法。' });
  assert.ok(day.reasons.includes('连载章节体标题'));

  // 编号必须在标题开头才算：正文/句中提到章节的是正常写法。
  const normal = scoreItem({
    title: '用 Claude Code 重写了书稿的第 3 章，踩了三个坑',
    excerpt: '我让它读完前两章再动手，结果它把注释也一起改了。'.repeat(20),
  });
  assert.ok(!normal.reasons.includes('连载章节体标题'));
});

test('ACP 只认带限定词的写法，阿里云 ACP 认证不该命中', () => {
  // 和「心流 → 核心流程」同类：中文语料里裸 ACP 压倒性指阿里云认证。
  assert.deepEqual(matchTopics('我考了阿里云 ACP 认证，备考三个月'), []);
  assert.deepEqual(matchTopics('把 opencode acp 接进 Zed 试了试'), ['acp']);
});

test('工具和话题分属两个维度，互不混入', () => {
  // 「按工具」这个筛选器里出现 MCP / CLAUDE.md / Vibe Coding 是分类错误：它们是概念不是产品。
  assert.deepEqual(matchTools('我给项目写了 CLAUDE.md，还配了几个 MCP 服务'), []);
  assert.deepEqual(matchTopics('我给项目写了 CLAUDE.md，还配了几个 MCP 服务').sort(), ['claude-md', 'mcp']);
  const v = matchVocab('用 Claude Code 配 MCP');
  assert.deepEqual(v.tools, ['claude-code']);
  assert.deepEqual(v.topics, ['mcp']);
});

test('打分时工具和话题等价：只提概念也算命中主题', () => {
  const r = scoreItem({ title: '我把 AGENTS.md 重写了一遍的折腾记录', excerpt: '踩坑心得。', kind: 'blog' });
  assert.equal(r.verdict, 'shortlist');
  assert.deepEqual(r.topics, ['agents-md']);
});

test('短中文别名不能是常用词的子串', () => {
  // 「心流」曾作为 iFlow 的别名，命中了「核心流程」；中文没有词边界，规则拦不住，只能不加。
  assert.deepEqual(matchTools('它的核心流程是四步'), []);
  assert.deepEqual(matchTools('纽扣子掉了'), []);
  assert.ok(matchTools('用 iFlow CLI 跑了一下').includes('iflow'));
});

test('论坛/搜索源整体占比封顶，不只是按单源配额', () => {
  // 按源配额只防单个源淹没名单；4 个论坛源各拿 8 席合起来仍是 32 席。
  const mk = (i, source, thread) => ({
    id: `${source}${i}`, source, thread, url: `https://e.com/${source}${i}`,
    titleOriginal: `我用 Claude Code 折腾了第 ${i} 个项目的实践记录`,
    excerpt: '踩坑心得，配置工作流，实测有效。'.repeat(80),
  });
  const items = [
    ...['论坛A', '论坛B', '论坛C', '论坛D'].flatMap((s) => Array.from({ length: 20 }, (_, i) => mk(i, s, true))),
    ...Array.from({ length: 10 }, (_, i) => mk(i, `博客${i}`, false)),
  ];
  const { shortlist } = triage(items, { cap: 60, quota: 8 });
  const forums = shortlist.filter((it) => it.thread).length;
  const blogs = shortlist.filter((it) => !it.thread).length;
  assert.equal(blogs, 10, '文章型条目一条都不该被挤掉');
  assert.ok(forums <= 8, `论坛不该超过 40% 占比（10 篇文章对应约 7 条），实际 ${forums}`);
});

test('博客当天集体没更新时，论坛仍能凑出一个能看的名单', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({
    id: `f${i}`, source: '论坛', thread: true, url: `https://e.com/f${i}`,
    titleOriginal: `我用 Cursor 折腾了第 ${i} 个项目的记录`,
    excerpt: '踩坑心得，配置工作流。'.repeat(80),
  }));
  const { shortlist } = triage(items, { cap: 60, quota: 8 });
  assert.ok(shortlist.length >= 6, `应有 FORUM_FLOOR 兜底，实际 ${shortlist.length}`);
});

test('被占比上限挡下的条目要说明原因，不静默消失', () => {
  const items = [
    ...Array.from({ length: 30 }, (_, i) => ({
      id: `f${i}`, source: `论坛${i % 3}`, thread: true, url: `https://e.com/f${i}`,
      titleOriginal: `我用 Cursor 折腾了第 ${i} 个项目`, excerpt: '踩坑心得。'.repeat(80),
    })),
    { id: 'b1', source: '博客', url: 'https://e.com/b1',
      titleOriginal: '我用 Claude Code 折腾了一个项目', excerpt: '踩坑心得。'.repeat(80) },
  ];
  const { shortlist, rejected } = triage(items, { cap: 60, quota: 8 });
  assert.equal(shortlist.length + rejected.length, items.length, '总数必须守恒');
  assert.ok(rejected.some((r) => r.reasons.some((x) => x.includes('占比上限'))));
});

test('operator 不是 ChatGPT Desktop 的别名：它是英文里最常见的技术词之一', () => {
  // 2026-08-02：9 条入围里 2 条纯粹是被这个别名捞进来的——
  // 一篇讲 Kubernetes Operator Pattern 和 client-go，一篇正文里全是 operator: 'eq' 的表格列定义。
  // 和 dia/amp 那类子串误命中不同，operator 本身就是个独立单词，词边界规则拦不住。
  assert.deepEqual(matchTools('搞懂 Kubernetes Controller, Operator Pattern 和 client-go 的內部機制'), []);
  assert.deepEqual(matchTools("列定义里写 operator: 'eq' 就能生成筛选条件"), []);
  // 明确指向产品的写法仍要命中
  assert.ok(matchTools('用 ChatGPT Agent 跑了一遍报销流程').includes('chatgpt-desktop'));
});

test('没有薪资数字的招聘帖也要毙掉', () => {
  // 「招全栈 / AI Native Developer / Go 后端方向」——标题没有 K-K、没有「招聘」二字，
  // 旧规则整套判据一条都没命中，它带着 claude-code/cursor/copilot 三个工具词进了入围名单。
  const jd = scoreItem({
    title: '招全栈 / AI Native Developer / Go 后端方向',
    excerpt: '团队在用 Claude Code 和 Cursor，熟悉 Copilot 优先，有 agent 实践经验的同学优先。',
    kind: 'search',
  });
  assert.equal(jd.verdict, 'reject');
  assert.ok(jd.reasons.includes('招聘 / 接单帖'));
  // 「我招了个 agent 当同事」这种比喻不该被误伤：招字后面没有岗位词
  const notJd = scoreItem({
    title: '我用 Claude Code 折腾了一周的工作流',
    excerpt: '踩了几个坑，记录一下。'.repeat(30),
    kind: 'blog',
  });
  assert.equal(notJd.verdict, 'shortlist');
});

test('自荐帖的招呼语压在结尾时也要扣分，但比标题/开头轻', () => {
  // 手册的判据是「落点在哪」，落点字面上就是结尾。
  // 「古法编程做了个剪映」通篇像折腾文，来体验 / GitHub 求 Star 全在最后一段。
  const args = { title: '我用古法编程做了一个剪映', kind: 'search' };
  const body = '没用 Cursor，一行行手写了时间轴、动画系统和滤镜。'.repeat(30);
  const neutral = scoreItem({ ...args, excerpt: body });
  const tailPromo = scoreItem({ ...args, excerpt: `${body}\n别光听我说，自己去试试：在线体验、GitHub（求 Star）。` });
  const headPromo = scoreItem({ ...args, excerpt: `核心功能有：时间轴、动画、滤镜。\n${body}` });
  assert.ok(tailPromo.score < neutral.score, '结尾的推广语要扣分');
  assert.ok(tailPromo.reasons.includes('结尾落在推广语上'));
  assert.ok(headPromo.score < tailPromo.score, '标题/开头的自荐比结尾更能说明落点，扣得更重');
});

test('搜索源返回文章时不受论坛占比约束', () => {
  // kind 描述「怎么抓」，thread 描述「抓到什么」。掘金搜索和 V2EX 搜索的 kind
  // 都是 search，但前者返回文章、后者返回论坛帖，只有后者该被压。
  const mk = (i, source, thread) => ({
    id: `${source}${i}`, source, thread, url: `https://e.com/${source}${i}`,
    titleOriginal: `我用 Claude Code 折腾了第 ${i} 个项目的实践记录`,
    excerpt: '踩坑心得，配置工作流，实测有效。'.repeat(80),
  });
  const items = Array.from({ length: 25 }, (_, i) => mk(i, '掘金搜索', false));
  const { shortlist } = triage(items, { cap: 60, quota: 8 });
  assert.ok(shortlist.length >= 20, `文章型搜索源不该被占比上限压到 ${shortlist.length}`);
});
