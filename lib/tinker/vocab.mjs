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
  // 裸 `codex` 是 2026-08-03 体检里发现的最大一处漏网：整个语料 21 次提到 Codex，
  // 只有 2 次被认出来，因为条目名写的是「Codex CLI」而别名里没有裸词。
  // 漏掉的包括「Cursor、Claude、Codex 深度体验与对比」这种标题级命中。
  // 它满足「单独出现时是否只可能指这个产品」：和 Claude / Gemini / Qwen / Kimi 不同——
  // 那几个裸词是模型名（所以**不**给它们的 CLI 条目加裸别名，实测各有 3-46 次
  // 「裸词出现但不该算这个工具」），而 Codex 在中文开发语料里没有对应的模型或聊天产品。
  { id: 'codex', name: 'Codex CLI', aka: ['codex', 'codex cli', 'openai codex', 'codex 命令行'] },
  { id: 'gemini-cli', name: 'Gemini CLI', aka: ['gemini-cli'] },
  { id: 'copilot-cli', name: 'Copilot CLI', aka: ['copilot cli', 'gh copilot'] },
  { id: 'aider', name: 'Aider', aka: [] },
  { id: 'opencode', name: 'OpenCode', aka: ['open code cli'] },
  { id: 'crush', name: 'Crush', aka: ['charm crush'] },
  { id: 'goose', name: 'Goose', aka: ['block goose'] },
  { id: 'amp', name: 'Amp', aka: ['sourcegraph amp', 'amp code'] },
  { id: 'droid', name: 'Factory Droid', aka: ['factory droid', 'droid cli'] },
  { id: 'iflow', name: 'iFlow CLI', aka: ['iflow cli', 'iflow'] },
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
  // xAI 的 coding harness，2026-07 开源。中文圈开始出现横评了
  // （2026-08-04 linux.do 那条六个 harness 同模型对比就把它排在第一）。
  // **不收单独的 `grok`**：那是模型名，满地都是。
  { id: 'grok-build', name: 'Grok Build', aka: ['grok build', 'grokbuild'] },
  // Meta 的终端编码 agent，2026-08-05 发布，跑 Muse Spark 1.2；
  // 卖点是子 agent 各自开 worktree 并行 + 后台 reviewer。中文实践文还没出现，
  // 加进来是为了让派生查询词提前就位——Claude Code / Codex / Grok Build
  // 这几个都是「中文圈开始写的时候词表已经在了」才没漏抓。
  // **不收单独的 `muse`**：MuseScore、Muse 乐队、以及英文里的 muse 本身，
  // 和 `operator` 同类，任何边界规则都拦不住。`muse spark` 是模型名，不是工具，也不收。
  { id: 'muse-code', name: 'Muse Code', aka: ['muse code', 'musecode', 'muse-code'] },
  { id: 'jules', name: 'Jules', aka: ['google jules'] },
  { id: 'devin', name: 'Devin', aka: ['cognition devin'] },

  // —— 终端 / 桌面通用 agent ——
  { id: 'warp', name: 'Warp', aka: ['warp 终端', 'warp terminal'] },
  { id: 'claude-desktop', name: 'Claude Desktop', aka: ['claude 桌面', 'claude 客户端'] },
  // 'operator' 曾是这里的别名，已删。它是英文里最常见的技术词之一：
  // Kubernetes Operator Pattern、C++ operator 重载、表格配置里的 operator: 'eq'……
  // 2026-08-02 那天 9 条入围里有 2 条纯粹是被它捞进来的（一篇讲 client-go，
  // 一篇是 Vue 表格列定义）。词边界规则拦不住它，因为它本来就是个独立单词。
  // 教训和 &amp;→Amp、心流→核心流程 同类：别名的唯一标准是「它单独出现时是否只可能指这个产品」。
  { id: 'chatgpt-desktop', name: 'ChatGPT Desktop', aka: ['chatgpt 桌面', 'chatgpt agent'] },
  // 2026-08-09 加入。跨平台桌面工具，统一管理 Claude Code / Codex / OpenCode /
  // OpenClaw / Gemini CLI / Hermes 这几家 CLI 的供应商配置与 MCP，原子写各自的配置文件。
  // 今天那篇 Windows 装 codex 接 DeepSeek 的文章里它是主角之一，语料里已经反复出现。
  // 别名不收裸 `cc`（和 Claude Code 的缩写、C 编译器、抄送全撞），也不收裸 `switch`。
  { id: 'cc-switch', name: 'CC Switch', aka: ['cc-switch', 'ccswitch', 'cc switch'] },
  { id: 'manus', name: 'Manus', aka: [] },
  { id: 'flowith', name: 'Flowith', aka: [] },
  { id: 'skywork', name: 'Skywork', aka: ['天工 skywork'] },
  { id: 'genspark', name: 'Genspark', aka: [] },
  { id: 'comet', name: 'Comet', aka: ['perplexity comet'] },
  { id: 'dia', name: 'Dia', aka: ['dia 浏览器'] },
  { id: 'n8n', name: 'n8n', aka: [] },
  { id: 'dify', name: 'Dify', aka: [] },
  { id: 'coze', name: 'Coze', aka: [] },
  { id: 'openclaw', name: 'OpenClaw', aka: ['open claw'] },
  { id: 'hermes', name: 'Hermes', aka: [] },
  { id: 'nanoclaw', name: 'NanoClaw', aka: ['nano claw'] },
  { id: 'kimi-code', name: 'Kimi Code', aka: ['kimi cli'] },
  { id: 'cowork', name: 'Claude Cowork', aka: ['claude cowork'] },
  // 腾讯 CodeBuddy 团队的桌面办公 agent（workbuddy.cn，文档挂在 codebuddy.cn/docs/workbuddy 下），
  // 从微信 / 企微 / 钉钉 / 飞书发一句话遥控办公电脑做 PPT、整理文件、写报告。
  //
  // 2026-08-01 创刊时把 `workbuddy` 当成 Claude Cowork 的别名写进了 aka，**是错的**：
  // 它不是 Cowork 的中文叫法，是另一家的另一个产品。2026-08-10 这天掘金一波
  // WorkBuddy 稿子（「从 CodeBuddy 到 WorkBuddy：腾讯的逆袭」「WorkBuddy 与 TraeWork：
  // 微信遥控电脑的 AI 办公新范式」「WorkBuddy 是什么？」）全部被判成「标题命中：cowork」，
  // 页面上会把它们挂到 Claude Cowork 的筛选器里。
  // LESSONS 里「别名的唯一标准」讲的一直是**误命中**（一个词顺带撞上别的东西），
  // 这次是**认错人**——别名本身指向了另一个产品，而它每一次命中都是错的，一次都不对。
  { id: 'workbuddy', name: 'WorkBuddy', aka: ['腾讯 workbuddy'] },
  { id: 'claudian', name: 'Claudian', aka: [] },
  // 严格说是笔记软件而不是 agent，但中文圈把 vault 当上下文库、
  // 配 Claudian / MCP 插件当「AI 时代的 IDE」的写法已经成了一类固定折腾，
  // 语料里连续两天出现（犀利豆那篇 5 分文，以及 Fork Zed 那篇的对照物）。
  { id: 'obsidian', name: 'Obsidian', aka: [] },
  // obra/superpowers：把一整套软件工程流程焊进 agent 的 skills 包，
  // 装法是 `/plugin install superpowers@claude-plugins-official`——能安装，所以是产品不是话题。
  // 21 天语料里 4 篇不同文章提到（RYANUO 的中英双版对比、V2EX 的 skill 实践、
  // 两篇 SegmentFault 配置文里的 plugin 清单）。
  // **只收复数 `superpowers`**：单数 superpower 是普通英文词（「AI 是一种 superpower」）。
  { id: 'superpowers', name: 'Superpowers', aka: ['obra/superpowers'] },
  // Agent-Reach：给 agent 装全网检索（Twitter / Reddit / B 站 / 小红书 / YouTube），
  // 一条 CLI、不要各平台 API Key。2026-08-05 收录的 Ruby China 实测文写的就是它，
  // 而规则层给那条判的 tools 是空的——「装什么给 agent 用」这一类工具词表里一直缺。
  // 带连字符的复合词，不会撞上别的东西；不收裸 `reach`。
  { id: 'agent-reach', name: 'Agent-Reach', aka: ['agent reach', 'agentreach'] },
  // DeepAgents：LangChain 官方那层 agent harness（规划、文件系统、子 agent、
  // 上下文压缩、human-in-the-loop 都预置好）。2026-08-05 博客园那条鸿蒙自动化测试
  // 讲的就是它，条目本身没收（是课程配套的开箱文），但工具名该进表。
  // 单词拼死，不收带空格的 `deep agents`——那是「深度智能体」这种泛称的常见写法。
  { id: 'deepagents', name: 'DeepAgents', aka: [] },
  // OpenSpec（Fission-AI/OpenSpec）：规格驱动开发的 CLI，`openspec` 一条命令
  // 把「先写变更提案、评审通过再让 agent 动手」这套流程焊进 Claude Code / Cursor 等宿主，
  // 并按 Skills RFC 出了一份跨编辑器的 Agent Skills 适配。能安装，所以是产品不是话题
  // （对应的方法论 `spec-driven` 已经在 TOPICS 里）。
  // 2026-08-10 语料里出现两次：掘金「Qoder 下的 Harness+OpenSpec+Superpowers
  // 项目目录结构解读」，以及腾讯云社区那篇「把 OpenSpec+Superpowers 做成 Agent Skill」。
  // 拼死单词，不收拆开的 `open spec`——那是「开放规范」的常见写法。
  { id: 'openspec', name: 'OpenSpec', aka: ['fission-ai/openspec'] },
];

