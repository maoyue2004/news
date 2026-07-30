# 运维手册

这份文档记录**从代码里看不出来的**运行时配置和踩过的坑。
接手这个项目时先读它，能省掉重新踩一遍的时间。

## 线上资产

| 项 | 值 |
|---|---|
| 页面（Codex Sites） | `https://ai-news-reader-maoyue.yue14mao.chatgpt.site` |
| 页面（Artifact） | `https://claude.ai/code/artifact/24e0433d-3c33-4e84-8638-0c663708b9c9` |
| 仓库 | `https://github.com/maoyue2004/news` — **公开** |
| 云端定时任务 ID | `trig_0197JM4tvDtBQvjTX3NqHZko` |
| 云端环境 ID | `env_01E8jVJc8nP9Qx6s1TxW9VQJ`（名称「AI 信源罗盘 · 抓取」） |
| 运行时间 | 每天 08:00 GMT+8（cron `0 0 * * *` UTC） |

管理界面：<https://claude.ai/code/routines>

## 四条必须遵守的配置约束

这四条都是踩过坑之后固化下来的，改动前先想清楚。

### 1. 发布时必须传 `url` 参数

用 Artifact 工具发布 `dist/index.html` 时，**必须**传
`url: "https://claude.ai/code/artifact/24e0433d-3c33-4e84-8638-0c663708b9c9"`。

漏传会**新建一个 artifact** 而不是更新原来那个，用户收藏的链接直接作废。
`favicon` 固定 `🧭`，跨次发布不要改（用户靠图标在标签页里找它）。
`capabilities` 参数不要传——省略会自动沿用已存储的声明（当前是 `downloads`）。

### 2. 云端环境的 Network access 必须是 `Full`

默认的 `Trusted` 级别只放行 npm 这类**已验证软件源**，任意 RSS 域名一律 403。

症状极具迷惑性：56 个源**全部**返回 HTTP 403，看起来像所有信源同时挂了。
判断方法：`curl www.google.com`，如果也返回 `CONNECT tunnel failed, response 403`，
就是环境网络策略问题，不是信源问题。

不用 `Custom` 白名单的理由：正文补全会去抓文章原文页，这些页面常在 CDN 或跳转到别的域名，
白名单会让补全静默退化——而正文补全是把「仅标题」条目占比从 38% 压到 16% 的关键。

### 3. `allowed_tools` 必须包含 `Artifact`

否则运行到发布那步会卡在权限弹窗上，定时任务无人值守就永远停在那里。
当前值：`["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Artifact"]`

### 4. 仓库写权限来自 Claude GitHub App

`https://github.com/apps/claude` 已安装并授权到本仓库。

注意：**仓库公开只解决「读」（clone），push 需要写凭据**。
只把仓库改公开而不装 App，会出现「能 clone、能抓取、能发布，但 push 403」的半通状态。
后果不只是当天数据丢失——`seen.json` 不更新，第二天会把今天的内容当新的**重复收一遍**。

## 抓取失败时怎么判断

`data/status.json` 记录每个源的 `consecutiveFailures`。

- **孤立失败**（个别源 403/超时）：正常，站点偶发问题，不用管
- **大面积失败**（多数源同一种错误）：先按上面第 2 条判断是不是环境网络问题。
  **如果是环境问题，不要提交 `status.json` 的失败计数**，否则会把假失败计入
  「连续失败 7 天」的判断，污染后续排查；**也不要写空的日期文件**——
  「今天没有新内容」和「今天根本没能检查」是两回事，写空文件是失实的
- **连续失败 ≥7 天**：在汇报里点名，由用户决定修 feed 还是停用

## 已经调查过、不要重复走的死路

### 跨设备同步已读/标星

Codex Sites 版本已使用 D1 保存 `reader_state`，主键是
`(user_email, item_id)`。用户身份只信任 Sites 转发的
`oai-authenticated-user-email` 请求头，浏览器传入的身份字段一律不用。
页面首次成功连接时把同一 Sites 域名下的旧 localStorage 状态合并进 D1，之后以服务端状态为准；
离线变更暂存在 `airadar.pending-sync.v1`，恢复网络后补传。

Artifact 仍受 CSP 与无服务端存储限制，只能使用本机 localStorage 和手动导出/导入；
它不会与 Sites 版本自动同步，迁移旧状态需要在 Artifact 导出、再到 Sites 导入一次。

### 回溯历史内容：收益不足以支撑改动

实测全部 56 个源在 30 天窗口内共 344 条，扣掉已收录的只剩约 **87 条**，且分布极不均：
前 10 个源占 185 条，**27 个源 ≤3 条、其中 11 个是 0 条**（Chip Huyen、Eugene Yan、
Neel Nanda、The Gradient、Distill.pub、Yannic Kilcher 等长期停更或 feed 只留最新几条）。

要做的话需要改三处：`MAX_AGE_DAYS` 14→30、**按 `publishedAt` 归日而非按抓取日期**、
`fetch.mjs` 支持一次写多个日文件。第二处是数据管线里最核心的日期归属逻辑，动它有风险。

结论：不划算。再运行两周日历自然填满，且每天是完整的 200+ 条，比稀疏的回溯数据好得多。

## 仓库是公开的

- 里面没有任何密钥或凭据（转公开前扫描确认过）
- 提交历史里的作者邮箱已全部重写为 `19606151+maoyue2004@users.noreply.github.com`，
  本地 `user.email` 也已设成同一个，不要改回真实邮箱
- **如果将来要把用户的已读/标星状态存进这个仓库，注意那会公开他的阅读记录**，
  届时应当单独放一个私有仓库

## 常用操作

```bash
# 手动触发一次云端运行（也可在 claude.ai/code/routines 点 Run now）
# 通过 RemoteTrigger 工具：action=run, trigger_id=trig_0197JM4tvDtBQvjTX3NqHZko

npm test                        # 134 个测试
npm run fetch                   # 抓取，产出 data/_pending.json
npm run build                   # 构建 dist/index.html
node scripts/discover-feeds.mjs # 新增信源后探测 feed 地址（会重写 sources.json）
node scripts/audit-feeds.mjs    # 体检各源的条目数、新鲜度、有正文占比
```
