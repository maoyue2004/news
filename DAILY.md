# 每日流程

云端 scheduled agent 每天北京时间 08:00 照此执行。每一步失败都要在最终汇报里说明，不要静默跳过。

## 1. 抓取

    npm ci --omit=dev
    npm run fetch

产出 `data/_pending.json`。输出会打印新条目数、失败源数，
以及连续失败 7 天以上的源清单。

抓取时会对正文过短的条目自动去抓原文页补全正文；补全失败的条目会被标记 `thin: true`。

## 2. 写中文摘要

读 `data/_pending.json`，为每条写 `titleZh` 与 `summaryZh`，写入 `data/<date>.json`。

- `titleZh`：中文标题，意译不直译。`lang` 为 `zh` 的条目直接沿用 `titleOriginal`。
- `summaryZh`：3-4 句，60-120 字，说清「这篇在讲什么、结论是什么」。写具体内容，不写「本文介绍了……」这类空话。
- **`thin: true` 的条目抓不到正文，只能依据标题写，绝对不许编造内容、数字或结论。**
  页面会给这类条目显示「⚠ 仅标题」徽标，用户知道信息有限；编造会误导用户，比信息少严重得多。
- `type` 为 `podcast` / `video` 的条目，`excerpt` 是官方简介而非内容转写，如实基于简介写，不要假装听过。
- 保留除 `excerpt` 外的全部原字段（含 `thin`）。顶层结构 `{ date, generatedAt, items, errors }`，`errors` 原样复制。
- 条目多时分批处理，每批 20-30 条，避免上下文过载。

若 `_pending.json` 的 `items` 为空（当天没有任何新内容），
仍要写出一个 `items: []` 的当天文件，让日历上出现这一天。

## 3. 构建

    npm run build

产出 `dist/index.html`，内嵌最近 30 天数据。

## 4. 发布

用 Artifact 工具发布 `dist/index.html`：

- `url`: `https://claude.ai/code/artifact/24e0433d-3c33-4e84-8638-0c663708b9c9`
- `favicon`: `🧭`（固定不变）

`url` 必须传，否则会新建一个 artifact 而不是更新原来那个。

**若当前环境没有 Artifact 发布工具**（云端 routine 可能不具备），跳过这一步，
在汇报里明确说明「已构建但未发布，需本地手动发布」，不要假装发布成功。

## 5. 提交

    git add -A
    git commit -m "每日更新：<date>，<N> 条"
    git push

## 6. 汇报

一段话说明：新增多少条、多少个源抓取失败、有没有连续失败 7 天以上的源、
是否成功发布。有连续失败的源要点名，由用户决定修 feed 还是停用。
