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
  // DeepSeek-Reasonix（esengine/DeepSeek-Reasonix）：DeepSeek 原生的终端编码 agent，
  // 和 dsh 是同一波里的两个东西（dsh 是 harness/插件运行时，Reasonix 是终端 agent），
  // 中文语料里经常并排出现（「DeepSeek Harness、Reasonix 和 Codex 的结果对比」）。
  // 2026-08-17 全量 1350 条里命中 9 条、4 条在标题，跨 V2EX / 掘金 / Python猫周刊 /
  // GitHub Trending 周报四个源，**没有一条是别的意思**——这个词在中文里不是任何常用词。
  { id: 'reasonix', name: 'Reasonix', aka: ['deepseek-reasonix', 'deepseek reasonix', 'reasonix cli'] },
  { id: 'gemini-cli', name: 'Gemini CLI', aka: ['gemini-cli'] },
  { id: 'copilot-cli', name: 'Copilot CLI', aka: ['copilot cli', 'gh copilot'] },
  { id: 'aider', name: 'Aider', aka: [] },
  { id: 'opencode', name: 'OpenCode', aka: ['open code cli'] },
  // DeepSeek Harness（dsh），2026-08-13 开发者预览开源，跑在 Cordis 之上、
  // 「一切皆插件」。当天 492 条语料里 `\bdsh\b` 命中 18 条、`deepseek harness` 也是 18 条，
  // 两组完全重合，**零误伤**——三字母缩写按 LESSONS 的规矩逐条查过才敢收。
  { id: 'dsh', name: 'DeepSeek Harness', aka: ['deepseek harness', 'deepseek-harness', 'deepseekharness', 'dsh'] },
  // Docker Sandboxes（CLI 叫 `sbx`，`brew install docker/tap/sbx`）：给 Coding Agent
  // 一台随手能删的微虚拟机，自己的内核、文件系统、网络和 Docker Engine。
  // 能装能跑，按判据是工具不是话题。
  //
  // 2026-08-29 加的，加之前量过：649 条语料（当天 474 条原始 + 创刊以来 175 条收录）里
  // `docker\s+sandboxes` 命中 6 条、**6 条全是它、0 误伤**，且 6 条全在标题上；
  // 裸 `sbx` 命中 3 条，也全是它（`sbx run` / `sbx policy` / `sbx skills import`）。
  // 三字母缩写按 LESSONS 的规矩逐条看过才敢收——名字很短，但它前面没有
  // 「被别的东西整个包住」的嫌疑，出现第一次误伤就撤掉裸 `sbx`，只留带空格的全名。
  //
  // 单数 `docker sandbox` 语料里 0 条，仍然收：它要求 `docker` 紧挨着，
  // 而中文里写通用沙箱是「Docker 沙箱 / 沙盒」（同样量过，0 条），不会撞上。
  //
  // 补这个词条还顺手补了一笔旧账：08-21 收的那篇《Docker Sandboxes 的隔离例外》
  // 工具标签里一个都没有这个产品，页面上点不出来——**词表有洞时，
  // 受损的不只是当天的匹配，还有已经出过刊的那些条目的标签。**
  { id: 'docker-sandboxes', name: 'Docker Sandboxes', aka: ['docker sandbox', 'sbx'] },
  // Pi（earendil-works 的极简编码 agent，官网 pi.dev）。14 天入围/落选标题里
  // 裸 `pi` 命中 9 条，**9 条全是它**（「Prime Agent——一种超越 Codex / CC / PI 的新型编码框架」
  // 「Pi Agent 深度解析」「来学习下 pi agent 的原理」「pi2.nvim 更新」），
  // 一条树莓派都没有——但正文里就不一样了：2026-08-15 的 322 条正文里裸 `pi` 命中 4 条，
  // 其中一条是 LaTeX 的 `\sqrt{\pi}`。名字太短，误伤只会来自「被别的东西整个包住」，
  // 所以按 `trae-work` 那条路子加 `not` 遮罩，把已知的三类（LaTeX 的 \pi、树莓派、
  // Pi 币）先抹掉再匹配。
  //
  // 查询词不给（进 UNQUERYABLE）：理由和 `trae-work` 同族但相反——那个是名字干净、
  // 语料脏，这个是语料干净、名字脏。「Pi 实践」这种查询发出去，搜索引擎会按
  // 树莓派和 π 给结果，等于每天往入围名单里灌一批注定被毙的东西。
  { id: 'pi', name: 'Pi', aka: ['pi agent', 'pi-agent', 'pi.dev', 'earendil'], not: ['\\pi', 'raspberry pi', '树莓派', '樹莓派', 'pi 币', 'pi network'] },
  // Headroom：给编程 agent 做上下文/记忆管理的一层（wrap / proxy 两种接入，
  // 跨 agent 共享记忆 + `headroom learn` 从历史会话里提炼纠正写回 CLAUDE.local.md）。
  // 14 天的标题里命中 3 条（「Headroom 上手：wrap 与 proxy 两种接入方式实战」
  // 「学习 Headroom 的整体架构」「学习 Headroom 的跨 agent 记忆与失败学习」），
  // **3 条全是它**。它在英文里是「净空/余量」的常用词，理论上会撞上音视频类文章，
  // 但这份语料里 0 条；先按裸词收，出现第一次误伤就改成带限定词的写法。
  { id: 'headroom', name: 'Headroom', aka: [] },
  { id: 'crush', name: 'Crush', aka: ['charm crush'] },
  { id: 'goose', name: 'Goose', aka: ['block goose'] },
  // 2026-08-24 周更体检把裸 `amp` 关掉（`bareName: false`），只认带限定词的写法。
  //
  // 它是 LESSONS 里「靠打分权重压着的嫌疑别名」名单上第一个真的被量到误命中的。
  // 1173 条语料里 `amp` 命中 3 条：两条是正经的工具枚举（「Cursor、Amp 和 Factory」
  //「Codex、Grok、Cursor、Gemini CLI、Kimi、Amp」），第三条是少数派那篇音频串流工具
  //「前级余量（**Pre-amp**）控制器」——`-` 不是拉丁字母，`makeMatcher` 的词边界拦不住。
  // 更贵的一半在**选源**那一端：同一天扫台港友链时，eddielv.com（街头艺人 / 吉他效果器
  // 博客）因为「MXR micro **amp**(M133)」「Xotic BB-preamp」被 `scoreItem()` 判成
  // 够格候选。裸词一旦进了词表，它污染的不只是当天的名单，还有「谁是 agent 博客」这个判断。
  // 关掉的代价是零：那两条正确命中都在正文、都在一长串工具名里，条目本身早就命中了别的词。
  { id: 'amp', name: 'Amp', bareName: false, aka: ['sourcegraph amp', 'amp code', 'amp cli'] },
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
  // `not` 是「认错人」的第二例，和 workbuddy / cowork 那次同一个形状（见下面那条注释），
  // 但比它更麻烦：`TRAE Work` 是字节的桌面办公 agent，而 `Trae` 是它家的 IDE，
  // 两个不同产品，**而且前者的名字整个包住了后者**——workbuddy 至少和 cowork 不共字，
  // 光拆成两个词条不够，裸 `trae` 仍然会在每一篇 TRAE Work 稿上命中一次。
  //
  // 量出来的规模（2026-08-11，555 条语料）：`trae work` 命中 15 条、其中 14 条在标题；
  // 而 `trae` 全部 26 条标题命中里，这 14 条占了一多半。也就是说页面上「Trae」这个
  // 筛选器点进去，过半是另一家的办公 agent。
  //
  // 判据仍是 LESSONS 那条：**「它本身是不是别人的名字」**。是，就拆；
  // 拆不干净的（名字被包住）再加一层 `not` 遮罩——先把 `trae work` 从文本里抹掉，
  // 剩下的 `trae` 才算数。这样「TRAE Work vs Trae 有什么区别」这种同时提到两者的
  // 标题仍然两个都命中，而纯 TRAE Work 稿只命中 trae-work。
  { id: 'trae', name: 'Trae', aka: ['trae ide'], not: ['trae work'] },
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
  // Prime Agent：递归语言模型（RLM）+ 持续进化工具那套「会改写自己」的编码 agent，
  // 2026-08 在 GitHub Trending 连着霸榜。2026-08-17 语料里 4 条、3 条在标题
  // （「Prime Agent——一种超越 Codex / CC / PI 的新型编码框架」「连续 3 天霸榜 GitHub」
  // 「让 AI Agent 学会改写自己」）。加它的理由和 Muse Code / Graph Engineering 一样：
  // 中文圈刚开始写的时候词表就该在了。
  // **只收带 agent 的写法**：裸 `prime` 是 Prime Video、素数、Amazon Prime，撞得一塌糊涂。
  { id: 'prime-agent', name: 'Prime Agent', aka: ['prime agent', 'prime-agent', 'primeagent'] },
  { id: 'jules', name: 'Jules', aka: ['google jules'] },
  { id: 'devin', name: 'Devin', aka: ['cognition devin'] },

  // —— 终端 / 桌面通用 agent ——
  { id: 'warp', name: 'Warp', aka: ['warp 终端', 'warp terminal'] },
  { id: 'claude-desktop', name: 'Claude Desktop', aka: ['claude 桌面', 'claude 客户端'] },
  // 裸 `claude`（claude.ai 网页版 / 手机 App 那个聊天产品本身）。
  //
  // 第 23 行的注释说过「Claude / Gemini / Qwen / Kimi 那几个裸词是模型名，
  // 所以**不**给它们的 CLI 条目加裸别名」——那句话没错，现在也不推翻：
  // 这里加的不是 `claude-code` 的别名，而是一个独立产品条目。判据仍然是那句
  //「能不能安装、能不能打开」：claude.ai 打得开，桌面版和 Claude Code 是另外两个东西。
  //
  // 2026-08-24 量的：376 条语料里裸 `claude`（排除 Code/Desktop/Cowork/Tag/API/模型名）
  // 标题+开头命中 26 条、全文 39 条，样本量够；逐条看完，**没有一条是 Claude Monet
  // 这类同名的人**，全部指这个产品。真正的代价不在误命中，在噪声：命中里有
  //「水星银行不支持订阅 claude 吗」「为啥现在 claude 订阅都是自己充值」这类
  // 论坛账号帖，和 LeverAI 那种中转站软文——它们确实在说这个产品，只是不值得读。
  // 所以这条词加进来是为了让**只写「Claude」不写产品全名的实作文**被看见
  //（iT 邦幫忙那批繁中系列：「Day 03｜讓 Claude 寫一份不給 Claude 用的提示詞」
  //「Day 05｜講不清楚的東西，就讓 Claude 做成一頁可以玩的網頁」，
  // 全篇 0 个工具名命中，正是 LESSONS 里「规则层结构性看不见的一类作者」），
  // 噪声那一半交给反向词和评审。
  //
  // `not` 遮罩是必需的，理由和 `trae`/`TRAE Work` 一模一样：这个名字被
  // Claude Code / Claude Desktop / Claude Cowork / Claude Tag 四个产品名整个包住，
  // 不遮的话每篇 Claude Code 稿都会白送一个 claude 标签。模型名（Sonnet/Opus/Haiku）
  // 一并遮掉——那是模型不是产品。注意连字符写法要单独列：`claude-code` 里
  // `claude` 后面跟的是 `-`，不是拉丁字母，`makeMatcher` 的词边界拦不住它。
  //
  // 查询词不给（进 UNQUERYABLE）：「Claude 实践」这种词搜出来是官网、新闻和中转站，
  // 和 `pi` 那条同族——语料干净、名字太泛。
  {
    id: 'claude',
    name: 'Claude',
    aka: ['claude.ai', 'claude 网页版', 'claude 網頁版'],
    not: [
      'claude code', 'claude-code', 'claudecode',
      'claude desktop', 'claude-desktop', 'claude 桌面', 'claude 客户端',
      'claude cowork', 'claude-cowork', 'claude tag', 'claude-tag',
      'claude dev', 'claude api',
      // 2026-09-02 补：Claude Design 是第五个「名字把裸 claude 整个包住」的产品。
      'claude design', 'claude-design',
      'claude sonnet', 'claude opus', 'claude haiku', 'claude 3', 'claude 4', 'claude 5',
      // `CLAUDE.md` / `CLAUDE.local.md` 是话题不是产品，而 `claude` 后面跟的 `.`
      // 不是拉丁字母，词边界拦不住——这一条是现成的测试当场抓出来的，
      // 正是 LESSONS 那句「它是不是某个常用词的一段」。
      'claude.local.md', 'claude.md',
      // 2026-08-27 补的三个，同一句话的下一半：上面那条只问了 `.`，
      // 而 `_` 和 `/` 也不是拉丁字母，同样是合法词边界。三处都是**别人的名字**：
      //   `CLAUDE_CODE_MAX_RETRIES` 这类环境变量 → Claude Code 的
      //   `~/.claude/`（settings.json / skills / sessions / projects / ide）→ Claude Code 的配置目录
      //   `claude_desktop_config.json` → Claude Desktop 的
      // 触发它的是犀利豆那篇重试与错误恢复：全文 6 处 claude **全是 Claude Code**，
      // 却挂上了 `claude`（claude.ai 那个聊天产品）的标签。
      // 全语料（今天 450 条 + 创刊以来 165 条收录）量过：命中从 64 掉到 60，
      // **掉的 4 条逐条看完全部是这三种写法，0 误伤**；
      // 而 `Claude/Cursor/Codex` 这种拿斜杠当顿号的列举**没有掉**，
      // 所以不能加裸的 `claude/`——那才是真的在说这个聊天产品。
      'claude_code', '.claude/', '~/.claude', 'claude_desktop',
    ],
  },
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
  // ZeroClaw：OpenClaw 那一系的**具身硬件**分支（机器人本体 + 控制端源码）。
  // 2026-08-31 周更体检加。加它的理由不是它今天热，是 LESSONS 那条
  // 「词表有洞时受损的不只是当天的匹配，还有已经出过刊的那些条目的标签，
  // 而那些条目不会有第二次打标签的机会」——罗西的思考那两篇
  // 《【OpenClaw具身硬件】ZeroClaw 源码阅读笔记（1）总体 /（2）机器人》
  // 08-26、08-27 各收了一篇（都是 4 分），而它们的 `tools` 里只有 `openclaw`，
  // 页面上点「OpenClaw」筛出来的两篇其实讲的是另一个东西。
  // 三问：撞不撞别的词——`zeroclaw` 是连写的复合词，中文英文里都不构成任何常用词的一段；
  // 是不是别人的名字——不是；有没有别人的名字把它整个包住——没有。
  // **不给它中文别名**：这一系的中文写法是「具身硬件」「机器人」，都是通用词。
  // **也不给带空格的 `zero claw`**：加完当场用系统自己的匹配器验了一遍，
  // 它命中「zero claw machine」（抓娃娃机）——按「别名的唯一标准是它单独出现时
  // 只可能指这个产品」那一条，分开写的两个英文词过不了这一问；
  // 而这份语料里带空格的写法**一条都没有**，删掉它零成本。
  //（表里 `open claw` / `nano claw` 是同样的形状，暂时留着——按「没量到就不动」，
  // 那两条至今没量到误命中，下轮连同这条一起复量。）
  // 本轮 21 天窗口里 0 命中（那两篇已经滑出窗口），照 `trellis` / `graph-engineering`
  // 那两次的规矩收：中文圈刚开始写的时候词表就该在了。
  { id: 'zeroclaw', name: 'ZeroClaw', aka: [] },
  // OpenViking（volcengine/OpenViking）：把 agent 的记忆做成一个可以 ls / find / grep 的
  // 上下文数据库，统一管记忆、知识、RAG 和 Skill。是能装能跑的引擎，所以进 TOOLS
  //（概念那一半已经有 `agent-memory` 了，两者不是一回事）。
  // 2026-08-31 周更体检量：1396 条里全文命中 4 条、标题 1 条，**跨四个不同的源**——
  // vocus「OpenViking 官方測試讓 OpenClaw 從 24% 到 82%」、掘金的 GitHub 日榜、
  // SegmentFault 和博客园两份 DSH 插件清单（都把它列成「跨会话记忆」那一格）。
  // 四条全部是这个意思，0 误伤。这个形状和 `soul-md` 那次一模一样（4 条跨 4 源）。
  // **不收中文别名「维京」**：两个字，是「维京人 / 维京海盗」的一段，
  // 正是「心流 → 核心流程」那类误伤。
  // **也不收带空格的 `open viking`**：同一次验证里它命中
  // 「open viking ship museum」，理由和 ZeroClaw 那条一样；语料里 0 条这么写。
  { id: 'openviking', name: 'OpenViking', aka: [] },
  { id: 'kimi-code', name: 'Kimi Code', aka: ['kimi cli'] },
  // ZCode（智谱，zcode.z.ai）：把 Claude Code / Codex / Gemini CLI 这些 CLI agent
  // 包进一个跨平台桌面壳里，一键切 agent、切 provider、看上下文占用。能装，所以是产品。
  //
  // 2026-08-24 周更体检量的：1173 条语料里命中 5 条、2 条在标题，**跨三个不同的源**
  //（V2EX「一条命令看 Codex / Cursor / Grok / OpenCode 的额度」把它和 Z.ai 并列、
  // V2EX「这么多的 coding Agent 大家体验下来有哪些比较好的么」把它和 grok build / Qoder
  // 并列、zhheo 两篇标题级的 ZCode 方案），其中**一条是当天的收录条目**
  //（子舒「我用一个 skill 把视觉活外包了」，正文写「我目前使用的 AI 工具是 Zcode」）。
  // 也就是说它已经进到我们收的文章里了，而词表认不出来，页面上那篇的工具标签是缺的。
  //
  // 三问：(1) 撞不撞别的词——Infocom 的 Z-machine 字节码和微软的翻译模型都写作 `Z-code`
  // 带连字符，`zcode` 连写在中文技术语料里 5/5 全对；(2) 是不是别人的名字——不是；
  // (3) 有没有别人的名字把它整个包住——没有。不收带连字符 / 空格的写法，理由就是第一问。
  { id: 'zcode', name: 'ZCode', aka: ['zcode-ai'] },
  { id: 'cowork', name: 'Claude Cowork', aka: ['claude cowork'] },
  // Claude Design：画布式界面设计工具，一页放多个 artboard，发布成网页链接，
  // 和 Claude Code 之间用 /design-sync 同步设计系统。能打开，所以是产品不是话题。
  //
  // 2026-09-02 加。513 条语料里命中 2 条、1 条在标题，**样本很小**
  //（iT 邦「Day 20 美感不夠，AI來湊 Claude Design體驗」和同系列的 Day 19），
  // 两条都对。加它的理由不是命中量，是这一族的老账：`claude-code` / `claude-desktop` /
  // `cowork` 都在表里，唯独这个新产品不在，于是「Claude Design 體驗」只能挂到裸 `claude`
  // 那个聊天产品上——和 08-24 补裸 `claude` 时发现的那种洞是同一个形状，
  // 只是这次缺的是产品条目而不是别名。**出现第一次误伤就退回去。**
  //
  // 三问：(1) 撞不撞别的词——中文里说「Claude 的设计」写的是「设计」不是 `design`，
  // 英文 `Claude design` 连写只在指这个产品时出现；(2) 是不是别人的名字——不是；
  // (3) 有没有别人的名字把它整个包住——没有，反过来它把裸 `claude` 包住了，
  // 所以下面 `claude` 条目的 `not` 里必须同时加这两种写法（和 `trae`/`TRAE Work` 同理）。
  { id: 'claude-design', name: 'Claude Design', aka: ['claude design', 'claude-design'] },
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
  // 字节的桌面办公 agent，和 Trae IDE 是两个产品（对照 WorkBuddy / CodeBuddy 那一对）。
  // 中文语料里它几乎只以投稿稿的形态出现——2026-08-06 起掘金连着几波，
  // 08-11 这天 15 条命中里 14 条在标题，形状统一（「XX vs TRAE Work」「适合 XX 的 AI 工具」）。
  // 所以词条要加（不然页面标签是错的），派生查询词不要（见 UNQUERYABLE）。
  { id: 'trae-work', name: 'TRAE Work', aka: ['traework'] },
  { id: 'claudian', name: 'Claudian', aka: [] },
  // LangSmith：LangChain 那套 agent 执行链路的观测台（Trace / 每步 token / 工具返回字节）。
  // 2026-09-06 收的 Luenci 那篇「从 LangSmith 到 AGENTS.md」通篇拿它定位上下文膨胀
  // 发生在哪一轮，而词表里「怎么看 agent 到底花了多少」这一类工具一个都没有。
  // 能打开、能自己接进去，所以是工具不是话题。
  // 别名只写死拼在一起的那一个：`langsmith` 不撞任何常用词，也不是别人名字的一段
  // （`langchain` 里没有它），后面接 `.` `-` `_` `/` 时构成的仍然是它自己的域名和文档路径。
  // **当天语料 481 条里只命中这一条**，所以它是「标签要加」那一侧的判断；
  // 真出现噪声（LangChain 教程带一句 LangSmith）就退成 `score: false`。
  { id: 'langsmith', name: 'LangSmith', aka: [] },
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
  // Spec Kit（github/spec-kit）：GitHub 官方那套规格驱动开发工具包，
  // `specify init` 起项目，再走 /specify → /plan → /tasks → /implement 四条斜杠命令，
  // 宿主是 Claude Code / Copilot / Cursor 等。能安装，所以是产品不是话题——
  // 方法论那一层是 TOPICS 里的 `spec-driven`，两者今天在同一条标题里同时出现
  // （「Spec Kit 入门：AI Agent 时代的规格驱动开发实践」），正好说明它们该分开标。
  // 当天语料只有这 1 条，加它的理由和 08-11 的 Graph Engineering 一样：
  // 中文圈刚开始写的时候词表就该在了，派生查询词跟着就位。
  // WebSearch 查证过供给确实存在（CSDN / 知乎上已有一批 Spec Kit 实践与踩坑文）。
  // 别名只收拼死的 `speckit` 和带空格的 `spec kit`：两个词都不会是别的东西的一段，
  // 也没有别人的名字把它整个包住（`openspec` 不含 `spec kit`）。
  { id: 'spec-kit', name: 'Spec Kit', aka: ['spec kit', 'speckit', 'github/spec-kit'] },
  // Cordis：DeepSeek Harness 底下那层插件运行时（DSH 以 vendor 方式引入），
  // 「一切皆插件」这句口号的机制就在它身上——ctx 上下文、可逆效应、反应式余效应，
  // 配套一篇《A Programming Paradigm for Spatiotemporal Composability》。
  // 作者 Shigma 早年做聊天机器人框架 Koishi，动态装卸插件是那条线的基因。
  // 能装（npm 包，`cordis.yml` 是 DSH 的配置文件名），所以是产品不是话题。
  //
  // 2026-08-16 DSH 发布第三天量的：全量 390 条里裸 `cordis` 命中 7 条，
  // **7 条全部是这个框架**，一条误伤都没有（含一条 linux.do 报错贴的
  // `cannot read "C:\Users\xxx\cordis.yml"`）。三问都过：不撞别的词、
  // 不是别人的名字、也没有别人的名字把它整个包住。
  //
  // **查询词不给**，进 UNQUERYABLE。理由和 `trae-work` 是同一条但方向相反：
  // 那个是名字干净、语料脏；这个名字和语料都干净，但它的中文语料几乎全是
  // DSH 架构转述稿（今天 17 条 DSH 相关入围里只收了 2 条），
  // 主动搜它等于每天往入围名单里灌一批注定被毙的 README 级拆解。
  // 标签要对，所以词条要加；查询预算有限，所以查询词不加。
  { id: 'cordis', name: 'Cordis', aka: ['cordis.yml', 'cordis 框架', 'cordis 内核', 'cordis 运行时'] },
  // GSD（gsd-build/get-shit-done）：跑在 Claude Code 等十几个宿主上的元提示 / 规格驱动
  // 开发系统，把工作切成 discuss → plan → execute → verify 四个阶段、每个阶段开一份
  // 干净上下文，用来对付长会话的 context rot。能安装（斜杠命令 + agent 包），
  // 所以是产品不是话题——方法论那一层是 TOPICS 里的 `spec-driven`。
  //
  // 三字母缩写按 LESSONS 的规矩逐条查过才敢加裸词：904 篇语料（创刊以来全部收录条目 +
  // 今日 rejected 标题 + 今日 399 条原始条目）里裸 `gsd` 命中 4 条、1 条在标题，
  // **4 条全部是它**（iT 邦幫忙那个系列的 Day 21 / 22 / 23，加上博客园码哥字节那篇
  // 「看不上 GSD、BMAD、Spec-Kit 那种重型框架」），零误伤。
  // 反过来，只收带限定词的写法（`gsd agent` / `get-shit-done`）只认得出 4 条里的 2 条——
  // Day 22 正文里就是裸 `GSD`，正是 LESSONS 那条「限定词贴得太紧于是漏掉正常语序」。
  // 它在英文里是 German Shepherd Dog / 糖原贮积病的缩写，中文技术语料里 0 条；
  // **出现第一次误伤就退回带限定词的写法**，免得下次重查。
  //
  // **查询词不给**，进 UNQUERYABLE，理由和 `pi` 同族：名字脏、语料干净。
  // 「GSD 实践」这种查询发出去，搜索引擎按牧羊犬和供应链术语给结果。
  // 手写长尾词里补了一条限定过的 `GSD agent 实践` 顶替。
  { id: 'gsd', name: 'GSD', aka: ['get-shit-done', 'get shit done', 'gsd-build'] },
  // Is Agentic（is-agentic.com，`npx is-agentic <domain>`）：给站点打「agent 能不能
  // 发现、访问、理解、使用它」的分，Essential / Recommended / Bonus 三档，
  // 报告里带一段 agent trajectory。能跑能打开，所以是产品不是话题——
  // 「站点要为 agent 而不是搜索引擎优化」那一层的概念还没有稳定叫法，先不立话题。
  //
  // 名字本身是一个合法的英文句子片段（"this workflow **is agentic**"），
  // 所以按 LESSONS「显示叫什么 ≠ 见到这几个字母算不算命中」那条关掉裸名，
  // 只从 aka 派生匹配器。530 条语料（今日 361 条原始 + 创刊以来 169 条收录）
  // 量下来 `is[- ]agentic` 命中 1 条、就是收的那篇，**0 误伤**；
  // 带空格那条写法是必须的——原文正文里通篇写「Is Agentic」而不是连字符。
  // **出现第一次误伤就把 `is agentic` 撤掉，只留连字符和 npx 两种写法。**
  { id: 'is-agentic', name: 'Is Agentic', bareName: false, aka: ['is-agentic', 'is agentic', 'npx is-agentic'] },
  // Trellis：负责多个 coding agent 之间任务衔接的编排层，2026-08-31 从
  // 「记一次 GLM 开发严重事故」里第一次见到（Codex 出 PRD → Trellis 排任务 →
  // Zcode 实现，任务记录落在 `.trellis/` 目录）。能安装能跑，是产品不是话题。
  // 347 条语料里全文命中 1 条、标题 0 条，就是那一篇。样本只有 1 条，
  // 之所以还是加，是 LESSONS 那条「词表有洞时受损的不只是当天的匹配，
  // 还有已经出过刊的那些条目的标签，而那些条目不会有第二次打标签的机会」。
  // **风险在裸名**：trellis 是普通英文词（棚架），也是 Roots 那套 WordPress 工具的名字。
  // 中文语料里这两种意思一次都没出现过，所以暂时留着裸名；
  // 按 `is-agentic` 那条的规矩，**出现第一次误伤就改成 bareName: false**。
  { id: 'trellis', name: 'Trellis', aka: ['.trellis', 'trellis 任务'] },
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
  // 2026-08-31 补：`subagent` 说的是「一个 agent 派出去的下级」，
  // 而语料里另有一整类讲的是**几个对等 agent 怎么把同一个目标兜起来**
  // （契约、共享状态、结果合并、冲突、完成判定）。两者不是一回事：
  // 当天入围名单里「多Agent协作的5个工程坑」「Multi-Agent Coordination」
  // 「从 ReAct 到 Multi-Agent」三条讲的都是后者，topics 却只能落到 subagent 或空。
  // 量法按 LESSONS 那条：347 条语料里这组别名全文命中 21 条、标题 7 条，
  // 逐条看完全部是 agent 语境。
  // **`多 agent` 这个中文别名单独拿出来是危险的**——中文没有词边界，
  // 它是「更多 agent / 许多 agent / 越来越多 agent」的一段（`心流` → 核心流程那一族）。
  // 同一份语料里这类前缀命中 0 次，但 0 不等于以后也是 0，所以用 `not` 遮罩挡住，
  // 而不是靠「这次没量到」放行。出现第一次误伤就把中文别名整个退回去。
  {
    id: 'multi-agent',
    name: '多智能体协作',
    // 带空格和不带空格是两个匹配器：`makeMatcher` 对纯 ASCII 的 needle 做的是
    // 逐字符 indexOf + 词边界，不做空白归一化，而真实标题正是「多Agent协作的5个工程坑」
    // 这种不带空格的写法。两种都要写，`not` 遮罩也得两种都写，漏一半等于没遮。
    aka: ['multi-agent', 'multi agent', 'multiagent', '多智能体', '多智能體', '多 agent', '多agent'],
    not: [
      '更多 agent', '更多agent', '许多 agent', '许多agent', '許多 agent', '許多agent',
      '越来越多 agent', '越来越多agent', '越來越多 agent', '越來越多agent',
      '大多 agent', '大多agent', '好多 agent', '好多agent', '太多 agent', '太多agent',
    ],
  },
  // 2026-08-07：今天收的「产品经理的 Claude Code 技能包实战」通篇讲 skill，
  // 规则层给它标出来的 topics 是**空的**——因为中文语料里这个概念叫「技能包」，
  // 而 aka 里只有英文写法。
  // **不收裸的「技能包」**：它是「技能包括 / 技能包含」的一段（招聘帖里
  // 「要求技能包括…」很常见），正是 `心流` → 核心流程 那类误伤。
  // 也不收裸的 `skill`：soft skill / skill tree 都是常用词，和 `operator` 同类。
  // 只认带限定词或带扩展名的写法，和 `harness` / `acp` 的处理一致。
  // `agent skill`（单数）2026-08-11 补：10 条命中里现有的复数别名只认出 5 条，
  // 漏的全是「做成 Agent Skill」「一个 Agent Skill 能不能……」这种单数写法。
  // 单数是复数的前缀，加它等于同时覆盖两种写法，没有额外误伤面。
  // 裸 `skill` / `skills` 是 2026-08-17 放宽的，和上面 `harness` 那条同一轮、同一个方法：
  // 全量 1350 条里含裸英文 `skill(s)` 的有 153 条，其中 18 条**标题里就有**
  // （「给 Codex 接了个 Everything 文件搜索 Skill」「Skills 不是插件清单」
  // 「长程任务如何节省 Token？一年多经验总结成 SKILL」），而旧别名一条都认不出来。
  // 原注释担心的两类反例（soft skill / skill tree / 技能树 / 技能要求）实测 **0 条**。
  // **中文的「技能」仍然不收**：招聘帖里「技能要求」「技能包括」满地都是，
  // 而中文没有词边界，这正是 LESSONS 里「心流 → 核心流程」那类误伤。
  // 也就是说这一条放宽的只有英文写法这一半。
  { id: 'skills', name: 'Agent Skills', aka: ['skill', 'skills', 'agent skill', 'claude skills', 'skill.md', '.claude/skills', 'skills 目录', 'code 技能包'] },
  { id: 'agents-md', name: 'AGENTS.md', aka: ['agents.md'] },
  { id: 'claude-md', name: 'CLAUDE.md', aka: ['claude.md'] },
  // SOUL.md：agent 的人格 / 语气定义文件，OpenClaw 那一系带起来的约定
  // （社区那个 205 个模板的仓库，每个模板就是一份 SOUL.md）。
  // 2026-08-13 加：377 条语料里命中 4 条，**跨 4 个不同的源**——掘金那篇
  // Hermes/OpenClaw 对比、博客园的 MiniClaw 源码拆解、哈啰 JuiceFS 那篇列
  // Workspace 里的人格文件（AGENTS.md / SOUL.md / PROFILE.md / MEMORY.md）、
  // iT 邦幫忙的「我的 AI 沒有資料庫」。四条全部是这个意思，一条误伤都没有。
  // 和 `claude-md` / `agents-md` 同族：约定文件是话题不是产品，装不了也打不开。
  // 别名只收带扩展名的写法，误伤面为零——裸的 `soul` 当然不能要。
  { id: 'soul-md', name: 'SOUL.md', aka: ['soul.md'] },
  // MEMORY.md：agent 的长期记忆落盘文件，和 SOUL.md 是同一族约定文件
  // （NAS 那套 workspace 里是「SOUL.md 管语气、IDENTITY.md 管身份、AGENTS.md 管品质闸道、
  // MEMORY.md 加每日 memory/YYYY-MM-DD.md 管记忆」）。
  // 2026-08-17 全量 1350 条里命中 10 条，跨 iT 邦幫忙 / 掘金 / 博客园（MiniClaw 把它放在
  // SPIFFS 上、Headroom 的写入器按 200 行常驻算 token 预算）。带扩展名，误伤面为零。
  // 同族的 `IDENTITY.md` 只有 3 条且集中在一个作者，先不收，等它散开到别的源再说。
  { id: 'memory-md', name: 'MEMORY.md', aka: ['memory.md'] },
  { id: 'agent-sdk', name: 'Agent SDK', aka: ['agent sdk', 'claude agent sdk'] },
  { id: 'vibe-coding', name: 'Vibe Coding', aka: ['vibe coding', '氛围编程', '氛围编码'] },
  // 2026-08-11：947 条语料里讲这件事的有 14 条，被认出来的只有 6 条。漏的两种写法都补上：
  // 中文圈一半写「规格驱动」一半写「规范驱动」（「试试这套 SDD 规范驱动工作流」），
  // 而英文圈已经把它缩成了 `SDD`——10 条命中里 5 条在标题上（「再见SDD——Spec驱动开发
  // 为何不适合大多数项目」「AI Coding 那么快，为什么还需要 SDD？」「新范式 SDD+TDD？」）。
  // 逐条查过这 10 条，**没有一条是别的意思**：SDD 在中文技术语料里不像 ACP 那样
  // 撞上阿里云认证，也不像 `cc` 那样一词多义。三个字母的缩写照例是危险的，
  // 所以这条是「查完 10/10 全对」才加的，不是想当然。
  { id: 'spec-driven', name: '规格驱动开发', aka: ['spec driven', 'spec-driven', '规格驱动', '规范驱动', 'sdd'] },
  { id: 'loop-engineering', name: 'Loop Engineering', aka: ['loop engineering', '循环工程'] },
  // 「上下文压缩」实测 3 篇里 3 篇没被标上，而它讲的就是上下文怎么管——
  // 四个字，不可能是别的常用词的一段，可以放心加。
  { id: 'context-engineering', name: 'Context Engineering', aka: ['context engineering', '上下文工程', '上下文压缩', 'context compaction'] },
  // 「长期记忆」是 2026-08-11 补的：13 条命中逐条看完，全部在讲 agent 跨会话记忆
  // （「AI Agent 长期记忆怎么存？」「OpenCode 接入 OpenViking 跨会话长期记忆」
  // 「AI智能体的记忆，终于有人认真研究文件系统这条路了」）。
  // 它确实也是心理学名词，但四个字连着出现、且这份语料里 0 条是那个意思。
  { id: 'agent-memory', name: 'Agent 记忆', aka: ['agent 记忆', '智能体记忆', '记忆层', '长期记忆'] },
  { id: 'hooks', name: 'Hooks', aka: ['claude code hooks', 'stop hook', 'pretooluse'] },
  // 「把 agent 围起来干活的那层脚手架」正在从行话变成固定说法（Claude Code 源码
  // 泄露之后尤其密集）。
  // ~~**不收单独的 `harness`**：test harness / wire harness 都是常用词，
  // 单独出现指向不唯一，只认带限定词的写法。~~
  // **2026-08-17 推翻，理由是数据不是感觉**（做法同 08-11 放宽 `git worktree` 那次）：
  // 全量 1350 条里，把 `DeepSeek Harness` 抹掉之后仍然出现裸 `harness` 的有 52 条，
  // 而这套带限定词的别名一条都没认出来；逐条看完 **52 条全部是 agent 语境**
  // （「从 Agent = Model + Harness 说起」「与其追模型，不如造 harness」
  // 「我给 Agent 套了层 Harness 缰绳」「从 Skills 到 Harness」）。
  // 反例一条都没有：`test harness` 0 条、`wire harness` 0 条、`线束` 0 条，
  // 唯二的「马具」出现在解释这个词的比喻里。55 条标题里有裸 harness，
  // 也就是说这一年里中文技术语料把这个词整个让给了 agent。
  // 出现第一次误伤就退回带限定词的写法——注释留在这里，免得下次得重新查。
  //
  // 配一层 `not` 遮罩，理由和 `trae` / `TRAE Work` 那次一字不差——
  // **`DeepSeek Harness` 这个产品名整个包住了 `harness` 这个话题词**（LESSONS 的第三问）。
  // 不遮的话，DSH 发布周那批稿子每一篇都会在「命中 dsh」之外再白拿一次「命中 harness」，
  // 而标题命中是按个数加分的（`6 + min(n-1, 2)`），等于给同一个名字数两遍。
  // 实测代价很直观：不遮罩时 21 天重放的 60 席里挤进 5 篇 DSH 发布稿，
  // 挤掉的是犀利豆那两篇 EnterPlanMode / ExitPlanMode 源码拆解。
  // 「DSH 和别的 harness 怎么选」这种同时提到两者的标题仍然两个都命中——
  // 遮罩只抹掉被包住的那一处写法。
  { id: 'harness', name: 'Agent Harness', aka: ['harness', 'agent harness', 'harness engineering', 'harness 工程', 'agentic harness'], not: ['deepseek harness', 'deepseek-harness', 'deepseekharness'] },
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
  // 2026-08-11 补 `git worktree`：语料里提到 worktree 的 19 条，上面这套「带 agent
  // 限定词」的别名只认出 4 条。漏掉的写法是把限定词放在**句子**里而不是紧挨着词
  // （「多个 AI Agent 同时改一个项目，我用 git worktree 让它们互不打架」
  // 「面向 Coding Agent 的多仓库 Git Worktree」「Anthropic建议为每个Agent创建Git Worktree」）。
  // 原来的注释担心「讲分支管理的文章会大面积误伤」——947 条里 `git worktree` 命中 13 条，
  // **逐条看完 13 条全部是 agent 语境**，包括唯一一条从纯 git 讲起的
  // 「Git Worktree 实战：从多分支并行，到 AI Agent 隔离」。担心的那类文章在这份语料里不存在，
  // 所以从「只认紧挨着的限定词」放宽到「认 git worktree 这个固定搭配」。
  // 仍然**不收裸 `worktree`**：那 6 条差额里有 tmux 编排、纯分支管理，值不回票价。
  { id: 'worktree', name: 'Worktree 隔离', aka: ['concurrent worktree', 'agent worktree', 'git worktree', 'worktree 隔离', 'worktree 并行', '并行 worktree', '多 agent worktree'] },
  // 「先出方案、批准了再动手」这套已经从 Claude Code 的一个模式变成通用做法
  // （OpenCode 的 Plan agent、Cursor 的 plan、Codex 的 /plan 都是同一件事）。
  // 2026-08-06 犀利豆那两篇 EnterPlanMode / ExitPlanMode 拆解在规则层
  // 一个 topic 都没标上，标出来的反而是误判的 `subagent`。
  // **绝对不收单独的 `plan`**：计划、方案、plan B 满地都是。
  // 「规划模式」四个字连着出现基本只可能是这个意思，可以收。
  { id: 'plan-mode', name: '规划模式', aka: ['plan mode', 'planmode', '规划模式', 'enterplanmode', 'exitplanmode'] },
  // Loop Engineering 的下一个说法，2026-08 开始出现：把「生产结果 / 检查结果 /
  // 判断方向」拆给不同节点，别让一个 loop 既当运动员又当裁判。
  // 947 条里 4 条，其中 2 条在标题（「Loop Engineering 之后是什么？Graph Engineering
  // 完整拆解」「聊聊 Graph Engineering —— 别让一个 Agent 既当运动员又当裁判」）。
  // 4 条不算多，加它的理由和 Muse Code 那次一样：**中文圈刚开始写的时候词表就该在了**，
  // 派生查询词跟着就位，等它变热的时候不至于漏抓。
  // 只收英文写法。**不收「图工程」**：三个字，是「制图工程」「地图工程」的一段，
  // 正是「心流 → 核心流程」那类误伤。
  { id: 'graph-engineering', name: 'Graph Engineering', aka: ['graph engineering'] },
  // Agent 的执行主循环——「模型决定调用工具 → 工具执行 → 结果回模型」那一圈。
  // 2026-08-19 补：DSH 把它做成插件、犀利豆拆 Claude Code 的 background 机制、
  // lqhl 比 Pi 与 DSH，讲的都是这一圈怎么组织，而词表里一直没有它
  // （`loop-engineering` 是「怎么设计循环」的方法论，不是循环本身）。
  // 当天 513 条里 `agent loop` 命中 9 条、`agent 循环 / 智能体循环` 命中 9 条，
  // 逐条看完全部是 agent 语境，0 条误伤。
  // 三问：(1) 撞不撞别的词——英文两词、中文四字以上，不会是别的词的一段；
  // (2) 是不是别人的名字——**是，阿里云有个产品就叫 AgentLoop**（08-18 那篇望宸的
  // DSH 拆解结尾推的就是它），所以**不收连写的 `agentloop`**，只认带空格 / 连字符的写法；
  // (3) 有没有别人的名字把它整个包住——没有。
  // **不收裸「主循环」**：游戏主循环、事件主循环都是常用说法，
  // 当天 3 条命中虽然全对，但样本太小，是「心流 → 核心流程」那类误伤的候选。
  { id: 'agent-loop', name: 'Agent Loop', aka: ['agent loop', 'agent-loop', 'agent 循环', '智能体循环'] },
  // WebMCP：把 MCP 那套「网页向 agent 提供工具」搬到浏览器里的提案，
  // 网站在自己的页面上声明工具，浏览器里的 agent 直接调，不用各自写爬虫。
  // 是约定 / 协议，不是能装的东西，所以进 TOPICS（和 `acp`、`okf` 同族）。
  //
  // 2026-08-24 量的：1173 条里 2 条，1 条在标题（zhheo「WebMCP适配教程：为浏览器AI
  // 预备好，让网页向 AI 提供工具，本博客已支持」——他自己的博客接了一份），
  // 另一条是东评西就那篇把它和「Agent 邮箱」并列谈未来入口。条数不多，
  // 加它的理由和 Graph Engineering / Spec Kit 那两次一样：**中文圈刚开始写的时候
  // 词表就该在了**，等它变热再补就已经漏了一批。
  //
  // 顺带修一个盲点：`webmcp` 里的 `mcp` 前面跟着 `b`，是拉丁字母，
  // `makeMatcher` 的词边界不认——也就是说在加这一条之前，
  // 「WebMCP 适配教程」这个标题**一个话题词都命中不到**，`mcp` 也不会命中。
  // 不收拆开的 `web mcp`：那两个词分开写的时候基本是在讲「Web 上的 MCP 服务」。
  { id: 'webmcp', name: 'WebMCP', aka: ['web-mcp'] },
  // RAG。2026-09-03 补的一处纯遗漏，形状和 `claude` 那次一模一样：
  // 表里有 `agent-memory`（记忆）却没有检索这一半，于是罗西那篇
  // 「ZeroClaw 源码阅读笔记（3）--- RAG」——通篇在拆两套 RAG 管线
  // （HardwareRag 纯关键词 vs Memory 的 cache → FTS5 → vector 三阶段）——
  // **一个话题词都挂不上**，页面上它只有两个工具标签。
  // 词表有洞时受损的不只是当天的匹配，还有已发布条目的标签，而那些条目没有第二次机会。
  //
  // 487 条里 `RAG` 命中 11 条、4 条在标题，逐条看完没有一条是别的意思。
  // 三问：(1) 撞不撞别的词——三字母裸词，但 `makeMatcher` 的词边界管用，
  //     dragon / storage 这类内嵌一律不命中；(2) 是不是别人的名字——不是，是技术名；
  // (3) 有没有别人的名字把它整个包住——`RAGFlow`、`GraphRAG` 都包着它，
  //     但它们两侧接的都是拉丁字母，词边界本来就挡住了，**这次不用 `not` 遮罩**
  //     （和 `TRAE Work` 那次的区别：那个是 `TRAE` + 空格 + `Work`，空格不是边界）。
  // 中文写法只收 `检索增强生成` 六个字。**不收四字的「检索增强」**——
  // 中文没有词边界，「把检索增强一下」这种正常语序会命中，正是「心流 → 核心流程」那一族。
  // 出现第一次误伤就退回去，改成只认带限定词的写法。
  //
  // **查询词不给**，进 UNQUERYABLE，理由和 `pi` / `claude` 同族但更硬：
  // 名字干净，语料脏得多——「RAG 实践」搜出来是整个 RAG 工程圈
  // （Neo4j + Milvus 的问答系统、向量库选型、切分策略），
  // 它们真的在讲 RAG，但一篇 agent 折腾都没有，等于每天往名单里灌一批注定被毙的东西。
  //
  // **分也不给**（`score: false`，见下面 SCORELESS 那段）。这一条是加它的当天用
  // 离线重放量出来的：当普通话题加进去，越过入围线的 3 条全是噪声，而该救的那条
  // 本来就在名单里。同一个理由的三段——词条要、查询词不要、分不要。
  { id: 'rag', name: 'RAG', aka: ['检索增强生成'], score: false },
];

