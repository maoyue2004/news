/**
 * 折腾志的词表。这是整个系统里最该被反复修改的文件——
 * 它同时驱动两件事：平台搜索时发什么查询词，以及抓回来的条目怎么打分。
 *
 * 维护原则：工具名是「这篇讲的是不是 agent」的判据，经验词是「这篇是不是个人折腾」的判据，
 * 反向词是「这篇是不是新闻/广告/软文」的判据。三者职责不要混。
 */

/**
 * Code Agent / Work Agent 工具名。
 * `aka` 里放中文名、简称、常见拼写变体；匹配时全部等价。
 * 注意别放太泛的词（比如单独的 "Agent"、"Copilot"），会把大量无关内容拉进来。
 */
export const TOOLS = [
  // —— CLI 编码 agent ——
  { id: 'claude-code', name: 'Claude Code', aka: ['claudecode', 'cc 命令行'] },
  { id: 'codex', name: 'Codex CLI', aka: ['codex cli', 'openai codex', 'codex 命令行'] },
  { id: 'gemini-cli', name: 'Gemini CLI', aka: ['gemini-cli'] },
  { id: 'copilot-cli', name: 'Copilot CLI', aka: ['copilot cli', 'gh copilot'] },
  { id: 'aider', name: 'Aider', aka: [] },
  { id: 'opencode', name: 'OpenCode', aka: ['open code cli'] },
  { id: 'crush', name: 'Crush', aka: ['charm crush'] },
  { id: 'goose', name: 'Goose', aka: ['block goose'] },
  { id: 'amp', name: 'Amp', aka: ['sourcegraph amp', 'amp code'] },
  { id: 'droid', name: 'Factory Droid', aka: ['factory droid', 'droid cli'] },
  { id: 'iflow', name: 'iFlow CLI', aka: ['iflow cli', '心流'] },
  { id: 'qwen-code', name: 'Qwen Code', aka: ['qwen code', 'qwen-code'] },
  { id: 'openhands', name: 'OpenHands', aka: ['open hands', 'opendevin'] },
  { id: 'swe-agent', name: 'SWE-agent', aka: ['swe agent'] },

  // —— IDE / 编辑器内的 agent ——
  { id: 'cursor', name: 'Cursor', aka: ['cursor ide', 'cursor 编辑器'] },
  { id: 'windsurf', name: 'Windsurf', aka: ['codeium windsurf'] },
  { id: 'cline', name: 'Cline', aka: ['claude dev'] },
  { id: 'roo', name: 'Roo Code', aka: ['roo code', 'roocode'] },
  { id: 'kilo', name: 'Kilo Code', aka: ['kilo code', 'kilocode'] },
  { id: 'continue', name: 'Continue.dev', aka: ['continue.dev'] },
  { id: 'augment', name: 'Augment Code', aka: ['augment code'] },
  { id: 'zed', name: 'Zed', aka: ['zed editor', 'zed 编辑器'] },
  { id: 'trae', name: 'Trae', aka: ['trae ide'] },
  { id: 'kiro', name: 'Kiro', aka: ['aws kiro'] },
  { id: 'qoder', name: 'Qoder', aka: [] },
  { id: 'codebuddy', name: 'CodeBuddy', aka: ['腾讯 codebuddy'] },
  { id: 'lingma', name: '通义灵码', aka: ['lingma', '灵码'] },
  { id: 'comate', name: '文心快码', aka: ['comate'] },
  { id: 'marscode', name: 'MarsCode', aka: ['豆包 marscode'] },
  { id: 'copilot', name: 'GitHub Copilot', aka: ['github copilot', 'copilot agent', 'copilot workspace'] },
  { id: 'antigravity', name: 'Antigravity', aka: ['google antigravity'] },
  { id: 'jules', name: 'Jules', aka: ['google jules'] },
  { id: 'devin', name: 'Devin', aka: ['cognition devin'] },

  // —— 终端 / 桌面通用 agent ——
  { id: 'warp', name: 'Warp', aka: ['warp 终端', 'warp terminal'] },
  { id: 'claude-desktop', name: 'Claude Desktop', aka: ['claude 桌面', 'claude 客户端'] },
  { id: 'chatgpt-desktop', name: 'ChatGPT Desktop', aka: ['chatgpt 桌面', 'chatgpt agent', 'operator'] },
  { id: 'manus', name: 'Manus', aka: [] },
  { id: 'flowith', name: 'Flowith', aka: [] },
  { id: 'skywork', name: 'Skywork', aka: ['天工 skywork'] },
  { id: 'genspark', name: 'Genspark', aka: [] },
  { id: 'comet', name: 'Comet', aka: ['perplexity comet'] },
  { id: 'dia', name: 'Dia', aka: ['dia 浏览器'] },
  { id: 'n8n', name: 'n8n', aka: [] },
  { id: 'dify', name: 'Dify', aka: [] },
  { id: 'coze', name: 'Coze', aka: ['扣子'] },

  // —— 生态概念：不是工具，但出现即强烈指向 agent 实践 ——
  { id: 'mcp', name: 'MCP', aka: ['model context protocol', 'mcp server', 'mcp 服务'] },
  { id: 'subagent', name: 'Subagent', aka: ['sub agent', '子智能体', '子 agent'] },
  { id: 'skills', name: 'Agent Skills', aka: ['agent skills', 'claude skills', '技能包'] },
  { id: 'agents-md', name: 'AGENTS.md', aka: ['agents.md'] },
  { id: 'claude-md', name: 'CLAUDE.md', aka: ['claude.md'] },
  { id: 'agent-sdk', name: 'Agent SDK', aka: ['agent sdk', 'claude agent sdk'] },
  { id: 'vibe-coding', name: 'Vibe Coding', aka: ['vibe coding', '氛围编程', '氛围编码'] },
  { id: 'spec-driven', name: '规格驱动开发', aka: ['spec driven', 'spec-driven', 'sdd 开发'] },
];

