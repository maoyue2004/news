import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreItem, triage, titleKey, cjkRatio, SHORTLIST_THRESHOLD, QUOTA_RELAX, THIN_FLOOR } from '../lib/tinker/relevance.mjs';
import { matchTools, matchTopics, matchVocab, queriesForDate, rotationSlice, rotatingQueries, CORE_QUERIES, TOOLS, retirableTools } from '../lib/tinker/vocab.mjs';

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

test('中文标题 + 开头整段代码块的文章不再被语言门槛硬毙', () => {
  // 2026-09-07 周更体检量到的：09-06 的 5 分精选《从 LangSmith 到 AGENTS.md》
  // 在正文开头贴了整份英文 AGENTS.md（连行号都在），`excerpt` 只取前 2500 字符，
  // 于是整篇中文文章的 CJK 占比是 2.7%，被硬毙、连分都不打。
  // 一个真正的英文源标题也是英文的，所以判据改成「标题和正文都不像中文才毙」。
  const codeFirst = '1 2 3 4 5 6 # Codex Global Working Agreements\n'
    + 'This file defines durable global guidance for `~/.codex`; repo-local `AGENTS.md` files may add narrower rules.\n'
    + '- `config.toml`: model, sandbox, MCP, plugin, feature, and agent settings.\n'
    + '- `skills/`: reusable workflows; `hooks.json`: deterministic lifecycle checks.\n';
  const r = scoreItem({ title: 'AI协同 | 从 LangSmith 到 AGENTS.md：一次 Agent 上下文优化实践', excerpt: codeFirst });
  assert.ok(cjkRatio(`${'AI协同 | 从 LangSmith 到 AGENTS.md：一次 Agent 上下文优化实践'}\n${codeFirst}`) < 0.15, '这条语料确实撞得上旧门槛');
  assert.notEqual(r.verdict, 'reject');
  assert.ok(r.score >= SHORTLIST_THRESHOLD);

  // 反向：标题也是英文的，照旧硬毙——这道闸挡英文源的本职不能丢。
  const en = scoreItem({ title: 'From LangSmith to AGENTS.md: a context optimization practice', excerpt: codeFirst });
  assert.equal(en.verdict, 'reject');
  assert.match(en.reasons[0], /中文占比/);
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
});

test('bareName: false 的词条只认带限定词的写法', () => {
  // 2026-08-24：裸 `amp` 是嫌疑别名里第一个真被量到误命中的。
  // 词边界拦得住 example，拦不住「前级余量（Pre-amp）控制器」和「MXR micro amp(M133)」——
  // `-` 和空格都不是拉丁字母，它们是合法边界。这类名字的问题不是「被谁包住了」
  // （那是 `not` 遮罩管的），是这个词本身就不唯一，所以关掉从 name 派生的那个匹配器。
  assert.deepEqual(matchTools('前级余量（Pre-amp）控制器'), []);
  assert.deepEqual(matchTools('MXR micro amp(M133) 效果器'), []);
  assert.deepEqual(matchTools('试了下 Amp 这个 agent'), []);
  // 带限定词的写法照常命中
  assert.ok(matchTools('用 sourcegraph amp 写了一周代码').includes('amp'));
  assert.ok(matchTools('Amp Code 的子 agent 怎么配').includes('amp'));
  // 只影响标了这个字段的词条，别的裸词条不受牵连
  assert.ok(matchTools('用Zed写代码的体验').includes('zed'));
});

test('ZCode 是产品词条，Z-code 虚拟机不算', () => {
  assert.ok(matchTools('我目前使用的 AI 工具是 Zcode，搭配 OpenCode Go').includes('zcode'));
  // Infocom 的 Z-machine 字节码和微软的翻译模型都写作带连字符的 Z-code，不收
  assert.deepEqual(matchTools('用 Z-code 虚拟机跑 Zork'), []);
});

test('WebMCP 是独立话题，不是 MCP 的一段', () => {
  // `webmcp` 里的 mcp 前面跟着拉丁字母 b，词边界不认——
  // 加这一条之前「WebMCP 适配教程」这个标题一个话题词都命中不到。
  assert.ok(matchTopics('WebMCP适配教程：让网页向 AI 提供工具').includes('webmcp'));
  assert.ok(!matchTopics('WebMCP适配教程：让网页向 AI 提供工具').includes('mcp'));
  // 拆开写的「web mcp」不算这个话题：那基本是在讲「Web 上的 MCP 服务」，
  // 该由 mcp 自己去认（它本来也认得出来）。
  assert.ok(!matchTopics('搭一个 web mcp 服务').includes('webmcp'));
  assert.ok(matchTopics('搭一个 web mcp 服务').includes('mcp'));
});

test('RAG 是话题，但被别人的名字包住时不算', () => {
  // 2026-09-03 补：表里一直有 agent-memory（记忆）却没有检索这一半，
  // 罗西那篇「ZeroClaw 源码阅读笔记（3）--- RAG」一个话题词都挂不上。
  assert.ok(matchTopics('【OpenClaw具身硬件】ZeroClaw 源码阅读笔记（3）--- RAG').includes('rag'));
  assert.ok(matchTopics('把检索增强生成接进 agent 的记忆层').includes('rag'));
  // 三字母裸词靠词边界活着：内嵌在别的单词里一律不算。
  assert.ok(!matchTopics('dragon storage 的分片策略').includes('rag'));
  // RAGFlow / GraphRAG 两侧都是拉丁字母，词边界本来就挡住了，不用 not 遮罩。
  assert.ok(!matchTopics('RAGFlow 的切分策略怎么调').includes('rag'));
  assert.ok(!matchTopics('GraphRAG 建图要多久').includes('rag'));
  // 四字的「检索增强」不收：中文没有词边界，正常语序会命中。
  assert.ok(!matchTopics('把检索增强一下就快了').includes('rag'));
});

test('只打标签不给分的词条：标签照挂，但不能单靠它进名单', () => {
  // 2026-09-03：`rag` 的标签是要的（罗西那篇通篇拆 RAG 管线），
  // 分是不能给的——离线重放里越过入围线的 3 条全是噪声。
  // 标签这一侧：matchVocab 一个都不滤。
  assert.ok(matchVocab('ZeroClaw 的 RAG 管线').topics.includes('rag'));
  // 打分这一侧：只命中 rag、别的 agent 词一个都没有 → 不该当成「这篇在讲 agent」。
  const only = scoreItem({
    title: '手把手做一个图 RAG 问答系统：Neo4j + Milvus 的工程实践',
    excerpt: '把文档切块、算向量、建图，然后调参。'.repeat(30),
    kind: 'blog',
  });
  assert.equal(only.verdict, 'reject');
  assert.equal(only.reasons[0], '没有命中任何 agent 相关词');
  // 但标签仍然要留在结果里，页面才挂得上。
  assert.ok(only.topics.includes('rag'));
  // 同时命中真正的 agent 词时照常入围，rag 只是不额外加分。
  const withAgent = scoreItem({
    title: '我拆了 ZeroClaw 的两套 RAG：HardwareRag 纯关键词，Memory 走三阶段',
    excerpt: '读了一周源码，把入库和检索两条流水线逐段记下来。'.repeat(30),
    kind: 'blog',
  });
  assert.equal(withAgent.verdict, 'shortlist');
  assert.ok(withAgent.topics.includes('rag'));
});

test('多智能体协作是独立话题，但「更多 agent」不算', () => {
  // 2026-08-31：subagent 说的是「一个 agent 派出去的下级」，
  // 这一条说的是几个对等 agent 怎么把同一个目标兜起来。
  assert.ok(matchTopics('多Agent协作的5个工程坑：契约、状态、目标、并发、异常').includes('multi-agent'));
  assert.ok(matchTopics('从 ReAct 到 Multi-Agent：别急着上多智能体').includes('multi-agent'));
  assert.ok(matchTopics('每個 Agents 都做完自己那份了，最後誰負責兜起來？ － Multi-Agent Coordination').includes('multi-agent'));
  // 中文没有词边界，`多 agent` 是「更多 agent」的一段——这是 `心流` → 核心流程那一族。
  assert.ok(!matchTopics('这个版本给 Harness 加了更多 agent 能力').includes('multi-agent'));
  assert.ok(!matchTopics('市面上越来越多 agent 框架都在抄这套设计').includes('multi-agent'));
  assert.ok(!matchTopics('这个版本加了更多Agent能力').includes('multi-agent'));
});

