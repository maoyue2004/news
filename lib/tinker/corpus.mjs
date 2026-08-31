/**
 * 语料可读性：一条读正文的规则，今天到底有多少条语料能给它读。
 *
 * 2026-09-01 补的。起因是昨天给 `MACHINE_REPORT` 留的那条待办——
 * 「看它明天挡到几条；如果连着几天 0 命中，说明对方换了模板」。
 * 今天它 0 命中，而这个 0 读不出任何东西：它是照着掘金那批
 * 「GitHub每日热评｜X 源码解析」的正文免责声明写的，而掘金今天补全熔断，
 * **121 条里 76 条是 thin（63%）**，那批稿子的正文根本没进过语料。
 * 「模板换了」和「今天没读到正文」在 `命中 0 / 406` 这个数字上长得一模一样。
 *
 * 这是 LESSONS 那条「整源失败的分母必须换成实际发出的条数」的第四次复发，
 * 前三次分别错在限流截断的分母、seen 账本的「没排上队」、
 * 以及 thin 名额在熔断轮的轮次计数——每一次都是**分母里混进了根本没参与的那部分**。
 * 差别只在这次分母属于一条诊断输出，而诊断输出正是用来下结论的地方。
 *
 * 所以量一条正文规则时，报的分母必须是**可读语料**，
 * 并且把「哪个源今天大面积读不到正文」一起摆出来——
 * 规则通常是照着某一个源的模板写的，那个源哑了，这条规则今天就没有考场。
 */

/** 大面积读不到正文的判定：条数够多，且 thin 占了一半以上。 */
export const MUTED_THIN_SHARE = 0.5;
export const MUTED_MIN_ITEMS = 10;

/**
 * 按源统计 thin 占比，并标出今天「哑掉」的源。
 *
 * @param {Array<{source?: string, thin?: boolean}>} items `_raw.json` 的 items
 * @returns {{total:number, readable:number, thin:number,
 *            bySource:Array<{source:string,n:number,thin:number,readable:number,muted:boolean}>,
 *            muted:Array<string>}}
 */
export function readableCorpus(items = []) {
  const bySource = new Map();
  let thin = 0;
  for (const it of items) {
    const source = it?.source ?? '(未知源)';
    const row = bySource.get(source) ?? { source, n: 0, thin: 0, readable: 0, muted: false };
    row.n += 1;
    if (it?.thin) { row.thin += 1; thin += 1; } else { row.readable += 1; }
    bySource.set(source, row);
  }
  for (const row of bySource.values()) {
    row.muted = row.n >= MUTED_MIN_ITEMS && row.thin / row.n >= MUTED_THIN_SHARE;
  }
  const rows = [...bySource.values()].sort((a, b) => b.thin - a.thin || b.n - a.n);
  return {
    total: items.length,
    thin,
    readable: items.length - thin,
    bySource: rows,
    muted: rows.filter((r) => r.muted).map((r) => r.source),
  };
}

/** 把「今天有多少语料可读、哪些源哑了」写成一行行人能读的话。 */
export function readabilityLines(items = []) {
  const c = readableCorpus(items);
  const lines = [`可读正文 ${c.readable} / ${c.total} 条（thin ${c.thin} 条只有标题）`];
  for (const r of c.bySource.filter((x) => x.muted)) {
    lines.push(`  ⚠ ${r.source}：${r.n} 条里 ${r.thin} 条没读到正文`
      + `（${Math.round((r.thin / r.n) * 100)}%），照着这个源的模板写的规则今天没有考场`);
  }
  return lines;
}