/** 更泛的 agent 词。单独出现不足以判定，但能给分。 */
export const SOFT_TERMS = [
  'ai 编程', 'ai编程', '智能体', '编程助手', '代码助手', '智能编码', 'coding agent',
  'agentic', 'ai agent', '编程 agent', '自动编程', '人机协作编程',
];

/**
 * 个人折腾的语言指纹。有这些词，说明作者在讲「我做了什么、结果如何」，
 * 而不是在转述「某公司发布了什么」。
 */
export const EXPERIENCE_MARKERS = [
  '折腾', '踩坑', '避坑', '实测', '试用', '体验', '心得', '记录', '手记', '日志',
  '实践', '复盘', '总结', '教训', '翻车', '真香', '上手', '入门到', '从零',
  '我的', '我用', '我把', '我们把', '自己', '亲测', '玩了', '搞定', '折磨',
  '工作流', '配置', '定制', '魔改', '自建', '搭建', '迁移', '替换', '对比',
  '一周', '一个月', '三天', '半年', '天后', '小时', '花了',
  '为什么我', '怎么用', '如何用', '这样用', '用法', '姿势', '骚操作',
  '踩了', '坑', '心路', '感受', '吐槽', '安利', '劝退',
];

/**
 * 反向词。命中会扣分，命中多个基本可以直接毙掉。
 * 分三类，扣分权重不同：新闻腔、营销/黑产、学术。
 *
 * 「拼车 / 中转 / 白嫖」这一组是从 V2EX 和 linux.do 的实际噪声里总结的——
 * 这类帖子密度极高、关键词完全命中「Claude Code」，但内容是卖 API 额度，
 * 不加这层过滤，搜索源基本不可用。
 */
export const ANTI_MARKERS = {
  news: ['融资', '估值', '官宣', '发布会', '财报', '季度', '市值', '收购', '裁员',
    '榜单', '排行榜', '市场份额', '行业报告', '白皮书', '峰会', '大会召开', '受访',
    '据悉', '日前宣布', '正式发布', '重磅', '刷屏', '爆火'],
  promo: ['拼车', '中转', '白嫖', '免费额度', '车队', '代充', '低价', '优惠', '折扣',
    '促销', '限时', '解锁', '破解', '共享账号', '开车', '上车', '合租', '批发',
    '招聘', '内推', '广告', '赞助', '带货', '课程', '训练营', '报名'],
  academic: ['arxiv', '论文', '综述', 'benchmark 结果', '数据集', '实验表明',
    '本文提出', '我们提出', 'sota', '消融实验'],
};