test('GSD 收裸缩写，因为限定词写法会漏掉正常语序', () => {
  // 2026-08-25：904 篇语料里裸 `gsd` 命中 4 条、4 条全是 get-shit-done 这个框架。
  // 只收 `gsd agent` 这类限定写法的话，4 条里认得出 2 条——
  // Day 22 正文里就是裸的「GSD 的规划文件」，和 worktree / spec-driven 那两次
  // 「限定词贴得太紧于是漏掉正常语序」是同一个形状。
  assert.ok(matchTools('Claude Code + GSD agent：我的實際開發流程').includes('gsd'));
  assert.ok(matchTools('GSD 的规划文件被下一轮覆盖了').includes('gsd'));
  assert.ok(matchTools('看不上 GSD、BMAD、Spec-Kit 那种重型框架').includes('gsd'));
  assert.ok(matchTools('装了 get-shit-done 之后重跑一遍').includes('gsd'));
  // 词边界还在：贴着拉丁字母的不算
  assert.deepEqual(matchTools('变量名叫 gsdConfig'), []);
  assert.deepEqual(matchTools('文件 xgsd.log 里有报错'), []);
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

test('名单没满而某个源被配额挡住时，落选理由要说的是配额不是上限', () => {
  // 2026-08-22 的真实分布：掘金一家 38 条候选，名单 49/60（没满），
  // 22 条被 quota * QUOTA_RELAX 挡在门外，理由却写「超出当日入围上限」。
  const items = Array.from({ length: 30 }, (_, i) => ({
    id: `j${i}`, source: '掘金搜索', url: `https://juejin.cn/post/${i}`,
    titleOriginal: `我用 Claude Code 折腾了第 ${i} 个项目`,
    excerpt: '踩坑记录，配置心得，实测下来的结论。',
  }));
  const { shortlist, rejected } = triage(items, { cap: 60, quota: 8 });
  assert.ok(shortlist.length < 60, `名单不该被一个源占满，实际 ${shortlist.length}`);
  const cut = rejected.filter((r) => r.reasons.some((x) => x.includes('未进入人工评审')));
  assert.ok(cut.length > 0);
  for (const r of cut) {
    assert.ok(r.reasons.some((x) => x.includes('单源配额已满')), `理由应指向配额：${r.reasons.join('；')}`);
    assert.ok(!r.reasons.some((x) => x.includes('超出当日入围上限')), '名单没满时不该说是上限');
  }
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

test('退役判据的粒度是工具，不是查询词', () => {
  // 08-24 定的口径：**该工具派生的所有查询都跑够轮次、且合计零入围**。
  // 只看一条零产出的查询就砍掉整个工具会砍错——`通义灵码 实践` 零入围，
  // 而 `通义灵码 踩坑` / `体验` 各出过一条。
  const q = (name, tpl) => `${name} ${tpl}`;
  const full = (name, rows) => Object.fromEntries(
    ['实践', '踩坑', '体验'].map((tpl, i) => [q(name, tpl), rows[i]]),
  );
  const ledger = {
    ...full('Kilo Code', [{ runs: 9, items: 3, shortlisted: 0 }, { runs: 9, items: 2, shortlisted: 0 }, { runs: 9, items: 7, shortlisted: 0 }]),
    // 有一条出过入围 → 整个工具不退役
    ...full('通义灵码', [{ runs: 9, items: 5, shortlisted: 0 }, { runs: 9, items: 8, shortlisted: 1 }, { runs: 9, items: 6, shortlisted: 0 }]),
    // 有一条轮次不够 → 还没到能下结论的时候
    ...full('Devin', [{ runs: 9, items: 3, shortlisted: 0 }, { runs: 2, items: 1, shortlisted: 0 }, { runs: 9, items: 4, shortlisted: 0 }]),
  };
  const ids = retirableTools(ledger).map((t) => t.id);
  assert.deepEqual(ids, ['kilo']);

  // 已经在 UNQUERYABLE 里的不该再被报出来——它没有手术对象，
  // 而它的计数会永远冻在退役那一刻（08-31 的 `augment` 那条）。
  const retiredLedger = full('Augment Code', [{ runs: 14, items: 11, shortlisted: 0 }, { runs: 14, items: 0, shortlisted: 0 }, { runs: 14, items: 0, shortlisted: 0 }]);
  assert.deepEqual(retirableTools(retiredLedger), []);
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

test('每个轮转词每个周期恰好跑一次', () => {
  const pool = Array.from({ length: 254 }, (_, i) => `词${i}`);
  const counts = new Map();
  // cycle = ceil(254/24) = 11
  for (let d = 0; d < 11; d += 1) {
    const date = new Date(Date.UTC(2026, 7, 17 + d)).toISOString().slice(0, 10);
    const slice = rotationSlice(pool, date, 24);
    assert.ok(slice.length <= 24, `${date} 一天发了 ${slice.length} 个，超过额度`);
    for (const q of slice) counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  assert.equal(counts.size, pool.length, '一个周期没覆盖全池');
  assert.deepEqual([...new Set(counts.values())], [1], '有词在同一周期里跑了不止一次');
});

test('池子中途变长，覆盖不会被重新洗牌', () => {
  // 这条是照着真实故障写的：原来的实现按 `(days * rotating) % pool.length` 取窗口起点，
  // days 是两万多的大数，池子每加一个词，起点就跳到不相干的位置。
  // 后果是 2026-08-17 量到的那个驼峰——13 天 312 个查询槽只碰到 145/254 个词，
  // 尾部 61 个（含全部 TOPICS 派生词）一次都没跑过。
  // 所以断言的不是「某个具体切片」，而是**词表在演化过程中每个词仍然轮得到**。
  const base = Array.from({ length: 200 }, (_, i) => `词${i}`);
  const seen = new Map();
  for (let d = 0; d < 20; d += 1) {
    // 每两天往池子中间插一个新词，模拟词表被反复修改。
    const pool = [...base];
    for (let k = 0; k < Math.floor(d / 2); k += 1) pool.splice(50 + k, 0, `新词${k}`);
    const date = new Date(Date.UTC(2026, 7, 17 + d)).toISOString().slice(0, 10);
    for (const q of rotationSlice(pool, date, 24)) seen.set(q, (seen.get(q) ?? 0) + 1);
  }
  const missed = base.filter((q) => !seen.has(q));
  assert.deepEqual(missed, [], `20 天里有 ${missed.length} 个词一次都没跑过`);
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

test('课程 / 教练营销文被扣分，同题材的真实践文不受影响', () => {
  const coach = scoreItem({
    title: 'Vibe Coding 重點是 Vibe 還是 Coding？一位 AI 賦能師的告白',
    excerpt:
      '身為擁有 600 天實戰經驗、輔導超過 30 位企業主的 AI 賦能師，我昨天在一家會計事務所帶學員用 Claude Code '
      + '完成了一整套系統。每天為自己贖回 2 小時！歡迎按愛心、收藏並分享給身邊的創業夥伴。',
  });
  assert.ok(coach.reasons.includes('疑似课程 / 教练营销文'));

  // 同一个平台、同一种繁体写法、同样在讲用 agent 干活，但落点是自己踩的坑——不能被误伤
  const real = scoreItem({
    title: '我花三天測試 OpenClaw：最後還是 GitHub Actions 和 Cursor 比較好用',
    excerpt:
      '我花了三天、約 15 美元在 Zeabur 上部署 OpenClaw，重啟 4 次，成功完成的實際任務是 0。'
      + '最後把流程改成 GitHub Actions 直接寄 Email，幾分鐘就跑通了，成本 0。',
  });
  assert.ok(!real.reasons.includes('疑似课程 / 教练营销文'));
  assert.ok(real.score > coach.score);
});

test('自述「未运行过」的源码静态分析报告被扣分，真读过源码的拆解不受影响', () => {
  // 2026-08-31：掘金「GitHub每日热评｜X 源码解析」那一批。选题极对口、数字看着很硬，
  // 但它自己在开头和结尾写明没有跑过——按定义就不是「作者自己动手」。
  const report = scoreItem({
    title: 'GitHub每日热评｜OpenAI Codex 源码解析：一个 Rust 工具型项目是如何组织 CLI、工作流与测试的',
    excerpt:
      '本文基于 openai/codex 的指定源码快照进行静态分析，重点观察项目结构、工程化组织、测试布局和自动化流程。'
      + '本文未执行 Codex 源码、测试、构建、依赖漏洞扫描或生产环境部署。本次静态扫描得到的主要信息如下：'
      + '扫描范围内文件数 6432，主要实现语言 Rust，测试文件线索 647。',
    tail: '重点分析文件：codex-rs/tui/。本文结论类型：源码静态观察，未执行项目构建、测试、性能测试和安全审计。',
  });
  assert.ok(report.reasons.includes('自述未运行过的源码静态分析报告'));

  // 对照：同样是拆 Codex/Claude Code 的架构，但作者真的跑过、钉了版本号——不能被误伤
  const real = scoreItem({
    title: '拆 Claude Code 的 Harness：Agent Loop 很小，复杂度全长在它周围',
    excerpt:
      '我把版本钉在 v2.1.88 逐层读了一遍，最内层仍然是 messages → Model → Tool Call → Tool Result 这个很小的循环。'
      + '真正的复杂度是模型开始能改真实仓库之后：哪些 tool call 可以直接执行、哪些 side effect 必须先问、'
      + '我实测 context 满了之后 compaction 会把哪一段丢掉。',
  });
  assert.ok(!real.reasons.includes('自述未运行过的源码静态分析报告'));
  assert.ok(real.score > report.score);
});

test('「选型盘点」体被压到入围线下，真的挨个试过的横评不受影响', () => {
  // 2026-09-06：掘金一个内容农场把同一篇软文换三个标题发了三遍，三条全部进了当天
  // 33 席的入围名单。认得出它的不是语义是版式——每介绍一个工具就重复一遍
  // 「适合谁 / 解决什么问题 / 核心能力 / 使用边界 / 实际场景」。
  const listicle = scoreItem({
    title: '想搭建多智能体协作平台，怎么选适配的AI工具',
    excerpt:
      '很多刚接触多智能体搭建的用户会问，选平台的时候最在意的点集中在能不能不用写复杂代码就配置多 Agent 角色。'
      + '扣子：字节跳动旗下 AI Agent 平台。适合谁：零基础想尝试多智能体搭建的普通用户、自媒体创作者。'
      + '解决什么问题：解决单一 AI 只能单会话输出的问题。核心能力：在统一项目空间内配置多个角色的 Agent 并行协作。'
      + '使用边界：不侧重纯单轮聊天问答。实际场景：想搭建一套内容生产类多智能体协作流。',
  });
  assert.ok(listicle.reasons.includes('选型盘点体（固定小标题逐个介绍工具）'));
  // 扣 6 分对这一类等于没扣（它们的裸分是 13），所以判据是「压到入围线下」而不是「扣到了」。
  assert.ok(listicle.score < 6);

  // 对照：真的把几个工具挨个跑过、给了自己的数字的横评，不能被误伤。
  const handsOn = scoreItem({
    title: '同一个需求让 Cursor、Claude Code、Codex 各做一遍：三份 diff 和三个坑',
    excerpt:
      '我拿同一个 issue 让三个工具各跑一遍，记了每次的耗时、改动行数和人工返工次数。'
      + '适合谁：想在团队里选一个主力工具的人。Cursor 花了 18 分钟但漏掉了并发那条分支，'
      + '我实测 Claude Code 会主动跑测试，Codex 在 worktree 里踩了同名分支的坑。',
  });
  assert.ok(!handsOn.reasons.includes('选型盘点体（固定小标题逐个介绍工具）'));
});

test('小标题和冒号之间隔一个空格照样扣到——去标签之后语料里就是这个样子', () => {
  // 2026-09-07：原来的五条正则写的是 `适合谁[:：]`，要求冒号紧挨着小标题；
  // 而小标题在 HTML 里包在 <strong> 里，extractArticleText 去标签之后落到语料里的是
  // 「适用人群 ：」。当天量到 /适用人群[:：]/ 命中 0 条、/适用人群\s*[:：]/ 命中 3 条，
  // 同一份 371 条语料同一个词。这个洞最坏的地方是它不报警：
  // 「这个模板不存在」和「正则少写了两个字符」给出同一个 0。
  const spaced = scoreItem({
    title: 'Cursor平替方案有哪些：免费与高性价比替代工具横向对比分析',
    excerpt:
      '摘要 ：本文针对 Cursor 订阅费用偏高的问题，从价格、代码生成能力、Agent 能力、'
      + '中文适配度、迁移成本等维度，横向评测 TRAE、Windsurf、CodeBuddy、通义灵码四款候选平替方案。'
      + '适用人群 ：独立开发者、学生、小团队技术负责人。更新日期 ：2026年08月31日。'
      + '下面这张维度对比表汇总了四款工具在各个维度上的表现。',
  });
  assert.ok(spaced.reasons.includes('选型盘点体（固定小标题逐个介绍工具）'));
  assert.ok(spaced.score < 6);

  // 「更新日期」是三条新增里最泛的一条，单独出现不能扣分。
  const onlyOne = scoreItem({
    title: '我给自己的 Claude Code 配置写了一份长期维护的笔记',
    excerpt:
      '更新日期：2026-09-07。这份笔记记的是我这半年改 CLAUDE.md 踩的坑，'
      + '每改一次配置就回来补一段，包括那次把权限写太松导致 agent 删了未提交的改动。',
  });
  assert.ok(!onlyOne.reasons.includes('选型盘点体（固定小标题逐个介绍工具）'));
});

test('繁体写法的自荐招呼语也要扣到', () => {
  const trad = scoreItem({
    title: '我做了一個 Claude Code 的 statusline 外掛',
    excerpt: '核心功能有：1. 顯示 token 用量 2. 顯示分支。歡迎試用，也歡迎大家給我回饋。',
    thread: true,
  });
  assert.ok(trad.reasons.includes('疑似产品自荐帖'));
});

test('自荐招呼语的三种漏写法：全角方括号、欢迎大佬、征求意见', () => {
  // 2026-08-18：DSH 发布周当天 57 个入围席位里 13 席是自荐帖，这张表一条都没扣到。
  // 三条各对应一种漏法，都不是新判据，是同一套招呼语的写法没写全。
  const cases = [
    // 全角方括号：`[开源]` 早就在表里，linux.do 写的是「【开源】」
    { title: '【开源】codex 浏览器插件平替，可以无缝接入 opencode 等工具中', excerpt: '装上就能用。' },
    // V2EX 的节点名，那个节点本来就是发自己作品的地方
    {
      title: '[分享创造] 我把我的一人公司跑成了一块 kanban board',
      excerpt: '公司只有我一个创始人，另外 8 个员工全是 AI agent，用 Hermes 跑，靠 board 协作。',
    },
    // 「欢迎大家」写成了「欢迎大佬」
    { title: '装 DSH 插件时发现疑似后门，于是我连夜手搓两个 Plugins，欢迎大佬提提意见', excerpt: '安装前我顺手翻了下源码。' },
    // 征求意见的招呼语整类没有
    { title: '我写了个 DeepSeek Harness 的插件，请大家锐评一下', excerpt: '让 dsh 记住这个项目里什么命令成功过。' },
  ];
  for (const c of cases) {
    const r = scoreItem({ ...c, source: 'V2EX 搜索', kind: 'search' });
    assert.ok(r.reasons.includes('疑似产品自荐帖'), `没扣到：${c.title}`);
  }

  // 同一天收录的条目一条都不能被这几个词误伤
  const real = scoreItem({
    title: '把 DSH（DeepSeek Harness）部署到服务器：手机、电脑实时同步',
    excerpt: 'dsh web 默认只监听 127.0.0.1:3080，而且 CLI 直接禁止 --host 0.0.0.0，所以只能走 nginx 反代。',
  });
  assert.ok(!real.reasons.includes('疑似产品自荐帖'));
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

test('连载罚分在正文经验词够多时减半，教学连载不受影响', () => {
  // 2026-08-13：iT 邦幫忙铁人赛赛季里，那个平台上**所有**连载都叫 Day N，
  // 包括真折腾。分开两者的不是标题形状而是正文经验词密度：
  // 191 篇实测样本里教学连载是 1-3 个，被误杀的那篇实录是 4 个。
  const tutorial = scoreItem({
    title: 'Day 01｜什麼是Vibe Coding？當寫程式變成一場自然語言的對話',
    excerpt: '本篇介紹 Vibe Coding 的概念與由來，並示範一次最簡單的對話式開發流程。'.repeat(20),
  });
  assert.ok(tutorial.reasons.includes('连载章节体标题'));
  assert.ok(!tutorial.reasons.includes('连载章节体标题（正文够实，减半）'));

  const hands0n = scoreItem({
    title: 'Day 13：我的 AI 沒有資料庫全 Markdown 架構的瘋狂與合理',
    excerpt: ('这半年自己踩的坑是并发写入：两个系统同时写同一份 MEMORY.md 会互相覆盖。'
      + '实测下来 grep 撑不住之后才换 SQLite，又遇到写入锁冲突，最后拆成两个库。'
      + 'AGENTS.md 的品质闸道是唯一的软性约束，记录在这里备查。').repeat(6),
  });
  assert.ok(hands0n.reasons.includes('连载章节体标题（正文够实，减半）'));
  // 减半之后总分要比按 4 分罚高出正好 2 分——罚分本身没被取消。
  assert.ok(hands0n.score > tutorial.score);
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
    titleOriginal: `我用 Claude Code 在 ${source} 折腾了第 ${i} 个项目的实践记录`,
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

  // 2026-08-24：岗位词不一定紧挨着「招」，中文招聘帖的正常语序是「招 <技术栈> <岗位>」。
  // 这条以前拿 6 分进了入围名单，因为「招」和「工程师」之间隔着 15 个字符。
  const stack = scoreItem({
    title: '[深圳] AI 智能硬件 + App 海外产品，招 Ruby on Rails 工程师',
    excerpt: '团队在用 Claude Code，有 agent 实践经验优先。'.repeat(10),
    thread: true,
  });
  assert.equal(stack.verdict, 'reject');
  assert.ok(stack.reasons.includes('招聘 / 接单帖'));
});

test('标题不招供的招聘帖，靠正文里的 JD 表单结构毙掉', () => {
  // 2026-09-03：V2EX「AI 工作流工程师/高级 GO/后端---Remote」拿 6 分占了一个入围席位。
  // 标题里既没有「招」也没有薪资数字，两条只吃标题的判据一条都不命中，
  // 而正文是一份齐整的 JD。判据换成 JD 的固定小标题，且要命中两个不同的才算。
  const jd = scoreItem({
    title: 'AI 工作流工程师/高级 GO/后端---Remote',
    excerpt: 'AI 工作流工程师 25k-38k 业务方向：在线视频 · 交友 · 出海社交。'
      + '📌 岗位职责 1. 参与用户体系、视频播放、互动聊天等核心业务模块建设。'
      + '2. 参与 AI 工作流与 Agent 编排能力的工程化建设，包括流程配置、多模型串联、工具调用。'
      + '🎯 任职要求 1. 本科及以上学历，5 年以上开发经验。2. 熟练掌握 Go 语言。',
    thread: true,
  });
  assert.equal(jd.verdict, 'reject');
  assert.ok(jd.reasons.includes('招聘 / 接单帖'));

  // 只命中一个小标题不算——门槛是 2 个，理由是 JOB 硬毙、代价不对称。
  // 一篇讲「agent 会不会顶掉某个岗位」的正经文章顺口写一次「岗位职责」是可能的。
  const oneHeading = scoreItem({
    title: '我让 Claude Code 照着岗位职责写团队规范，然后自己推翻了',
    excerpt: '把岗位职责那一段丢给 agent 之后踩了几个坑，记录一下实际怎么改的。'.repeat(20),
    kind: 'blog',
  });
  assert.equal(oneHeading.verdict, 'shortlist');

  // JD 的「任职要求」常压在最后，而 excerpt 截在 2500 字符——判据要连 tail 一起读。
  const inTail = scoreItem({
    title: 'Go 后端 + Agent 方向',
    excerpt: `团队在用 Claude Code 做 agent 编排。${'岗位职责：负责服务端开发。'.repeat(40)}`,
    tail: '任职要求：五年以上经验，熟悉 MCP 与多模型串联。',
    thread: true,
  });
  assert.equal(inTail.verdict, 'reject');
  assert.ok(inTail.reasons.includes('招聘 / 接单帖'));
});

test('单边薪资的招聘帖要毙掉，但 token / 上下文的数字区间不能误伤', () => {
  // 2026-08-03 的 rejected 里这两条各拿 5 分，离入围线只差 1 分。
  // 「30-60K」只在末尾标单位，旧正则要求两边都带 K，整条漏掉。
  const salary = scoreItem({
    title: '远程资深后端工程师 / 后端技术专家（Go+ PHP / AI 效能方向）30-60K',
    excerpt: '团队在用 Copilot，有 agent 经验优先，我们已经跑了一年多的实践。'.repeat(8),
    thread: true,
  });
  assert.equal(salary.verdict, 'reject');
  assert.ok(salary.reasons.includes('招聘 / 接单帖'));
  // 「直招 急聘」整条标题里一个岗位词都没有，靠招聘词组命中
  const noRole = scoreItem({
    title: '联想 天津 直招 急聘 又来了',
    excerpt: '有 AI 编程方向的坑位，我们自己也在折腾 agent，记录一下。'.repeat(8),
    thread: true,
  });
  assert.ok(noRole.reasons.includes('招聘 / 接单帖'));

  // 关键的反面：JOB 是硬毙，代价不对称。把左边的 K 直接改成可选会无声毙掉这类标题，
  // 而它们恰恰是这个项目最想收的。所以松薪资形状必须和岗位词同时出现才生效。
  for (const title of [
    '用 Claude Code 把上下文从 5-10K token 压到 2K，实测踩坑记录',
    'Claude Code 折腾记：8-32K 上下文窗口实测体验',
    '我把 Codex 的 token 从 10-20W 降下来的折腾过程',
  ]) {
    const r = scoreItem({ title, excerpt: '记录一下我的配置和工作流，踩了几个坑。'.repeat(20) });
    assert.equal(r.verdict, 'shortlist', `不该被判成招聘帖：${title}`);
  }
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

// 标题里带上 source：这些 fixture 测的是配额分配，不是同题去重。
// 不带的话，不同源的同序号条目会构成「严格同题」而被判成同一篇（2026-08-29 加的那道闸）。
const mkItem = (i, source, thread) => ({
  id: `${source}${i}`, source, thread, url: `https://e.com/${source}${i}`,
  titleOriginal: `我用 Claude Code 在 ${source} 折腾了第 ${i} 个项目的实践记录`,
  excerpt: '踩坑心得，配置工作流，实测有效。'.repeat(80),
});

test('搜索源返回文章时不受论坛占比约束', () => {
  // kind 描述「怎么抓」，thread 描述「抓到什么」。掘金搜索和 V2EX 搜索的 kind
  // 都是 search，但前者返回文章、后者返回论坛帖，只有后者该被压。
  const items = Array.from({ length: 25 }, (_, i) => mkItem(i, `掘金搜索${i % 3}`, false));
  const { shortlist } = triage(items, { cap: 60, quota: 8 });
  assert.ok(shortlist.length >= 20, `文章型搜索源不该被占比上限压到 ${shortlist.length}`);
  assert.ok(shortlist.every((it) => !it.thread));
});

test('补位轮不能无视按源配额，一个源不该整个吃下名单', () => {
  // 2026-08-04：补位轮完全不看 used，掘金搜索一家在 60 席里拿了 45 席（配额是 8），
  // 当天名单八成是同一个内容农场的「X 平替方案有哪些」横评稿，
  // 而当天分数最高的那条在名单外。补位放宽到 quota * QUOTA_RELAX 为止。
  const items = [
    ...Array.from({ length: 50 }, (_, i) => mkItem(i, '内容农场', false)),
    ...Array.from({ length: 4 }, (_, i) => mkItem(i, `博客${i}`, false)),
  ];
  const { shortlist, rejected } = triage(items, { cap: 60, quota: 8 });
  const farm = shortlist.filter((it) => it.source === '内容农场').length;
  assert.equal(farm, 8 * QUOTA_RELAX, `高产源最多拿 quota*QUOTA_RELAX 席，实际 ${farm}`);
  assert.equal(shortlist.filter((it) => it.source !== '内容农场').length, 4, '别的源一条都不该被挤掉');
  // 名单因此比 cap 短，这是要的结果：入围名单是评审预算，不是必须填满的额度。
  assert.ok(shortlist.length < 60);
  assert.equal(shortlist.length + rejected.length, items.length, '总数必须守恒');
});

test('论坛占比是预留席位，文章供给充足时也要留给论坛', () => {
  // 2026-08-04：文章先按 cap 取满后 `cap - takenArticles.length` 恒为 0，
  // FORUM_SHARE 在文章够多的日子里等于没写——当天 16 分（全场最高）的
  // V2EX 帖被判「已达占比上限」，而名单被掘金的横评农场文占满。
  const items = [
    ...Array.from({ length: 80 }, (_, i) => mkItem(i, `博客${i}`, false)),
    ...Array.from({ length: 10 }, (_, i) => mkItem(i, '论坛', true)),
  ];
  const { shortlist } = triage(items, { cap: 60, quota: 8 });
  const forums = shortlist.filter((it) => it.thread).length;
  assert.ok(forums > 0, '文章供给充足时论坛也不该归零');
  assert.ok(forums <= Math.round(60 * 0.4), `论坛仍不该超过占比上限，实际 ${forums}`);
});

test('裸 codex 要命中，但 Claude / Qwen / Kimi 这些模型名不给它们的 CLI 条目加裸别名', () => {
  // 2026-08-03 体检发现的最大漏网：语料里 21 次提到 Codex，只有 2 次被认出来，
  // 因为条目名是「Codex CLI」而别名里没有裸词。
  assert.ok(matchTools('Cursor、Claude、Codex 深度体验与对比').includes('codex'));
  assert.ok(matchTools('分享一下我现在的 codex 子 agent 配置').includes('codex'));
  // 词边界仍然管用
  assert.deepEqual(matchTools('the codexes in the medieval library'), []);
  // 反面：裸「Claude」是模型名，不该被当成 Claude Code / Desktop / Cowork
  const bare = matchTools('我用 Claude 帮我改了篇稿子');
  for (const id of ['claude-code', 'claude-desktop', 'cowork']) assert.ok(!bare.includes(id), id);
});

test('Superpowers 只认复数，单数是普通英文词', () => {
  assert.ok(matchTools('装了 obra 的 Superpowers 之后，agent 终于肯先查 skill').includes('superpowers'));
  assert.deepEqual(matchTools('大模型是每个开发者的 superpower'), []);
});

test('TRAE Work 不算 Trae：名字被整个包住时，光拆词条不够，要靠 not 遮罩', () => {
  // 2026-08-11：555 条语料里 `trae work` 命中 15 条、14 条在标题，
  // 而 `trae` 全部 26 条标题命中里这批占了一多半——页面上「Trae」筛选器
  // 点进去过半是字节的办公 agent。和 workbuddy / cowork 是同一类「认错人」，
  // 但那次两个名字不共字，拆开就完了；这次 TRAE Work 里带着 Trae。
  const promo = matchTools('AntiGravity平替对比：TRAE Work能否胜任AI开发与办公混合场景？');
  assert.ok(promo.includes('trae-work'));
  assert.ok(!promo.includes('trae'), 'TRAE Work 稿不该同时挂到 Trae 的筛选器上');
  // 遮罩只抹掉被排除的那几个字，剩下的裸 Trae 照常算数
  const both = matchTools('TRAE Work vs Trae：办公和写代码到底该用哪个');
  assert.ok(both.includes('trae') && both.includes('trae-work'));
  assert.ok(matchTools('TRAE_初体验，拿它写了个 Chrome 插件').includes('trae'));
  // 连写形式也要认出来
  assert.ok(matchTools('WorkBuddy 与 TraeWork：微信遥控电脑的 AI 办公新范式').includes('trae-work'));
  // 词条加了，但不派生查询词——它的中文语料几乎全是投稿稿
  assert.deepEqual(rotatingQueries().filter((q) => /trae\s*work/i.test(q)), []);
});

test('裸 Claude 是独立产品，但要被四个同名产品和 CLAUDE.md 让开', () => {
  // 2026-08-24 加的。动机是「规则层结构性看不见的一类作者」：iT 邦幫忙那批繁中系列
  // 通篇只写「Claude」不写产品全名，工具命中恒为 0，分数上不去。
  assert.ok(matchTools('讓 Claude 寫一份不給 Claude 用的提示詞').includes('claude'));
  assert.ok(matchTools('用 claude.ai 网页版把一段说明做成可以玩的页面').includes('claude'));
  // 被整个包住的四个产品名要让开，否则每篇 Claude Code 稿都白送一个 claude 标签
  for (const t of ['我用 Claude Code 重写了整个模块', 'Claude Desktop 的 Cowork mode 能碰本机档案',
    '从 Claude Code 到 Claude Tag，Agent 走到了组织这一层']) {
    assert.ok(!matchTools(t).includes('claude'), t);
  }
  // 同时提到两者时两个都算，和 TRAE Work / Trae 一致
  const both = matchTools('同一件事在 Claude Code 里做和在 Claude 网页版里做，差在哪');
  assert.ok(both.includes('claude') && both.includes('claude-code'));
  // CLAUDE.md 是话题不是产品：`claude` 后面跟的 `.` 不是拉丁字母，词边界拦不住，只能靠遮罩
  assert.deepEqual(matchTools('我给项目写了 CLAUDE.md'), []);
  assert.ok(matchTopics('我给项目写了 CLAUDE.md').includes('claude-md'));
  // 名字太泛，不派生查询词（「Claude 实践」搜出来是官网、新闻和中转站）
  assert.deepEqual(rotatingQueries().filter((q) => /^claude\s*(实践|踩坑|体验)$/i.test(q)), []);
});

test('聚合站 AI 摘要页整源不进名单，但照常打分并留在 rejected 里', () => {
  // BestBlogs.dev 那类源：条目本身分数很高（它就是在筛 agent 好文），
  // 但落地页是站方生成的摘要而不是作者原文，评审那一步一律不收。
  // 创刊 7 天它天天有 2-3 条占着名单席位，累计收录 0 条。
  const mk = (i, extra = {}) => ({
    id: `id${i}`, source: '摘要站', url: `https://e.com/${i}`,
    titleOriginal: `我用 Claude Code 折腾了第 ${i} 个项目的实践记录`,
    excerpt: '踩坑心得，配置工作流，实测有效。',
    ...extra,
  });
  const items = [
    ...Array.from({ length: 3 }, (_, i) => mk(i, { summaryPage: true })),
    ...Array.from({ length: 2 }, (_, i) => mk(100 + i)),
  ];
  const { shortlist, rejected } = triage(items, { cap: 60, quota: 8 });

  assert.equal(shortlist.length, 2, '只有非摘要页的两条进名单');
  assert.ok(shortlist.every((it) => !it.summaryPage));
  const dropped = rejected.filter((r) => r.reasons.includes('聚合站 AI 摘要页，按编辑规则整类不收'));
  assert.equal(dropped.length, 3, '三条摘要页都要留痕，不能静默丢失');
  // 分数要留着：高分的落选条目正是「该去接哪个原文源」的线索。
  assert.ok(dropped.every((r) => r.score >= SHORTLIST_THRESHOLD), '毙掉也要带上原本的分数');
});

test('summaryPage 是源级开关，没标的源不受影响', () => {
  const items = Array.from({ length: 2 }, (_, i) => ({
    id: `id${i}`, source: '普通博客', url: `https://e.com/${i}`,
    titleOriginal: `我用 Codex 折腾了第 ${i} 个项目的实践记录`,
    excerpt: '踩坑心得，配置工作流，实测有效。',
  }));
  const { shortlist } = triage(items, { cap: 60, quota: 8 });
  assert.equal(shortlist.length, 2);
});

test('抓不到正文的条目按名额封顶，不吃掉能读的席位', () => {
  // 2026-08-10：掘金一波 TRAE Work 投稿全部补全失败，22 席里 13 席是打不开的标题。
  // thin 席位创刊以来 54 → 收录 2（3.7%），非 thin 148 → 收录 31（21%）。
  const mk = (i, thin) => ({
    id: `${thin ? 't' : 'r'}${i}`, source: thin ? '搜索源' : `博客${i}`,
    url: `https://e.com/${thin ? 't' : 'r'}${i}`,
    titleOriginal: `我用 Claude Code ${thin ? '抓不到正文地' : '完整地'}折腾了第 ${i} 个项目的实践记录`,
    excerpt: '踩坑心得，配置工作流，实测有效。'.repeat(40),
    ...(thin ? { thin: true } : {}),
  });
  const items = [
    ...Array.from({ length: 20 }, (_, i) => mk(i, true)),
    ...Array.from({ length: 12 }, (_, i) => mk(i, false)),
  ];
  const { shortlist, rejected } = triage(items, { cap: 60, quota: 8 });

  const thinIn = shortlist.filter((it) => it.thin).length;
  assert.equal(shortlist.length - thinIn, 12, '能读的条目一条都不该被挤掉');
  assert.equal(thinIn, 4, '12 条能读的对应 25% 占比 = 4 席 thin');
  assert.equal(shortlist.length + rejected.length, items.length, '总数必须守恒');
  assert.ok(
    rejected.filter((r) => r.reasons.some((x) => x.includes('抓不到正文的条目已达当日名额'))).length === 16,
    '被名额挡下的 thin 条目要留痕，不静默消失',
  );
});

test('全天供给都抓不到正文时仍留 THIN_FLOOR 席，不至于整天空转', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({
    id: `t${i}`, source: '搜索源', thin: true, url: `https://e.com/t${i}`,
    titleOriginal: `我用 Codex 折腾了第 ${i} 个项目的实践记录`,
    excerpt: '踩坑心得，配置工作流，实测有效。'.repeat(40),
  }));
  const { shortlist } = triage(items, { cap: 60, quota: 8 });
  assert.equal(shortlist.length, THIN_FLOOR, `能读的一条都没有时按地板给席位，实际 ${shortlist.length}`);
});

test('thin 名额切在配额之前，腾出的席位让能读的条目补进来', () => {
  // 顺序很关键：先切 thin 再分配额，被单源配额挤出去的能读条目才补得回来。
  const mk = (i, thin) => ({
    id: `${thin ? 't' : 'r'}${i}`, source: '掘金搜索', url: `https://e.com/${thin ? 't' : 'r'}${i}`,
    titleOriginal: `我用 Cursor ${thin ? '抓不到正文地' : '完整地'}折腾了第 ${i} 个项目的实践记录`,
    excerpt: '踩坑心得，配置工作流，实测有效。'.repeat(40),
    ...(thin ? { thin: true } : {}),
  });
  // 同一个源：14 条 thin + 6 条能读，配额 8、放宽到 16。
  const items = [...Array.from({ length: 14 }, (_, i) => mk(i, true)), ...Array.from({ length: 6 }, (_, i) => mk(i, false))];
  const { shortlist } = triage(items, { cap: 60, quota: 8 });
  assert.equal(shortlist.filter((it) => !it.thin).length, 6, '6 条能读的全部进名单');
});

test('规格驱动开发认得 SDD 和「规范驱动」两种写法', () => {
  // 2026-08-11：947 条语料里讲这件事的 14 条，旧别名只认出 6 条。
  // SDD 是三字母缩写（危险的形状），加之前逐条查过 10 条命中，没有一条是别的意思。
  assert.deepEqual(matchTopics('再见 SDD——Spec 驱动开发为何不适合大多数项目'), ['spec-driven']);
  assert.deepEqual(matchTopics('试试这套 SDD 规范驱动工作流'), ['spec-driven']);
  assert.deepEqual(matchTopics('Spec Kit 入门：规格驱动开发实践'), ['spec-driven']);
});

test('worktree 认得 git worktree 这个固定搭配，但仍不收裸 worktree', () => {
  // 旧别名要求限定词紧挨着 worktree，于是「我用 git worktree 让多个 Agent 互不打架」
  // 这种把限定词放在句子里的写法全部漏掉：19 条提到 worktree 的只认出 4 条。
  assert.deepEqual(matchTopics('多个 AI Agent 同时改一个项目，我用 git worktree 让它们互不打架'), ['worktree']);
  assert.deepEqual(matchTopics('面向 Coding Agent 的多仓库 Git Worktree'), ['worktree']);
  // 裸 worktree 仍然不收：讲分支管理的文章会误伤。
  assert.deepEqual(matchTopics('worktree 是个被低估的功能'), []);
});

test('Agent 记忆认得「长期记忆」，Agent Skills 认得单数写法', () => {
  assert.deepEqual(matchTopics('AI Agent 长期记忆怎么存？'), ['agent-memory']);
  assert.ok(matchTopics('把 OpenSpec 做成一个 Agent Skill').includes('skills'));
  assert.ok(matchTopics('Claude Code 的 agent skills 目录怎么组织').includes('skills'));
});

test('Graph Engineering 只收英文写法，「图工程」不收', () => {
  assert.deepEqual(matchTopics('Loop Engineering 之后是什么？Graph Engineering 完整拆解').sort(), ['graph-engineering', 'loop-engineering']);
  // 三个字，是「制图工程」「地图工程」的一段——和「心流 → 核心流程」同类。
  assert.deepEqual(matchTopics('我们院的制图工程专业'), []);
});

test('ai coding 是泛 agent 词，能单独把条目从「没命中任何词」里救出来', () => {
  // 表里一直有 `ai 编程` / `coding agent`，唯独漏了同样常用的这个英文写法（语料里 24 条）。
  const r = scoreItem({ title: '一篇 AI Coding 生态发展的自省记述', excerpt: '我折腾了三个月的记录。' });
  assert.ok(!r.reasons.includes('没有命中任何 agent 相关词'));
  assert.ok(r.reasons.some((x) => x.startsWith('泛 agent 词')));
});

test('裸 harness 收了，但 DeepSeek Harness 的名字不许再被数第二遍', () => {
  // 2026-08-17：把 `DeepSeek Harness` 抹掉之后仍出现裸 harness 的 52 条语料，
  // 逐条看完全部是 agent 语境；反例（test harness / wire harness / 线束）0 条。
  assert.deepEqual(matchTopics('Matt Pocock 的 AI 工程工作流：与其追模型，不如造 harness'), ['harness']);
  assert.deepEqual(matchTopics('AI 写代码老跑偏？我给 Agent 套了层 Harness 缰绳'), ['harness']);
  // 但 DSH 稿只算 dsh 一次：产品名整个包住了话题词，不遮罩就等于同一个名字加两遍分。
  const dshOnly = matchVocab('DeepSeek Harness 桌面端开源：一切皆插件');
  assert.deepEqual(dshOnly.tools, ['dsh']);
  assert.deepEqual(dshOnly.topics, []);
  // 同时提到两者的标题仍然两个都命中（遮罩只抹掉被包住的那一处写法）。
  const both = matchVocab('DeepSeek Harness 和别的 harness 到底该怎么选');
  assert.ok(both.tools.includes('dsh') && both.topics.includes('harness'));
});

test('Agent Skills 收裸英文 skill，但中文「技能」仍然不收', () => {
  // 153 条含裸英文 skill 的语料里，soft skill / skill tree / 技能树这类反例 0 条；
  // 而中文的「技能要求」「技能包括」在招聘帖里满地都是，中文没有词边界，收不得。
  assert.ok(matchTopics('我写了一个 300 行的 AI 开发流程 Skill：先找现成轮子').includes('skills'));
  assert.ok(matchTopics('给 Codex 接了个 Everything 文件搜索 Skill').includes('skills'));
  assert.deepEqual(matchTopics('岗位要求：技能包括熟悉分布式系统'), []);
});

test('「低价」是「低价值」的一段，不该按营销词毙掉', () => {
  // 2026-08-17 的误杀：作者把 qwen-code-dev-bot/oh-my-cli 拉下来数了 841 次提交、
  // 把人类那 13 次逐条点开，只因为正文里有一句「不允许发明低价值工作」被扣 4 分。
  const r = scoreItem({
    title: 'AI 写了一个月代码，人类只提交 13 次',
    excerpt: '我把那个仓库拉下来读了一遍。841 次提交里人类占 13 次，实测下来人类没写一行业务代码。'
      + '原文写着：空的待办列表意味着「空闲」，而不是「允许发明低价值工作」。',
  });
  assert.ok(!r.reasons.some((x) => x.includes('营销词')), r.reasons.join('；'));
  // 真的黑产帖仍然拦得住——它们每一条都同时命中「中转」这类精确得多的词
  // （标题里的中转是硬毙，正文里的算营销词）。
  assert.equal(scoreItem({ title: 'Claude Code 低价中转，稳定不掉线', excerpt: '低价出，欢迎联系。' }).verdict, 'reject');
  const inBody = scoreItem({
    title: '我用 Claude Code 折腾了一周的配置',
    excerpt: '实测下来还是走中转便宜，低价渠道我试了三家，踩坑记录如下。',
  });
  assert.ok(inBody.reasons.some((x) => x.includes('营销词')));
});

test('新词条：Reasonix / Prime Agent / MEMORY.md', () => {
  assert.ok(matchTools('Reasonix 安装配置教程：DeepSeek 编程 Agent 入门指南').includes('reasonix'));
  assert.ok(matchTools('DeepSeek-Reasonix：99.82% 的缓存命中砍掉 5 倍成本').includes('reasonix'));
  assert.ok(matchTools('Prime Agent 这个「会自我进化的编码 Agent」到底什么来头').includes('prime-agent'));
  // 裸 prime 是 Prime Video / 素数 / Amazon Prime，不收。
  assert.deepEqual(matchTools('Amazon Prime 会员值不值'), []);
  assert.ok(matchTopics('人格、记忆全是纯文本：SOUL.md 管语气，MEMORY.md 管记忆').sort().includes('memory-md'));
});

test('已收录条目的转帖不占入围席位（严格同题）', () => {
  // 2026-08-19 实测到的两例都是同一个形状：作者先发平台、我们从平台收了，
  // 之后他的个人站被接进 sources.json，同一篇又以另一个 URL 回来一次。
  // seen.json 按 id/url 去重，对这种情况完全无效。
  const mk = (i, source, title) => ({
    id: `id${i}`, source, url: `https://${source}.example/${i}`,
    titleOriginal: title,
    excerpt: '踩坑记录，实测配置，工作流复盘。',
  });
  const items = [
    mk(1, 'v2ex', '如何最大化 Claude Code Session 的价值'),
    mk(2, 'blog', '如何最大化 Claude Code Session ​的价值'), // 全角空格 + 零宽字符也算同题
    mk(3, 'blog', '如何最大化 Codex Session 的价值'), // 换了工具名就是另一篇
  ];
  const published = new Set([titleKey('如何最大化 Claude Code Session 的价值')]);
  const { shortlist, rejected } = triage(items, { cap: 60, quota: 8, publishedTitles: published });
  assert.deepEqual(shortlist.map((it) => it.id).sort(), ['id3']);
  assert.equal(shortlist.length + rejected.length, items.length, '被判转帖的也要留在 rejected 里');
  assert.ok(rejected.every((r) => r.id === 'id3' || r.reasons.some((x) => x.includes('转帖'))));
  // 不传 publishedTitles 时那两条不再算「已出刊的转帖」，但它们仍然是同一篇：
  // 2026-08-29 起本轮之内的严格同题也只留一条，所以是 2 不是 3。
  assert.equal(triage(items, { cap: 60, quota: 8 }).shortlist.length, 2);
});

test('新话题词：Agent Loop（不收连写的 agentloop——那是阿里云的产品名）', () => {
  assert.ok(matchTopics('Pi 与 DeepSeek Harness：Agent Loop 该由谁组织').includes('agent-loop'));
  assert.ok(matchTopics('把 agent 循环拆开看：工具调用之前发生了什么').includes('agent-loop'));
  assert.ok(matchTopics('智能体循环的本质是什么').includes('agent-loop'));
  assert.ok(!matchTopics('阿里云 AgentLoop 三城沙龙报名').includes('agent-loop'));
  // 裸「主循环」是游戏 / 事件主循环的常用说法，不收。
  assert.ok(!matchTopics('用 SDL 写一个游戏主循环').includes('agent-loop'));
});

test('结尾判据量的是正文真正的结尾（tail），不是被截断的 excerpt 的腰', () => {
  // 2026-08-20：excerpt 截在 2500 字符，当天 36 个入围条目里 19 条被截断，
  // 对它们来说 excerpt.slice(-400) 取的是正文的腰，而自荐帖的招呼语压在最后一段。
  const args = {
    title: '我给 DeepSeek Harness 做了个不产生计费的联网搜索插件',
    excerpt: `实测下来单次搜索延迟 10-20 秒，踩了反爬的坑，改了 UA 才稳定。${'正文。'.repeat(900)}`,
  };
  const blind = scoreItem(args);
  assert.ok(!blind.reasons.includes('结尾落在推广语上'), '截断的 excerpt 里没有招呼语');
  const withTail = scoreItem({ ...args, tail: 'GitHub：https://github.com/x/y（MIT 协议开源，欢迎 star、贡献）' });
  assert.ok(withTail.reasons.includes('结尾落在推广语上'));
  assert.equal(withTail.score, blind.score - 3);

  // 没传 tail 时行为完全不变：正文没被截断的话，excerpt 自己的尾巴就是真尾巴
  // （招呼语要落在开头 400 字符之外，否则命中的是更重的那条「疑似产品自荐帖」）
  const short = scoreItem({
    title: 'Claude Code 折腾记录',
    excerpt: `${'踩了三个坑，实测记录。'.repeat(50)}代码在 GitHub，欢迎 star。`,
  });
  assert.ok(short.reasons.includes('结尾落在推广语上'));
  assert.ok(!short.reasons.includes('疑似产品自荐帖'));
});

test('自荐词表：欢迎 star 和求 star 是同一个意思', () => {
  const r = scoreItem({
    title: 'FutureOS：用 Rust 写了一个通用 AI Agent',
    excerpt: '核心是一个 agent 循环，欢迎star、贡献，README 有完整安装说明。',
  });
  assert.ok(r.reasons.includes('疑似产品自荐帖'));
  // 「关注我」是站点级签名档，不是落点，不能算自荐（LESSONS：站点级页脚广告不算软文）
  const sig = scoreItem({
    title: '用 Claude Code 重写了备份脚本，踩了三个坑',
    excerpt: '我把实测过程记下来：第一次跑挂在权限上，第二次是路径。关注我，和 AI 一起成长～',
  });
  assert.ok(!sig.reasons.includes('疑似产品自荐帖'));
});

test('claude 裸词条：`_` 和 `/` 也是合法词边界，别把 Claude Code 的东西认成聊天产品', () => {
  // 2026-08-27。裸 `claude` 的 not 表原来只挡了 `.`（CLAUDE.md），
  // 而环境变量 `CLAUDE_CODE_MAX_RETRIES`、配置目录 `~/.claude/settings.json`、
  // `claude_desktop_config.json` 里的分隔符是 `_` 和 `/`——同样不是拉丁字母，
  // 同样是词边界，于是三样都被判成了 claude.ai 那个聊天产品。
  const cases = [
    '可以用环境变量 CLAUDE_CODE_MAX_RETRIES 覆盖默认的重试次数',
    '把模块装进项目的 .claude/skills/ 目录下就能用',
    '注册表在 ~/.claude/sessions/ 里，每次会话一条',
    '改 claude_desktop_config.json 里的 mcpServers 就行',
  ];
  for (const text of cases) {
    assert.ok(!matchTools(text).includes('claude'), `不该认成聊天产品：${text}`);
  }
  // 反面：拿斜杠当顿号的列举说的确实是这个聊天产品，不能一起挡掉
  assert.ok(matchTools('把 Google Veo 接进 Claude/Cursor：一份上手指南').includes('claude'));
  assert.ok(matchTools('我在 claude.ai 网页版上试了一下').includes('claude'));
});

test('本轮之内的严格同题只留一条，且优先留能读的那条', () => {
  // 2026-08-29：474 条原始条目里 7 组严格同题、多吃 11 个席位，
  // 最大一组是掘金作者「好的999」把同一个标题发了 6 遍，4 条进了入围名单。
  // publishedTitles 挡的是「已出刊的那篇又来一次」，挡不住同一轮内的同一篇。
  const mk = (i, extra = {}) => ({
    id: `d${i}`, source: '掘金搜索', url: `https://e.com/d${i}`,
    publishedAt: `2026-08-2${i}T00:00:00Z`,
    titleOriginal: '5.28 文章改写：用 Claude Code 接入 GLM-5.1 的完整配置指南',
    excerpt: '踩坑心得，配置工作流，实测有效。'.repeat(40),
    ...extra,
  });
  // 分最高的那条是 thin：能读的要赢它。
  const items = [mk(1, { thin: true, excerpt: '踩坑心得，配置工作流，实测有效，agent 折腾记录。'.repeat(40) }), mk(2), mk(3), mk(4)];
  const { shortlist, rejected } = triage(items, { cap: 60, quota: 8 });

  assert.equal(shortlist.length, 1, '同一篇只占一个评审席位');
  assert.equal(shortlist[0].thin, undefined, 'thin 的那条留下来只是个打不开的标题，要让给能读的');
  const dropped = rejected.filter((r) => r.reasons.includes('与本轮另一条严格同题，判为同一篇，只留最好的一条'));
  assert.equal(dropped.length, 3, '落选的三条要留痕，理由要能一眼看出是哪条规则挡的');
  assert.equal(shortlist.length + rejected.length, items.length, '总数必须守恒');
});

test('严格同题不比作者——跨源转帖两边的 author 常常一边有一边空', () => {
  // 那 7 组里有 2 组是这个形状：《HelloGitHub》第 125 期同时来自 V2EX 和
  // HelloGitHub 自己的 feed，一边带作者一边不带。要求同作者会恰好漏掉它们。
  const base = {
    titleOriginal: '我用 Claude Code 折腾了一个月的实践记录',
    excerpt: '踩坑心得，配置工作流，实测有效。'.repeat(40),
  };
  const items = [
    { id: 'a', source: 'V2EX 搜索', url: 'https://v2ex.com/t/1', author: 'xueweihan', ...base },
    { id: 'b', source: '某博客', url: 'https://blog.example.com/1', author: '', ...base },
  ];
  const { shortlist } = triage(items, { cap: 60, quota: 8 });
  assert.equal(shortlist.length, 1, '作者字段一边有一边空，仍然是同一篇');
});

test('标题不同的条目一条都不许被同题去重误伤', () => {
  const items = Array.from({ length: 5 }, (_, i) => ({
    id: `u${i}`, source: '掘金搜索', url: `https://e.com/u${i}`,
    titleOriginal: `我用 Claude Code 折腾了第 ${i} 个项目的实践记录`,
    excerpt: '踩坑心得，配置工作流，实测有效。'.repeat(40),
  }));
  const { shortlist } = triage(items, { cap: 60, quota: 8 });
  assert.equal(shortlist.length, 5, '只差一个字也是两篇，不能按相似度合并');
});

test('新工具词：Docker Sandboxes（sbx）', () => {
  assert.ok(matchTools('Docker Sandboxes 上手：从安装到第一次跑 Agent').includes('docker-sandboxes'));
  assert.ok(matchTools('把 Coding Agent 丢进 docker sandbox 里跑').includes('docker-sandboxes'));
  assert.ok(matchTools('sbx run opencode 之后模型登录才是麻烦事').includes('docker-sandboxes'));
  // 通用说法不收：中文写沙箱不写 sandbox，「用 Docker 做沙箱」不是这个产品。
  assert.ok(!matchTools('用 Docker 沙箱隔离构建环境').includes('docker-sandboxes'));
  assert.ok(!matchTools('sandbox 里跑测试').includes('docker-sandboxes'));
});

test('繁体经验词：iT 邦 / vocus 那批作者不该因为字形被系统性降权', () => {
  // 2026-08-31 周更体检：`EXPERIENCE_MARKERS` 从创刊起是照简中语料写的，
  // 而繁中源（iT 邦八个铁人赛系列 + vocus + 台港博客）现在占入围名单四分之一。
  // 1396 条语料上逐对量：記錄 55、小時 47、教訓 28、實測 27、體驗 18、從零 18……
  const trad = scoreItem({
    title: 'Day 14｜Skill 的評測：竟在 Benchmark 實測中拿了最後一名',
    excerpt: '這次我把三份 Skill 丟進同一組題目跑，記錄每一輪的輸出。實測下來最後一名的那份，'
      + '問題不在提示詞而在入口枚舉；從零重寫之後的對比放在文末，總結成三條教訓。',
  });
  assert.ok(trad.reasons.some((x) => x.includes('标题经验词')), trad.reasons.join('；'));
  assert.ok(trad.reasons.some((x) => x.includes('正文经验词')), trad.reasons.join('；'));

  // 「我讓」是简体「我让」的另一种字形，同一个句式值同样的 4 分。
  const let_ = scoreItem({ title: '我讓 Claude Code 自己跑了五個月', excerpt: '記錄一下這五個月。' });
  assert.ok(let_.reasons.some((x) => x.includes('我+动作')), let_.reasons.join('；'));
});

test('繁体反向词：「繁中轉譯」不是中转，「免費額度」不是黑产', () => {
  // 补繁体反向词那一轮被数据挡回来的两个。前者是「心流 → 核心流程」在新字形上的复发：
  // `中轉` 在这份语料里的 2 条唯一命中**全部**是「繁中轉譯」；
  // 后者误伤了两篇 5 分——免费额度用完正是那两篇的题眼。
  const relay = scoreItem({
    title: 'Day 4 - 五個 Maps 來源不等於五間店：繁中轉譯來源卡片與 placeId 去重',
    excerpt: '我把 Google Maps Grounding 的繁中轉譯接進來之後，發現五個來源其實指向同一間店。',
  });
  assert.ok(!relay.reasons.some((x) => x.includes('营销词')), relay.reasons.join('；'));

  const quota = scoreItem({
    title: 'Day 22：睡一覺醒來，我的 AI 刷了 $40 美金',
    excerpt: '免費額度昨晚就用完了，而我沒有設上限。這一覺醒來帳單是 40 美金，我把當時的排程逐條翻了一遍。',
  });
  assert.ok(!quota.reasons.some((x) => x.includes('营销词')), quota.reasons.join('；'));

  // 但真的繁体黑产 / 营销词照扣。
  const promo = scoreItem({
    title: '我用 Claude Code 搭了一套工作流',
    excerpt: '限時優惠期間我開了車隊，共享帳號批發價，訓練營報名請私訊。',
  });
  assert.ok(promo.reasons.some((x) => x.includes('营销词')), promo.reasons.join('；'));
});
