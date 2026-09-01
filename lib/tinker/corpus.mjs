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

/**
 * 采样窗口：这个源今天这一批条目，一共覆盖了多少小时。
 *
 * 2026-09-02 补的，和上面那半是同一句话的两种问法：`readableCorpus` 问的是
 * 「拿回来的东西读不读得动」，这里问的是「拿回来的这一批覆盖了多长时间」。
 *
 * LESSONS 里这条已经踩过三次，每次都是靠人手工去量：
 *   - NodeSeek 的 `rss.xml` 只给最新 20 条，而那 20 条跨 21 分钟——
 *     「21 天 20 条、命中 0」看起来是标准的该停用对象，其实是每天只看见 1440 分钟里的 21 分钟；
 *   - iThome 全站 feed 固定 20 条，铁人赛赛季里只跨 327 分钟，解法是接系列子 feed；
 *   - 2026-09-02 量到第三个：`博客园首页` 20 条只跨 12.8 小时，
 *     也就是每天有一半的博客园产出我们结构上看不见——而它是收录量第二高的源。
 *
 * 三次的症状完全一样（「这个源没什么货 / 不写这个主题」），而三次都要先量了才知道。
 * 按「一条每天靠记性重新量的规矩不会收敛」那条，把它交给机器：每轮抓取固定打出来。
 *
 * 判据只用两条，都从踩过的那三次里来：
 *   - `n >= WINDOW_MIN_ITEMS`：条数太少时窗口窄只说明这个源本来就没发几条
 *     （月更博客一轮就 1-2 条新文，跨度当然小），不是「feed 截断了」；
 *     条数顶到十几二十条才像是被 feed 的条数上限切掉的。
 *   - `span < WINDOW_HOURS`：日更管线一天跑一次，覆盖不满 24 小时就必然漏。
 *
 * 注意这里量的是**本轮新拿到的**条目（seen 去重之后），所以它是
 * 「我们今天看见了多长时间」而不是「这个 feed 一共装得下多长时间」——
 * 而前者才是「今天漏了多少」要问的那个量。
 */
export const WINDOW_MIN_ITEMS = 15;
export const WINDOW_HOURS = 24;

/**
 * 按源统计本轮条目覆盖的时间跨度。
 *
 * @param {Array<{source?: string, publishedAt?: string}>} items `_raw.json` 的 items
 * @returns {Array<{source:string,n:number,spanHours:number,narrow:boolean}>}
 */
export function samplingWindows(items = []) {
  const bySource = new Map();
  for (const it of items) {
    const t = Date.parse(it?.publishedAt ?? '');
    if (!Number.isFinite(t)) continue;
    const source = it?.source ?? '(未知源)';
    const row = bySource.get(source) ?? { source, n: 0, min: t, max: t };
    row.n += 1;
    if (t < row.min) row.min = t;
    if (t > row.max) row.max = t;
    bySource.set(source, row);
  }
  return [...bySource.values()]
    .map((r) => {
      const spanHours = (r.max - r.min) / 3600000;
      return { source: r.source, n: r.n, spanHours, narrow: r.n >= WINDOW_MIN_ITEMS && spanHours < WINDOW_HOURS };
    })
    .sort((a, b) => a.spanHours - b.spanHours);
}

/** 把「哪些源我们每天只看得见几小时」写成人能读的话。 */
export function samplingWindowLines(items = []) {
  const narrow = samplingWindows(items).filter((r) => r.narrow);
  if (!narrow.length) return [];
  return [
    '采样窗口偏窄的源（每天抓一次，看不见窗口以外的产出；解法是找窄入口／子 feed，不是等它自己变宽）：',
    ...narrow.map((r) => `  ⏱ ${r.source}：${r.n} 条只跨 ${r.spanHours.toFixed(1)} 小时`),
  ];
}