/**
 * 平台搜索用的查询词库。每次运行不跑全部——那会把接口打爆，
 * 而且大部分查询返回的是同一批内容。按天轮转取一个切片，
 * 让长尾查询在一周内都能被覆盖到。
 */
export const SEARCH_QUERIES = [
  'Claude Code 实践', 'Claude Code 折腾', 'Claude Code 工作流', 'Claude Code 踩坑',
  'Claude Code 心得', 'Claude Code 配置', 'CLAUDE.md', 'Claude Code subagent',
  'Claude Code skills', 'Claude Code hooks',
  'Codex CLI 使用', 'Codex CLI 体验', 'AGENTS.md',
  'Cursor 使用心得', 'Cursor 工作流', 'Cursor 规则', 'Cursor 实践',
  'Gemini CLI 体验', 'Copilot CLI 使用', 'Windsurf 体验', 'Cline 使用',
  'Aider 使用', 'OpenCode 体验', 'Zed 编辑器 AI', 'Trae 体验', 'Kiro 体验',
  'Qoder 体验', 'CodeBuddy 使用', '通义灵码 体验', 'Antigravity 体验',
  'MCP 服务器 自己写', 'MCP 实践', 'MCP 折腾',
  'AI 编程 工作流', 'AI 编程 踩坑', 'vibe coding 实践', '氛围编程 体验',
  'agent 编程 心得', '智能体 折腾', 'AI 写代码 一个月',
  'Manus 体验', 'Warp 终端 体验', 'Claude Desktop 用法',
  'Devin 体验', 'Amp code 体验', 'Droid CLI 体验',
  '多个 agent 协作 开发', 'agent 并行 开发', 'git worktree agent',
  'AI 编程 成本', 'Claude Code 额度', 'token 消耗 编程',
];

const LATIN = /[a-z0-9]/;

/**
 * 纯 ASCII 的工具名必须按词边界匹配，不能用 includes。
 *
 * 这是实测踩出来的：`dia` 命中了 "ASCII diagram"，`amp` 命中了 "example"，
 * 于是一篇讲字体对齐的文章和一篇 Spring Boot 排错笔记都被判成了 agent 实践。
 * 中文没有空格，所以不能用 \b——这里只要求紧邻字符不是拉丁字母或数字，
 * 「用Zed写代码」这种中英混排仍然能命中。
 *
 * `&` 要单独排除：HTML 实体 `&amp;` 在 feed 正文里遍地都是，
 * 而它的 amp 前后都不是拉丁字母，纯词边界规则拦不住。
 * 这个误报一度让上百个从没写过 agent 的博客被判定成「写过 Amp」。
 */
function makeMatcher(needle) {
  if (!/^[\x20-\x7e]+$/.test(needle)) return (text) => text.includes(needle);
  return (text) => {
    let from = 0;
    for (;;) {
      const i = text.indexOf(needle, from);
      if (i < 0) return false;
      const before = i > 0 ? text[i - 1] : '';
      const after = text[i + needle.length] ?? '';
      if (!LATIN.test(before) && before !== '&' && !LATIN.test(after)) return true;
      from = i + 1;
    }
  };
}

const TOOL_INDEX = TOOLS.map((t) => ({
  ...t,
  matchers: [t.name.toLowerCase(), ...t.aka.map((a) => a.toLowerCase())].map(makeMatcher),
}));

/** 返回文本里命中的工具 id 列表（去重）。 */
export function matchTools(text) {
  const lower = String(text ?? '').toLowerCase();
  const hits = [];
  for (const tool of TOOL_INDEX) {
    if (tool.matchers.some((m) => m(lower))) hits.push(tool.id);
  }
  return hits;
}

export function toolName(id) {
  return TOOLS.find((t) => t.id === id)?.name ?? id;
}

/** 按日期取当天要跑的查询切片，保证一周内轮遍全库。 */
export function queriesForDate(date, perDay = 12) {
  const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  const start = (days * perDay) % SEARCH_QUERIES.length;
  const out = [];
  for (let i = 0; i < perDay; i += 1) out.push(SEARCH_QUERIES[(start + i) % SEARCH_QUERIES.length]);
  return [...new Set(out)];
}
