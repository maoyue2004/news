# Agent 折腾志

每天从中文互联网里筛出 **Code / Work Agent 的个人折腾经验文章**，写中文摘要和推荐理由，
发布到 <https://ai-news-reader-maoyue.yue14mao.chatgpt.site/tinker>。

和同仓库的「AI 信源罗盘」是两个独立系统：罗盘要的是**覆盖度**（AI 领域每天发生了什么），
折腾志要的是**筛选力**（谁真的动手用了 agent，写了什么值得抄的东西）。
两者共用 `lib/` 里的 feed 解析、HTML 转文本、URL 指纹和存储层，其余互不相干。

## 为什么不是又一个 RSS 阅读器

要收的这类文章有两个特点，决定了架构：

1. **散**。它们躺在几百个月更的个人博客里，一个博客十篇里可能只有一篇聊 agent。
   光靠订阅 feed 覆盖不到主题的长尾。
2. **脏**。平台上带「Claude Code」关键词的内容里，绝大多数是新闻、产品自荐、
   卖额度的软文和求助帖。光靠关键词搜索会被噪声淹没。

所以管线是**宽采集 + 硬筛选**：

```
feed 源（个人博客/周刊/论坛）┐
                            ├→ 去重 → 补全正文 → 规则预筛 → LLM 评审 → 日文件 → 页面
搜索源（按词捞平台全站）    ┘        445 条         42 条      29 条
```

规则预筛（`lib/tinker/relevance.mjs`）**不判断好坏**，只负责把几百条压到几十条且不误杀；
「写得好不好、是不是真动过手」由 LLM 读完正文判断。两层职责严格分开。

## 结构

- `sources.json` — 信源，**唯一真相源**。分 `feed` 型和 `search` 型两类
- `candidates.txt` — 待探测的候选站点，探测通过的手动并进 sources.json
- `data/` — `seen.json` 去重、`status.json` 各源健康度、`query-yield.json` 每个查询词的累计产出、
  `YYYY-MM-DD.json` 每天收录的条目
- `REVIEW.md` — 每日复盘。**接手前先读它**，里面记着试过什么、判断错过什么
- `../TINKER_DAILY.md` — 云端 routine 的完整执行流程

代码在仓库根目录下：

- `scripts/tinker-fetch.mjs` — 抓取、去重、补全、规则预筛 → `data/_pending.json`
- `scripts/tinker-retriage.mjs` — 用 `data/_raw.json` 离线重放筛选规则，改规则时用它对比
- `scripts/tinker-build.mjs` — 构建 `dist/tinker.html`，构建期校验字段
- `scripts/tinker-probe.mjs` — 探测候选站点的 feed 地址
- `scripts/tinker-harvest.mjs` — 从社区索引（OPML / CSV / Markdown 名录）批量筛博客
- `scripts/tinker-blogroll.mjs` — 从**已收录博客的友链页**发现新博客，判据复用 harvest 的评分器
- `scripts/tinker-cnblogs.mjs` — 从**已收录条目的博客园作者**反查他的子 feed（同一个平台里更窄的入口）
- `lib/tinker/vocab.mjs` — 工具名、经验词、反向词、搜索查询库。**最该被反复修改的文件**
- `lib/tinker/relevance.mjs` — 规则打分与按源配额裁剪
- `lib/tinker/search-adapters.mjs` — 掘金 / V2EX(sov2ex) / Discourse 的搜索接入
- `templates/tinker/` — 页面的 CSS 与浏览器端 JS，构建时内联

## 本地跑一遍

    npm ci
    npm test
    npm run tinker:fetch                        # 产出 tinker/data/_pending.json
    # 由 Claude 按 TINKER_DAILY.md 第 2 节评审，写 tinker/data/<date>.json
    npm run tinker:build
    open dist/tinker.html

调规则时不要重新抓取（两分半钟，还会写脏 seen）：

    node scripts/tinker-retriage.mjs            # 重放筛选，看入围名单
    node scripts/tinker-retriage.mjs --rejected # 看被毙的高分条目，查误杀
    node scripts/tinker-retriage.mjs --write    # 把重筛结果写回 _pending.json

上面三条都吃 `data/_raw.json`，而它**不进 git**（体积大、每天变）。
所以在一个新克隆的仓库里（周更体检每次都是）它不存在，得先造一份：

    TINKER_DRYRUN=1 node scripts/tinker-fetch.mjs

dry-run 忽略 `seen`（否则日更刚跑完，重放只剩零条；忽略之后拿到的是完整
21 天窗口），且**不写** seen / status / _pending——不会吃掉云端日更那轮的原料。
它只产出 `_raw.json`。

## 增删信源

改 `tinker/sources.json`。新增前先探测：

    node scripts/tinker-probe.mjs https://某站点.com
    node scripts/tinker-probe.mjs --file tinker/candidates.txt

两条**发现**通道（都要人工过一遍命中列表再并入，否决当场写进 `denylist.json`）：

    node scripts/tinker-harvest.mjs --index <id>        # 社区索引，六个已扫完，边际产出趋零
                                                        # （但词表大改之后重扫会有新命中，见 LESSONS）
    node scripts/tinker-blogroll.mjs --evaluate \
      --min-links 2 --cache /tmp/blogroll.json          # 已收录博客的友链页
    node scripts/tinker-blogroll.mjs --seed-match <正则> # 只拿匹配的已收录博客当种子，用来换个圈子试

第三条（2026-09-07 脚本化）问的是**同一个平台里更窄的入口**，不是站外：

    node scripts/tinker-cnblogs.mjs                     # 已收录的博客园作者 → 他的 /rss 子 feed
    node scripts/tinker-cnblogs.mjs --days 30           # 只看最近 N 天日文件里出现过的作者

理由是 `博客园首页` 那份全站 feed 固定 20 条、只跨 12.8 小时——它是收录量第二高的源，
而这些作者每天有一半的产出结构上进不来。同样**不提供 `--merge`**：
2026-09-07 那轮 9 个够格的里人工留 4 个，而**分数最高的两个（11/20）正是该扫掉的**。

`--cache` 把「爬友链页」那十几分钟的结果存下来，之后调 `--min-links` 不用重爬。

探测器会报出 feed 地址、条目数、最新文章距今多少天、有正文的占比。
**最新文章超过 365 天的不要加**——那是死站。

`search` 型源不需要 feed，需要 `search` 字段指定适配器（`juejin` / `v2ex` / `discourse`），
Discourse 还要 `origin`。

## 已知限制

- **linux.do 在 Cloudflare 后面**，云端抓取大概率 403。它是中文 agent 折腾密度最高的论坛，
  目前只有 `latest.rss` 在浏览器 UA 下偶尔能通，属预期内失败
- **微信公众号完全没覆盖**。中文 agent 实践有相当大一部分在公众号里，还没找到可靠通路
- **知乎、小红书没覆盖**，都需要登录态
- 掘金搜索每天只跑 12 个查询词（词库 50 条，四天多轮一遍），避免打爆接口
- Codex Sites 版本把已读/收藏保存在 D1，按当前 ChatGPT 登录用户隔离并跨设备同步；
  本机仍保留缓存，网络恢复后会补传未同步的操作
- 首次连接云端时会自动合并同一 Codex Site 域名下已有的本机状态
- 原 Artifact 与 Codex Site 域名不同，浏览器不会自动迁移旧 Artifact 的已读/收藏状态