/** 更泛的 agent 词。单独出现不足以判定，但能给分。 */
export const SOFT_TERMS = [
  // `ai coding` 是 2026-08-11 补的一处纯遗漏：表里一直有 `ai 编程` / `coding agent`，
  // 唯独没有中文圈同样常用的这个英文写法。947 条语料里 24 条命中、其中 8 条在标题
  // （「一篇 AI Coding 生态发展的自省记述」「2026 AI Coding 下半场」
  // 「AI Coding 还看源代码吗？」），全部是本刊要的那个意思。
  'ai 编程', 'ai编程', 'ai coding', '智能体', '编程助手', '代码助手', '智能编码', 'coding agent',
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
  // —— 繁体写法，2026-08-31 周更体检补 ——
  //
  // 这张表从创刊起就是照简中语料写的，而供给结构早就不是了：iT 邦幫忙的八个铁人赛系列
  // 加方格子 vocus 加台港博客，现在占入围名单四分之一。08-16 那轮已经发现
  // 「`SELF_PROMO` 整张表在繁体语料上从来没有命中过一次」并把它补全了，
  // **但没有人回头看这张表**——而它比 `SELF_PROMO` 贵得多：那张是扣分的，
  // 这张是加分的，漏掉等于给一整个语种的作者系统性降权。
  //
  // 1396 条语料上逐对量的（左边是表里已有的简体写法命中数，右边是繁体写法）：
  //   记录 154 / 記錄 55、小时 82 / 小時 47、教训 9 / 教訓 28、实测 41 / 實測 27、
  //   体验 186 / 體驗 18、从零 31 / 從零 18、一个月 25 / 一個月 16、总结 49 / 總結 12、
  //   怎么用 12 / 怎麼用 12、替换 35 / 替換 11、一周 22 / 一週 11、天后 6 / 天後 10、
  //   为什么我 6 / 為什麼我 9、试用 41 / 試用 8、实践 94 / 實踐 7、对比 71 / 對比 5、
  //   这样用 0 / 這樣用 5、姿势 5 / 姿勢 4、翻车 9 / 翻車 3、迁移 44 / 遷移 2、
  //   手记 3 / 手記 1、复盘 27 / 復盤 1、劝退 4 / 勸退 1。
  //
  // 误伤面为零：每一条都是表里那个词的另一种字形，不是新词，没有引入任何新语义。
  // （`折騰` / `入門到` / `親測` / `定製` / `騷操作` 本轮 0 命中，一起补上——
  // 简繁对是成对的，留一半在表外就是下一次复发。）
  //
  // 代价最大的那一半不在当天名单上，在**铁人赛条件式罚分**：`SERIAL_TITLE` 只在
  // 正文经验词 ≥4 时把罚分从 4 减到 2，而繁中连载的经验词本来就有一多半认不出来——
  // 也就是说这张表的洞让「Day N」那条罚分对繁中作者恒定按最重的一档走。
  // 这是 LESSONS「每加一个新字形的源，回头把所有中文正则查一遍」的第五次复发，
  // 前四次换的是简繁（LINK_ANCHOR）、半角/全角（SELF_PROMO）、方言词（部落卷）、
  // 空格有没有（multi-agent）。
  '折騰', '實測', '試用', '體驗', '記錄', '手記',
  '實踐', '復盤', '總結', '教訓', '翻車', '入門到', '從零',
  '親測', '定製', '遷移', '替換', '對比',
  '一週', '一個月', '天後', '小時',
  '為什麼我', '怎麼用', '這樣用', '姿勢', '騷操作', '勸退',
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
  // 三组的繁体写法同样是 2026-08-31 周更体检补的，和 EXPERIENCE_MARKERS 同一轮、
  // 同一个理由（见那边的长注释）。这半边的量级小得多——1396 条里唯一繁体命中
  // 只有 課程 9、免費額度 5、論文 5、限時 4、優惠 3，其余各 1-2 条——
  // 但**不补就是不对称**：正向词补了繁体、反向词没补，等于把繁中语料整体上调了一档。
  news: ['融资', '估值', '官宣', '发布会', '财报', '季度', '市值', '收购', '裁员',
    '榜单', '排行榜', '市场份额', '行业报告', '白皮书', '峰会', '大会召开', '受访',
    '据悉', '日前宣布', '正式发布', '重磅', '刷屏', '爆火',
    '融資', '發布會', '財報', '收購', '裁員', '榜單', '市場份額', '行業報告',
    '白皮書', '峰會', '大會召開', '受訪', '據悉', '正式發布'],
  // `低价` 是 2026-08-17 拿掉的：**它是「低价值」的一段**。
  // 全量 1350 条里命中 18 条，其中 7 条是 `低价值`（「不允许发明低价值工作」
  // 「有价值的长期记忆会被海量低价值信息淹没」）和 `低价团`（央视曝光的旅游新闻），
  // 而真正的黑产帖每一条都同时命中 `中转`，拿掉它一条都不会漏。
  // 代价是 12 条「唯一命中低价」的条目各回 4 分，其中只有 1 条越过入围线——
  // 正是被误杀的那篇「AI 写了一个月代码，人类只提交 13 次」（作者把 qwen-code-dev-bot/
  // oh-my-cli 拉下来数了 841 次提交，把人类那 13 次逐条点开看）。
  // 教训写进 LESSONS：**反向词表也要过「它是不是某个常用词的一段」那一问**，
  // 这张表从创刊起就没按正向词表的标准审过。
  promo: ['拼车', '中转', '白嫖', '免费额度', '车队', '代充', '优惠', '折扣',
    '促销', '限时', '解锁', '破解', '共享账号', '开车', '上车', '合租', '批发',
    '招聘', '内推', '广告', '赞助', '带货', '课程', '训练营', '报名',
    // **补繁体时被数据挡回来五个词**，记下来省得下次再加一遍。
    // 按 LESSONS 那条老规矩量的（唯一命中数 + 会误伤哪些已收录条目）：
    //   免費額度 5 条唯一命中 → 误伤 2 篇 5 分（「Day 22：睡一覺醒來，我的 AI 刷了 $40 美金」
    //                        「Day 15：一個系統，兩個排程器」——**免费额度用完正是这两篇的题眼**）
    //   課程     9 → 误伤 1 篇 4 分       優惠 3 → 误伤 1 篇 4 分
    //   解鎖     2 → 误伤 1 篇 4 分       報名 1 → 0 误伤，但它是铁人赛的「報名」
    // 其余每一个都是 0 误伤，照补。
    //
    // 第六个是补上之后又撤掉的，因为它踩的是另一族的坑：`中轉` 2 条唯一命中，
    // **两条都是「繁中轉譯」**（繁中 + 轉譯，Day 4「繁中轉譯來源卡片與 placeId 去重」、
    // Day 5「Google Maps Grounding 繁中轉譯與來源卡片」）。
    // 简体那半不会有这个问题——简中语料里没人把「简体中文」缩写成「简中」再接一个动词，
    // 而繁中圈「繁中 / 簡中」是日常缩写。这是「心流 → 核心流程」在一个新字形上的复发：
    // **同一个词的两种字形，会各自撞上不同的常用词，不能假定简体量过繁体就安全。**
    //
    // 为什么同一个词的简体那半留着、繁体这半不留——不是偷懒，是两边的语料不是一批人：
    // 简体那半量的是 V2EX / linux.do 的卖号帖（`优惠 / 免费额度 / 解锁` 出现时几乎一定在卖东西），
    // 繁体这半量的是 iT 邦铁人赛和 vocus 的个人写作（同样几个字出现时在讲自己被扣了多少钱）。
    // 和 LESSONS 里 `低价` 那条同族：**看起来该加，实测它误伤的比挡住的多**，
    // 只是那条说的是删一个已有的词，这条说的是别加一个看起来对称的词。
    '車隊', '促銷', '限時', '共享帳號',
    '開車', '上車', '批發', '內推', '廣告', '贊助', '帶貨', '訓練營'],
  academic: ['arxiv', '论文', '综述', 'benchmark 结果', '数据集', '实验表明',
    '本文提出', '我们提出', 'sota', '消融实验',
    '論文', '綜述', '數據集', '實驗表明', '我們提出', '消融實驗'],
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
  // `gsd` 在 UNQUERYABLE 里（裸缩写搜出来是牧羊犬），限定过的写法放在这里顶替。
  'GSD agent 实践',
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

/**
 * 太泛的名字不适合做查询词，搜出来全是噪声。
 *
 * `trae-work` 不是「太泛」而是另一种情况：名字很独特，但这个产品目前的中文语料
 * 几乎全是投稿稿（2026-08-11 语料里 15 条命中，标题形状统一到能一眼认出）。
 * 主动去搜等于每天往入围名单里灌一批注定要在评审那步毙掉的东西，
 * 而评审预算是这个项目最稀缺的东西。词条留着只为标签正确。
 */
// `marscode` 是第三种情况：**这个名字指的产品已经不叫这个名字了**（字节把 MarsCode 改名成 TRAE）。
// `query-yield.json` 记着它的三条派生查询各跑了 3 轮，合计捞回 1 条原始条目、0 条入围。
// 词条要留着——它还认得出改名之前那批文章；查询词没有意义，主动去搜一个没人再用的名字。
// `augment` 是第四种情况：名字不泛、产品也还在，但**中文语料里没人写它的实践**。
// 2026-08-24 结账：它派生的三条查询合计跑了 14 轮、捞回 11 条原始条目、入围 0 条
//（踩坑 5 轮 8 条、体验 5 轮 2 条、实践 4 轮 1 条），`lastShortlist` 三条全是 null。
//
// 顺手记一条口径：手册写的是「跑够 5 轮仍零入围的**查询词**换掉」，而 UNQUERYABLE
// 的粒度是**工具**。两者不能直接换算——同一轮里 `通义灵码 实践` 也是 5 轮 0 入围，
// 但 `通义灵码 踩坑`、`通义灵码 体验` 各出过 1 条（后者就在昨天），
// 只看那一条零产出的查询就砍掉整个工具会砍错。
// 判据应该是：**这个工具派生的所有查询都跑够轮次，且合计零入围。**
// `is-agentic` 进这里的理由和 `pi` / `gsd` 同族：名字本身是一个合法的英文句子片段，
// 「Is Agentic 实践」这种查询发出去，搜索引擎按「是不是 agentic」给结果。
// `rag` 是第五种情况，也是这个集合里第一个**话题**：名字干净、指向唯一，
// 脏的是它背后那片语料——RAG 工程本身是一个独立的大领域，
// 主动去搜它等于每天把向量库选型和切分策略灌进名单。词条要（标签得对），查询词不要。
const UNQUERYABLE = new Set(['copilot', 'zed', 'dia', 'comet', 'crush', 'goose', 'jules', 'amp', 'manus', 'hermes', 'trae-work', 'pi', 'cordis', 'marscode', 'claude', 'augment', 'gsd', 'is-agentic', 'rag']);

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
 * 当天该跑哪一批轮转词。
 *
 * **原来是「按天平移一个连续窗口」，那个写法从来没有真的轮转过。**
 * 2026-08-17 的体检从 `query-yield.json` 量出来：13 天、312 个查询槽，
 * 只碰到 254 个词里的 145 个，**尾部整整 61 个词一次都没跑过**
 * （Spec Kit / OpenSpec / Superpowers / DeepAgents / Muse Code / DSH / Headroom /
 * CC Switch / Cowork，以及**全部** TOPICS 派生词：MCP 怎么用、Agent Skills 实践、
 * CLAUDE.md 实践、Hooks 实践、Worktree 隔离实践……）。
 * 按词表位置画出每个词跑过几轮，形状是一个中间 4 轮、两头 0 轮的平滑驼峰——
 * 「分布过于整齐时先怀疑管道」的又一例。
 *
 * 成因是窗口起点 `(days * rotating) % pool.length` **依赖池子长度**，
 * 而 `days` 是两万多的大数：池子每加一个词（也就是每次改词表），
 * 取模结果就跳到一个毫不相干的位置。于是「每天平移 24 格」的连续覆盖被打断，
 * 变成每改一次词表就随机重开一次，重复采样中段、两头永远够不着。
 *
 * 危害有两层：**供给**上凭空少搜了四分之一的词（其中包括整个 TOPICS 面），
 * **账本**上 `query-yield` 永远攒不够轮次——手册里「换掉长期零产出的查询词」
 * 那一条，只要这个 bug 在，就永远执行不了（今天 254 个词里跑够 5 轮的
 * 只有 6 个核心词，而它们根本不参与轮转）。
 *
 * 改成按**词在池子里的位置**分桶：`cycle = ceil(池子 / 每日额度)`，
 * 第 i 个词属于第 `i % cycle` 桶，当天跑第 `days % cycle` 桶。
 * 性质是「每个词每 cycle 天恰好跑一次」，而且**和池子长度无关**——
 * 中间插一个新词，只让它后面的词各挪一个桶（早一天或晚一天跑），
 * 不会像取模那样把所有人重新洗一遍。
 *
 * @param {string[]} pool 轮转池
 * @param {string} date YYYY-MM-DD
 * @param {number} rotating 当天能跑几个轮转词
 */
export function rotationSlice(pool, date, rotating) {
  if (rotating <= 0 || !pool.length) return [];
  const cycle = Math.max(1, Math.ceil(pool.length / rotating));
  const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  const bucket = ((days % cycle) + cycle) % cycle;
  return pool.filter((_, i) => i % cycle === bucket);
}

/**
 * 当天要跑的查询：核心词（每天必跑）+ 按天轮转的切片。
 * @param {number} perDay 总条数（含核心词）
 */
export function queriesForDate(date, perDay = 24) {
  const rotating = Math.max(0, perDay - CORE_QUERIES.length);
  return [...new Set([...CORE_QUERIES, ...rotationSlice(rotatingQueries(), date, rotating)])];
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

/**
 * `not` 遮罩：一个词条的名字被另一个产品的名字整个包住时用。
 *
 * 拆词条能解决「认错人」的大多数情况（`workbuddy` 从 `cowork` 的 aka 里拆出来），
 * 但拆不了名字互相包含的那种——`TRAE Work` 里就带着 `Trae` 三个字母，
 * 光加一个 `trae-work` 词条，裸 `trae` 照样在每篇 TRAE Work 稿上命中。
 *
 * 做法是**先把被排除的短语从文本里抹成等长空格，再跑这个词条的匹配器**。
 * 抹成等长而不是删掉，是为了不把两侧字符黏到一起、破坏词边界判断
 * （删掉的话 "traework" 里的 work 会贴上前一个字符）。
 * 空格既不是拉丁字母也不是 `&`，正好满足 `makeMatcher` 的边界要求。
 *
 * 这样处理的好处是它只影响被 `not` 标注的那个词条：
 * 「TRAE Work vs Trae」这种同时提到两个产品的标题，`trae-work` 照常命中，
 * 而 `trae` 看到的是抹掉之后的文本——里面还剩一个裸 Trae，也命中。
 * 纯 TRAE Work 稿抹完就什么都不剩，只命中 trae-work。
 */
function maskOut(text, phrases) {
  let out = text;
  for (const p of phrases) {
    if (!p) continue;
    const blank = ' '.repeat(p.length);
    for (let i = out.indexOf(p); i >= 0; i = out.indexOf(p, i + p.length)) {
      out = out.slice(0, i) + blank + out.slice(i + p.length);
    }
  }
  return out;
}

/**
 * `bareName: false`：**这个产品的显示名不能当别名用**。
 *
 * 词条默认拿 `name` 当第一个匹配器，绝大多数时候这是对的（`OpenCode`、`Cordis`）。
 * 但有一类产品的名字本身就是常用词，而它又必须以那个名字显示在页面上——
 * 这时候「显示叫什么」和「见到这几个字母算不算命中」是两件事，不该由同一个字段决定。
 * 第一例是 `Amp`（见上面那条注释：Pre-amp、micro amp、安培）。
 *
 * 和 `not` 遮罩的分工：`not` 解决「别人的名字把我整个包住」（TRAE Work → Trae），
 * 遮掉一个**具体的**短语；这一条解决「我的名字本身就不唯一」，
 * 被包住的写法数不完（pre-amp / op-amp / guitar amp / 一个 amp），列不过来也不该列。
 */
function buildIndex(entries) {
  return entries.map((e) => ({
    ...e,
    matchers: [...(e.bareName === false ? [] : [e.name.toLowerCase()]), ...e.aka.map((a) => a.toLowerCase())].map(makeMatcher),
    masks: (e.not ?? []).map((n) => n.toLowerCase()),
  }));
}

const TOOL_INDEX = buildIndex(TOOLS);
const TOPIC_INDEX = buildIndex(TOPICS);

function matchIn(index, text) {
  const lower = String(text ?? '').toLowerCase();
  const hits = [];
  for (const entry of index) {
    const text = entry.masks.length ? maskOut(lower, entry.masks) : lower;
    if (entry.matchers.some((m) => m(text))) hits.push(entry.id);
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

/**
 * 「显示叫什么」「见到这几个字母算不算命中」「算不算分」是**三**件事。
 *
 * 前两件 2026-08-24 就分开了（`bareName: false`：`name` 只管显示，匹配器只从 `aka` 派生）。
 * 第三件是 2026-09-03 加 `rag` 时逼出来的，而逼出它的是一次离线重放：
 * 词表的洞是真的（罗西那篇通篇拆两套 RAG 管线的稿子一个话题词都挂不上），
 * 但把 `rag` 当普通话题加进去之后拿当天 487 条重放，
 * **越过入围线的 3 条全是噪声**——一条「[远程兼职] 8 年全栈…寻 AI Agent 方向」的求职帖、
 * 一条阿里云沙龙全回顾、一条 RL 笔记，
 * 而该救的那条本来就在名单里（9 → 10 分，名次没变）。净收益是 0 条，代价是 3 个评审席位。
 *
 * 这正是 LESSONS 里 `低价` / `免費額度` / `广告` 那一族的形状——**看起来该加，实测翻进来的是垃圾**——
 * 只是那三条说的是反向词该不该删，这条说的是正向词该不该给分。
 * 两个结论都对，而且不冲突：**标签要加**（标签错了就永远错了，已发布条目没有第二次机会），
 * **分不要给**（RAG 是一个独立的大领域，「提到 RAG」离「这篇在讲 agent 折腾」还差得远）。
 * 和 UNQUERYABLE 是同一句话的第三段：词条要、查询词不要、分也不要。
 *
 * 判据：**这个词命中的语料里，「在讲 agent 折腾」的比例低到不足以当证据**。
 * 加进来之前先拿 `tinker-retriage` 重放一遍，看越线的那几条是什么。
 */
const SCORELESS = new Set([...TOOLS, ...TOPICS].filter((t) => t.score === false).map((t) => t.id));

/** 打分口径的命中：把只用来打标签、不作为「这篇在讲 agent」证据的词条滤掉。 */
export function scoringHits(ids) {
  return ids.filter((id) => !SCORELESS.has(id));
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

