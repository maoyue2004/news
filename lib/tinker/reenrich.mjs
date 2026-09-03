/**
 * 错时补全：给「本轮被补全熔断的源」在一个**更晚的时刻**再要一次正文。
 *
 * 为什么要单开这一步（2026-09-04 定的，此前在 REVIEW 里被顺延了四轮）：
 * `enrich()` 的两轮都在同一次运行里，中间只隔 `ENRICH_RETRY_DELAY_MS`（60 秒）。
 * 对掘金这种「返回 2397 字节限流页」的源，这 60 秒仍然落在同一个限流窗口内——
 * 09-01 起连续四天 100% 熔断、第二轮救回 0 条，就是这个形状。
 * 而 LESSONS 那条「限流类故障的恢复是概率性的」说的是**跨小时**的概率，
 * 不是跨一分钟的：09-04 当场量过，同一篇文章连发 20 次全是 2397 字节，
 * 而更早的一次单发拿到了完整的 89KB 页面。
 * 也就是说这个源的正文**不是取不到，是取不到在那一分钟**。
 *
 * 所以这一步不改抓取管线里的任何判据（thin 仍然是「怎么抓」不是「抓到什么」，
 * 不扣分、不记 seen），只是把「再要一次」这个动作挪到几十分钟以后，
 * 并且照旧走 `enrich()` 自己的探针熔断——限流没过去就仍然只花 40 个请求。
 *
 * 这里只放两个纯函数，网络那一半在 `scripts/tinker-reenrich.mjs`。
 */

/** 低于这个长度算「没读到正文」，和 `scripts/tinker-fetch.mjs` 保持同一个数。 */
export const THIN_THRESHOLD = 250;

/**
 * 挑出这一轮要重新补全的条目。
 *
 * 默认只挑**当轮被熔断的那些源**的 thin 条目：熔断是抓取层已经算出来的事实
 * （`stats.enrichMuted`），不是猜的。挑别的源没有意义——它们的 thin 是
 * 「这一篇确实没有正文」（登录墙、纯标题帖），换个时间要还是没有。
 *
 * `limit` 是请求预算的上限。不设的话，一个 100 多条的源在限流没过去时
 * 会把探针窗口之外的请求也发出去——虽然 `enrich()` 的熔断会挡住，
 * 但预算这件事要在调用方这一侧就写清楚。
 *
 * **预算要先花在入围名单上**（`priorityIds`）。2026-09-04 第一次跑就踩了：
 * 按 `_raw.json` 的顺序取前 60 条，60 个请求全花在「被名额挡下」的条目上，
 * 而入围名单里那 6 条 thin 一条都没轮到——救回来的 40 条里只有 1 条在名单里。
 * 名单里的 thin 条目是**今天就要评审**的，被名额挡下的那些本来就不记 seen、明天还会回来，
 * 两者的时效性差一整天。
 */
export function selectTargets({ items, sources, limit = 80, threshold = THIN_THRESHOLD, priorityIds = [] }) {
  const want = new Set(sources);
  const first = new Set(priorityIds);
  const all = items
    .filter((it) => want.has(it.source))
    .filter((it) => (it.excerpt?.length ?? 0) < threshold);
  return [...all.filter((it) => first.has(it.id)), ...all.filter((it) => !first.has(it.id))]
    .slice(0, limit);
}

/**
 * 把救回来的正文合并回入围名单。
 *
 * 按 `id` 对齐，只覆盖 `excerpt` / `tail` / `thin` 三个字段——分数、落选理由、
 * 席位这些是抓取那一轮的账，错时补全不该改写它们。
 * （真要因为正文变了重新打分，那是 `tinker-retriage` 的活，而重新打分会动
 * 名额分配，等于把当天的席位账重算一遍，不是这一步该干的事。）
 *
 * 返回被更新的 id 列表，调用方拿它报账。
 */
export function mergeIntoShortlist(shortlist, items, threshold = THIN_THRESHOLD) {
  const byId = new Map(items.map((it) => [it.id, it]));
  const updated = [];
  for (const row of shortlist) {
    const fresh = byId.get(row.id);
    if (!fresh) continue;
    if ((fresh.excerpt?.length ?? 0) < threshold) continue;
    if ((fresh.excerpt?.length ?? 0) <= (row.excerpt?.length ?? 0)) continue;
    row.excerpt = fresh.excerpt;
    if (fresh.tail) row.tail = fresh.tail; else delete row.tail;
    row.thin = false;
    updated.push(row.id);
  }
  return updated;
}
