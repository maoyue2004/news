# Codex Sites 每日流程

Codex Scheduled Task 每天北京时间 08:00 执行本文件。任务提示词只需要写：

> 读仓库根目录的 CODEX_DAILY.md，严格执行全部步骤。发布阶段显式使用 sites-building 和 sites-hosting，更新现有 Site，绝对不要创建新 Site。

每一步失败都要在最终汇报里说明，不要静默跳过。Claude Routine 与 Codex Scheduled Task
不能同时启用，否则会重复抓取并竞争写入 `seen.json`；启用本任务前先暂停 Claude Routine。

## 0. 预检

1. 必须在仓库主工作区运行，不要使用临时 worktree。
2. `git status --porcelain` 必须为空；若不为空，停止并汇报，不覆盖已有改动。
3. 执行 `git pull --ff-only origin main`，确保基于最新数据。
4. 确认 `.openai/hosting.json` 存在，且 `project_id` 已绑定现有「AI 信源罗盘」Site。

## 1. 抓取与网络故障保护

执行：

    npm ci --omit=dev
    npm run fetch

产出 `data/_pending.json`。输出会打印新增条目数、失败源数，以及连续失败 7 天以上的源。
抓取会对正文过短的条目补抓原文；补全失败的条目标记为 `thin: true`。

若大多数源返回同一种错误，先用 `curl` 检查一个无关站点。确认是环境网络问题时：

- 不写当天日期文件；
- 不提交 `status.json` 的假失败计数；
- 不发布空页面；
- 停止并在汇报中说明网络故障。

## 2. 写中文摘要

读 `data/_pending.json`，为每条写 `titleZh` 与 `summaryZh`，生成 `data/<date>.json`。

- `titleZh`：中文意译；`lang: "zh"` 直接沿用 `titleOriginal`。
- `summaryZh`：3-4 句、60-120 字，具体说明内容与结论，不写「本文介绍了」等空话。
- `thin: true` 只能依据标题或已有简介写，绝不编造内容、数字和结论。
- `podcast` / `video` 的 `excerpt` 是官方简介，不得假装听过或看过。
- 保留除 `excerpt` 外的全部原字段；顶层结构为 `{ date, generatedAt, items, errors }`。
- 每批处理 20-30 条，完成后检查每条必需字段与摘要字数。
- 当天无新增时仍写 `items: []` 的日期文件；只有确认抓取正常时才能这样做。

## 3. 验证与构建

执行：

    npm test
    npm run build

必须同时产出：

- `dist/index.html`
- `dist/server/index.js`

构建失败时不得提交或发布。

## 4. 提交 GitHub

只提交本次每日运行产生的预期变更。提交信息：

    每日更新：<date>，<N> 条

执行 `git push origin main`。若推送失败，停止发布并汇报；否则下一天可能重复收录。

## 5. 发布现有 Codex Site

显式使用 `sites-building` 与 `sites-hosting`：

1. 读取 `.openai/hosting.json` 并复用其中的 `project_id`；绝对不要调用创建新 Site 的流程。
2. 保留现有 D1 绑定 `DB`、已读/收藏云端同步和当前访问范围。
3. 用已经测试并提交的同一份源码保存一个新 Sites 版本。
4. 将该版本部署到现有生产地址。
5. 轮询到部署成功或失败；失败时说明错误，不要声称已发布。

## 6. 汇报

一段话说明：

- 新增条目数；
- 抓取失败源数；
- 连续失败 7 天以上的源（有则点名）；
- 测试与构建是否成功；
- GitHub 是否推送成功；
- Codex Site 是否发布成功及生产链接。