/**
 * 话题：概念、协议、实践方法、约定文件。
 *
 * 和 TOOLS 分开是因为它们回答的是**不同的问题**。
 * 「我想看 Claude Code 的东西」和「我想看 MCP 的东西」是两种检索意图，
 * 混在一个叫「按工具」的筛选器里既不准确，也让两种意图互相干扰。
 * 打分时两者等价（标题里出现 MCP 和出现 Cursor 一样能说明这篇在讲 agent），
 * 但在页面上必须分开呈现。
 */
export const TOPICS = [
  { id: 'mcp', name: 'MCP', aka: ['model context protocol', 'mcp server', 'mcp 服务'] },
  { id: 'subagent', name: '子智能体', aka: ['subagent', 'sub agent', '子智能体', '子 agent'] },
  // 2026-08-07：今天收的「产品经理的 Claude Code 技能包实战」通篇讲 skill，
  // 规则层给它标出来的 topics 是**空的**——因为中文语料里这个概念叫「技能包」，
  // 而 aka 里只有英文写法。
  // **不收裸的「技能包」**：它是「技能包括 / 技能包含」的一段（招聘帖里
  // 「要求技能包括…」很常见），正是 `心流` → 核心流程 那类误伤。
  // 也不收裸的 `skill`：soft skill / skill tree 都是常用词，和 `operator` 同类。
  // 只认带限定词或带扩展名的写法，和 `harness` / `acp` 的处理一致。
  { id: 'skills', name: 'Agent Skills', aka: ['agent skills', 'claude skills', 'skill.md', '.claude/skills', 'skills 目录', 'code 技能包'] },
  { id: 'agents-md', name: 'AGENTS.md', aka: ['agents.md'] },
  { id: 'claude-md', name: 'CLAUDE.md', aka: ['claude.md'] },
  { id: 'agent-sdk', name: 'Agent SDK', aka: ['agent sdk', 'claude agent sdk'] },
  { id: 'vibe-coding', name: 'Vibe Coding', aka: ['vibe coding', '氛围编程', '氛围编码'] },
  { id: 'spec-driven', name: '规格驱动开发', aka: ['spec driven', 'spec-driven', '规格驱动'] },
  { id: 'loop-engineering', name: 'Loop Engineering', aka: ['loop engineering', '循环工程'] },
  // 「上下文压缩」实测 3 篇里 3 篇没被标上，而它讲的就是上下文怎么管——
  // 四个字，不可能是别的常用词的一段，可以放心加。
  { id: 'context-engineering', name: 'Context Engineering', aka: ['context engineering', '上下文工程', '上下文压缩', 'context compaction'] },
  { id: 'agent-memory', name: 'Agent 记忆', aka: ['agent 记忆', '智能体记忆', '记忆层'] },
  { id: 'hooks', name: 'Hooks', aka: ['claude code hooks', 'stop hook', 'pretooluse'] },
  // 「把 agent 围起来干活的那层脚手架」正在从行话变成固定说法（Claude Code 源码
  // 泄露之后尤其密集）。**不收单独的 `harness`**：test harness / wire harness
  // 都是常用词，单独出现指向不唯一，只认带限定词的写法。
  { id: 'harness', name: 'Agent Harness', aka: ['agent harness', 'harness engineering', 'harness 工程', 'agentic harness'] },
  // 编辑器 ↔ agent 之间的连接协议（Zed 发起，OpenCode / JetBrains / Neovim 都在接）。
  // **绝对不收单独的 `acp`**：中文技术语料里 ACP 压倒性地指阿里云 ACP 认证，
  // 「ACP 备考」「考了 ACP」满地都是，和 `心流` → 核心流程 是同一类误伤。
  // 只认带限定词的写法。
  { id: 'acp', name: 'Agent Client Protocol', aka: ['agent client protocol', 'acp 协议', 'opencode acp'] },
  // Google Cloud 2026-06 提的知识格式（一组 Markdown + YAML 元数据），
  // 想给「组织的知识怎么被 agent 读写」立个标准。缩写足够冷门，可以单收。
  { id: 'okf', name: 'Open Knowledge Format', aka: ['open knowledge format', 'okf'] },
  // 多 agent 并行时用 git worktree 互相隔离，已经从技巧变成默认做法：
  // 2026-08-04 同一天里 V2EX 的 concurrent-worktrees skill、Claude Code
  // v2.1.210 的 isolation:worktree 修复、搜索结果里成片的「多 Agent + Worktree」
  // 都在讲这件事。**不收单独的 `worktree`**：那是普通 git 功能，
  // 讲分支管理的文章会大面积误伤，只认带 agent / 并行限定词的写法。
  { id: 'worktree', name: 'Worktree 隔离', aka: ['concurrent worktree', 'agent worktree', 'worktree 隔离', 'worktree 并行', '并行 worktree', '多 agent worktree'] },
  // 「先出方案、批准了再动手」这套已经从 Claude Code 的一个模式变成通用做法
  // （OpenCode 的 Plan agent、Cursor 的 plan、Codex 的 /plan 都是同一件事）。
  // 2026-08-06 犀利豆那两篇 EnterPlanMode / ExitPlanMode 拆解在规则层
  // 一个 topic 都没标上，标出来的反而是误判的 `subagent`。
  // **绝对不收单独的 `plan`**：计划、方案、plan B 满地都是。
  // 「规划模式」四个字连着出现基本只可能是这个意思，可以收。
  { id: 'plan-mode', name: '规划模式', aka: ['plan mode', 'planmode', '规划模式', 'enterplanmode', 'exitplanmode'] },
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
 * 平台搜索的核心词：**每天都跑**。
 *
 * 词库整体是轮转的，但轮转有个毛病——它把「常年高产」和「碰运气」的词一视同仁。
 * 「Claude Code 实践」这种词每天都有新内容，隔三天才轮到一次就是白白漏掉。
 * 所以拆成两层：这几条钉死每天跑，其余轮转。
 */
export const CORE_QUERIES = [
  'Claude Code 实践', 'Claude Code 踩坑', 'Codex CLI 体验',
  'Cursor 工作流', 'AI 编程 踩坑', 'agent 编程 心得',
];

/**
 * 轮转词库。按天取切片，让长尾查询在几天内都能被覆盖到。
 *
 * 维护要点：发现某个词长期零产出就换掉，别留着占轮转名额。
 * 新工具、新概念一出现就该进来——这里是系统主动去找东西的地方，
 * feed 只能等别人写，查询词能去捞。
 */
export const SEARCH_QUERIES = [
  // —— Claude Code 生态 ——
  'Claude Code 折腾', 'Claude Code 工作流', 'Claude Code 心得', 'Claude Code 配置',
  'CLAUDE.md', 'Claude Code subagent', 'Claude Code skills', 'Claude Code hooks',
  'Claude Code 插件', 'Claude Code 多开', 'Claude Code 额度',
  'Agent Harness 实践',
  // —— Codex / OpenAI ——
  'Codex CLI 使用', 'AGENTS.md', 'Codex 工作流', 'Codex 记忆',
  // —— 其他 CLI / IDE agent ——
  'Cursor 使用心得', 'Cursor 规则', 'Cursor 实践',
  'Gemini CLI 体验', 'Copilot CLI 使用', 'Windsurf 体验', 'Cline 使用',
  'Aider 使用', 'OpenCode 体验', 'Zed 编辑器 AI', 'Trae 体验', 'Kiro 体验',
  'Qoder 体验', 'CodeBuddy 使用', '通义灵码 体验', 'Antigravity 体验',
  'Amp code 体验', 'Droid CLI 体验', 'Kimi Code 体验', 'Qwen Code 使用',
  'OpenClaw 折腾', 'Hermes agent 使用',
  // —— 概念与方法 ——
  'MCP 服务器 自己写', 'MCP 实践', 'MCP 折腾',
  'vibe coding 实践', '氛围编程 体验', '规格驱动开发 实践',
  'Loop Engineering', 'Context Engineering 实践', '上下文工程 实践',
  'agent 记忆 方案', 'subagent 并行', 'git worktree agent',
  '多个 agent 协作 开发', 'agent 并行 开发', 'AI 写代码 一个月',
  '智能体 折腾', 'AI 编程 工作流',
  // —— 成本与限制 ——
  'AI 编程 成本', 'token 消耗 编程', 'AI 编程 额度 用完',
  // —— 翻车与边界（这类文章质量通常最高）——
  'AI 写代码 翻车', 'agent 失控', 'AI 编程 幻觉 踩坑', 'AI 重构 回滚',
  'AI 编程 不适合', 'agent 用了三个月',
  // —— Work Agent（非编程）——
  'Manus 体验', 'Warp 终端 体验', 'Claude Desktop 用法',
  'AI 自动化 办公 实践', 'agent 处理 文档 实践', 'AI 做 周报 自动化',
  'AI 整理 资料 工作流', 'Devin 体验',
];

/**
 * 从词表自动派生查询词。
 *
 * 手写查询词有个根本缺陷：**它和词表会脱节**。
 * 每加一个工具就得记得同步加查询，漏一个这工具就永远搜不到。
 * 2026-08-02 实测的数据说明查询词是供给的主要来源
 * （当天 6 条入围里 6 条来自搜索源、0 条来自当轮新增的 51 个博客），
 * 所以这一层必须自动跟上词表，不能靠人记。
 *
 * 模板刻意都带实践意味（实践 / 踩坑 / 体验），不搜光秃秃的工具名——
 * 后者搜出来全是官网、文档和新闻。
 */
const TOOL_TEMPLATES = ['%s 实践', '%s 踩坑', '%s 体验'];
const TOPIC_TEMPLATES = ['%s 实践', '%s 怎么用'];

/** 太泛的名字不适合做查询词，搜出来全是噪声。 */
const UNQUERYABLE = new Set(['copilot', 'zed', 'dia', 'comet', 'crush', 'goose', 'jules', 'amp', 'manus', 'hermes']);

function derivedQueries() {
  const out = [];
  for (const t of TOOLS) {
    if (UNQUERYABLE.has(t.id)) continue;
    for (const tpl of TOOL_TEMPLATES) out.push(tpl.replace('%s', t.name));
  }
  for (const t of TOPICS) {
    for (const tpl of TOPIC_TEMPLATES) out.push(tpl.replace('%s', t.name));
  }
  return out;
}

/** 完整轮转池 = 手写的长尾词 + 词表派生词，去重。 */
export function rotatingQueries() {
  return [...new Set([...SEARCH_QUERIES, ...derivedQueries()])];
}

/**
 * 当天要跑的查询：核心词（每天必跑）+ 按天轮转的切片。
 * @param {number} perDay 总条数（含核心词）
 */
export function queriesForDate(date, perDay = 24) {
  const pool = rotatingQueries();
  const rotating = Math.max(0, perDay - CORE_QUERIES.length);
  const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  const start = ((days * rotating) % pool.length + pool.length) % pool.length;
  const slice = [];
  for (let i = 0; i < rotating; i += 1) slice.push(pool[(start + i) % pool.length]);
  return [...new Set([...CORE_QUERIES, ...slice])];
}

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
 *
 * **中文别名没有任何边界保护**，因为中文本来就不分词。所以短中文别名极其危险：
 * 「心流」（iFlow）命中了「核**心流**程」，「扣子」（Coze）会命中「纽扣子」。
 * 加中文别名前先自问：它会不会是某个常用词的一段？两个字的基本都会，别加。
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

function buildIndex(entries) {
  return entries.map((e) => ({
    ...e,
    matchers: [e.name.toLowerCase(), ...e.aka.map((a) => a.toLowerCase())].map(makeMatcher),
  }));
}

const TOOL_INDEX = buildIndex(TOOLS);
const TOPIC_INDEX = buildIndex(TOPICS);

function matchIn(index, text) {
  const lower = String(text ?? '').toLowerCase();
  const hits = [];
  for (const entry of index) {
    if (entry.matchers.some((m) => m(lower))) hits.push(entry.id);
  }
  return hits;
}

/** 命中的工具（产品）id。 */
export function matchTools(text) {
  return matchIn(TOOL_INDEX, text);
}

/** 命中的话题（概念、协议、实践方法）id。 */
export function matchTopics(text) {
  return matchIn(TOPIC_INDEX, text);
}

/**
 * 打分只关心「这段文字有没有在谈 agent」，工具和话题在这一点上等价，
 * 所以给出一个合并视图；页面上要分开展示时各取各的。
 */
export function matchVocab(text) {
  return { tools: matchTools(text), topics: matchTopics(text) };
}

export function vocabNames() {
  return {
    tools: Object.fromEntries(TOOLS.map((t) => [t.id, t.name])),
    topics: Object.fromEntries(TOPICS.map((t) => [t.id, t.name])),
  };
}

export function toolName(id) {
  return [...TOOLS, ...TOPICS].find((t) => t.id === id)?.name ?? id;
}

