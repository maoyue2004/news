import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreItem, triage, cjkRatio, SHORTLIST_THRESHOLD } from '../lib/tinker/relevance.mjs';
import { matchTools, matchTopics, matchVocab, queriesForDate, SEARCH_QUERIES } from '../lib/tinker/vocab.mjs';

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

test('查询词按天轮转，一周内能覆盖全库', () => {
  const seen = new Set();
  for (let d = 1; d <= 7; d += 1) {
    for (const q of queriesForDate(`2026-08-0${d}`, 12)) seen.add(q);
  }
  assert.ok(seen.size >= SEARCH_QUERIES.length * 0.9, `7 天只覆盖了 ${seen.size}/${SEARCH_QUERIES.length}`);
});

test('同一天的查询词切片是稳定的', () => {
  assert.deepEqual(queriesForDate('2026-08-01', 12), queriesForDate('2026-08-01', 12));
});

test('产品自荐帖被重扣，真折腾长文不受影响', () => {
  const promo = scoreItem({
    title: '做了一个 Neovim 里的 AI 编程 Agent 前端 pi2.nvim，开源求交流',
    excerpt: '一直在用 Claude Code 做日常开发，我把它做成了插件，欢迎试用，求个 Star。',
    kind: 'forum',
  });
  assert.equal(promo.verdict, 'reject');
  assert.ok(promo.reasons.includes('疑似产品自荐帖'));
});

test('论坛短帖扣分，但长度不是硬门槛', () => {
  const args = { title: '我把 Claude Code 的 statusline 折腾成了可版本化仓库', excerpt: '踩坑记录。' };
  const short = scoreItem({ ...args, kind: 'forum' });
  const long = scoreItem({ ...args, excerpt: '踩坑记录。'.repeat(400), kind: 'forum' });
  const blog = scoreItem({ ...args, kind: 'blog' });
  assert.ok(short.score < blog.score, '论坛短帖该比同内容的博客文低分');
  assert.ok(long.score > short.score, '论坛长帖该比短帖高分');
  assert.equal(short.verdict, 'shortlist', '够强的短帖仍要能入围，长度只是减分项');
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
  const mk = (i, source, kind) => ({
    id: `${source}${i}`, source, kind, url: `https://e.com/${source}${i}`,
    titleOriginal: `我用 Claude Code 折腾了第 ${i} 个项目的实践记录`,
    excerpt: '踩坑心得，配置工作流，实测有效。'.repeat(80),
  });
  const items = [
    ...['论坛A', '论坛B', '论坛C', '论坛D'].flatMap((s) => Array.from({ length: 20 }, (_, i) => mk(i, s, 'forum'))),
    ...Array.from({ length: 10 }, (_, i) => mk(i, `博客${i}`, 'blog')),
  ];
  const { shortlist } = triage(items, { cap: 60, quota: 8 });
  const forums = shortlist.filter((it) => it.kind === 'forum').length;
  const blogs = shortlist.filter((it) => it.kind === 'blog').length;
  assert.equal(blogs, 10, '文章型条目一条都不该被挤掉');
  assert.ok(forums <= 8, `论坛不该超过 40% 占比（10 篇文章对应约 7 条），实际 ${forums}`);
});

test('博客当天集体没更新时，论坛仍能凑出一个能看的名单', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({
    id: `f${i}`, source: '论坛', kind: 'forum', url: `https://e.com/f${i}`,
    titleOriginal: `我用 Cursor 折腾了第 ${i} 个项目的记录`,
    excerpt: '踩坑心得，配置工作流。'.repeat(80),
  }));
  const { shortlist } = triage(items, { cap: 60, quota: 8 });
  assert.ok(shortlist.length >= 6, `应有 FORUM_FLOOR 兜底，实际 ${shortlist.length}`);
});

test('被占比上限挡下的条目要说明原因，不静默消失', () => {
  const items = [
    ...Array.from({ length: 30 }, (_, i) => ({
      id: `f${i}`, source: `论坛${i % 3}`, kind: 'forum', url: `https://e.com/f${i}`,
      titleOriginal: `我用 Cursor 折腾了第 ${i} 个项目`, excerpt: '踩坑心得。'.repeat(80),
    })),
    { id: 'b1', source: '博客', kind: 'blog', url: 'https://e.com/b1',
      titleOriginal: '我用 Claude Code 折腾了一个项目', excerpt: '踩坑心得。'.repeat(80) },
  ];
  const { shortlist, rejected } = triage(items, { cap: 60, quota: 8 });
  assert.equal(shortlist.length + rejected.length, items.length, '总数必须守恒');
  assert.ok(rejected.some((r) => r.reasons.some((x) => x.includes('占比上限'))));
});
