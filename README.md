# AI 信源罗盘

每天抓取 AI 信源的新内容，生成中文摘要。Codex Sites 版本发布到
<https://ai-news-reader-maoyue.yue14mao.chatgpt.site>。

**每日任务在北京时间 08:00 自动运行**，无人值守：抓取 → 写中文摘要 → 构建 → 提交推送 → 发布。
Claude Routine 的旧流程见 `DAILY.md`；迁移后的 Codex Sites 流程见 `CODEX_DAILY.md`。
运行时配置、四条必须遵守的约束、以及已经调查过不要重走的死路，见 **[OPERATIONS.md](OPERATIONS.md)**——
接手时先读它。

信源共 96 个，其中 56 个有可用 feed 正在抓取，40 个无可发现的 feed（多为微信公众号、
知乎与 Apple Podcasts 的搜索页链接，结构上不存在 feed），保留在列表中但未启用。

## 结构

- `sources.json` — 信源列表，**唯一真相源**。增删信源改这里。
- `scripts/fetch.mjs` — 并发抓 feed，去重，正文补全，产出 `data/_pending.json`
- `scripts/build.mjs` — 把最近 30 天数据内嵌进 `dist/index.html`
- `scripts/discover-feeds.mjs` — 探测信源的 feed 地址（新增信源后跑一次）
- `scripts/audit-feeds.mjs` — 体检已启用 feed 的条目数、新鲜度、有正文占比
- `lib/` — feed 解析、HTML 转文本、正文提取、URL 指纹、存储层、页面渲染
- `templates/` — 页面的 CSS 与浏览器端 JS，构建时内联进 HTML
- `data/` — `seen.json` 去重记录、`status.json` 各源抓取状态、`YYYY-MM-DD.json` 每天的条目
- `DAILY.md` — Claude Routine 的旧执行流程
- `CODEX_DAILY.md` — Codex Scheduled Task 更新现有 Sites 的完整流程
- `OPERATIONS.md` — 运行时配置与踩过的坑，代码里看不出来的部分

## 本地跑一遍

    npm ci
    npm test
    npm run fetch
    # 由 Claude 按 DAILY.md 第 2 节写摘要，生成 data/<date>.json
    npm run build
    open dist/index.html

## 增删信源

告诉 Claude「加一个 X」或「把 Y 删了」即可。新增的源需要跑一次
`node scripts/discover-feeds.mjs` 探测 feed 地址。改动次日生效。

## 阅读状态同步

- Codex Sites 版本把已读与标星保存在 D1，按当前 ChatGPT 登录用户隔离，
  会在不同设备之间自动同步。
- 首次打开带云端同步的 Sites 版本时，会把该 Sites 域名下已有的本机状态合并到云端。
  浏览器仍保留缓存；网络中断期间的操作会排队，恢复后自动补传。
- 信源管理页保留「导出已读与收藏」/「导入已读与收藏」作为手动备份。
  导入只做并集合并，不会删掉目标设备上已有的标记。
  导出文件 `ai-radar-state.json` 里标星存条目全文、已读只存 id 列表；
  早先只含标星的旧版备份仍能导入。
- Artifact 与 Sites 属于不同网页域名，浏览器不会让 Sites 直接读取 Artifact
  的 localStorage；旧 Artifact 状态需要先导出，再到 Sites 的信源管理页导入一次。

## 已知限制

- 部分源的 feed 只给标题不给正文，这类条目会标记 `thin` 并在页面显示「⚠ 仅标题」，
  摘要只依据标题撰写。
- 同一篇文章交叉发布在多个站点（如 LessWrong 与 AI Alignment Forum）时会产生重复条目，目前不做跨源去重。
