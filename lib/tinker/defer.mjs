/**
 * 「没排上队」的条目怎么记账。
 *
 * `seen.json` 的用途是「这条别再抓第二遍」，而抓取层对**每一条**写进 `_pending`
 * 的条目都记 seen——包括被规则毙掉的（否则每天把同一批噪声重抓一遍、重扣一遍分，
 * 这一半是对的）。问题出在另一半：被**名额**挡掉的条目也一起记了。
 *
 * 两者含义完全相反。分数不够、命中反向词、是摘要页、是转帖——这些是对这一条内容
 * 下的结论，明天再判一次还是同一个答案，记 seen 是对的。而「单源配额已满」
 * 「超出当日入围上限」「thin 名额已满」跟这一条是什么毫无关系，它说的是
 * **当天供给结构**：换一天别的源有货，同一条就进来了。把它记成 seen，
 * 等于拿一次排队结果给一条内容判了永久死刑，而且这个错误再也没有机会自我纠正。
 *
 * 2026-08-23 量到的代价：当天入围名单只有 29 条（cap 60，**空着 31 席**），
 * 而 19 条掘金条目（分数 6-10，含「7 万星仓库教的安装路径是错的——整理 130 个
 * AI Skill 的踩坑记录」「AI 写了一个月代码，人类只提交 13 次」）被
 * `quota * QUOTA_RELAX` 那道单源闸挡下，并就此永久出局。前一天同样如此（22 条）。
 * 席位空着不要钱，永久丢掉一条却是不可逆的。
 *
 * 但也不能无限期地放它们回来：一条天天被挡的条目会天天占一次抓取和打分的成本，
 * 而且「永远重来」和「永远不再来」是同一个病的两端（LESSONS：一份不再重查的账
 * 至少要三态——结论、待定、失败，只有两态时一定有一类事实被塞进了错误的那一格）。
 * 所以这里是三态：
 *
 *   结论  → 内容判断落选，或已经攒够 `DEFER_ROUNDS` 轮仍没排上队 → 记 seen，不再抓
 *   待定  → 这一轮被名额挡掉，攒 `attempts`                      → 不记 seen，下轮再来
 *   （第三态「没抓成」由抓取层的重试负责，不到这里）
 *
 * 轮数设 3 而不是 1 或 10：1 等于没缓冲，10 会让一个长期高产源的尾巴天天回炉。
 * 三轮之内供给结构基本会换一次（周末博客更新节奏和工作日不同），换不过来就是
 * 这条真的排不上，认了。
 *
 * 2026-08-26 补的一层：账本要记**是哪道闸**挡的。
 * 「攒够 3 轮」这个计数原来不分闸门，于是被单源配额挡两次、被 thin 名额挡一次，
 * 和被同一道闸连挡三次，落进账本是同一个 `attempts: 3`。判死的阈值不需要因此改
 * （三天里供给结构确实换过了，它仍然没排上，认了这一条没错）——**要改的是诊断**：
 * 不记闸门，就没法回答「这批永久出局的条目主要死在哪道闸上」，
 * 而这正是下一次该调 cap 还是该调 `PER_SOURCE_QUOTA` 的唯一依据。
 * 形状和 LESSONS 那条一样：落选理由本身也是数据，它糊了，后面基于它的判断就全糊。
 *
 * 2026-08-27 补的第三层，也是同一个问题再深一级：**「thin 名额已满」这一条，
 * 在源被补全熔断的那一轮里，记的既不是结论也不是排队结果，是一次失败。**
 *
 * 上面那段把落选分成两类——「对这条内容的结论」和「当天的供给结构」——
 * 然后说后者攒够 3 轮就认了。对单源配额和入围上限，这个说法成立：
 * 名单里挤不下是真的挤不下，三天供给结构换过一次还是挤不下，那就是它排不上。
 * 但 thin 不一样。LESSONS 早就写死了「不能给 thin 扣分——thin 是补全被限流的结果，
 * 是『怎么抓』不是『抓到什么』」，而 thin **名额**的计数也一样：
 * 一条掘金条目今天 thin，是因为掘金今天在限流、`enrichPass()` 探针窗口零产出、
 * 剩下的请求根本没发出去——**我们从来没读到过它**。
 *
 * 2026-08-27 的账：当轮 59 条被名额挡下，52 条是 thin，**其中 47 条是掘金**，
 * 而掘金当轮正是被熔断的那个源（探针 40 发 0 中，两轮合计跳过 56 个请求，
 * 第二轮 103 条救回 0）。被挡下的里面有「7 万星仓库教的安装路径是错的——
 * 整理 130 个 AI Skill 的踩坑记录」（10 分）、「Hermes 模型路由崩溃实录」（8 分）
 * 这种正对选题的条目。掘金要是连限三天，它们会在**一次都没被读到**的情况下永久出局，
 * 而账本上写的会是「攒满 3 轮没排上队」——一句完全说不出真相的话。
 *
 * 所以 thin 落选要再分一次：
 *
 *   排队  → 这一轮源是给货的，它自己没排上 thin 名额 → 照常攒 attempts
 *   失败  → 这一轮这个源整个被熔断，压根没读到它     → **不攒**，只记一次 stall
 *
 * 判据用的是抓取层已经算出来的事实（`enrichMuted`），不是猜的。
 * 兜底是 TTL：stall 只在 `DEFER_TTL_DAYS` 之内保护它，过了这个窗口照常计数——
 * 否则一个永远在限流的源会把它的尾巴永远挂在账本里，
 * 那就从「永远不再来」翻到了「永远重来」，是同一个病的另一端。
 */

/** 攒够几轮仍没排上队就落成结论。 */
export const DEFER_ROUNDS = 3;

/** 待定条目在账本里最多留多久；超过就当它已经从抓取窗口里滑出去了。 */
export const DEFER_TTL_DAYS = 21;

const dayOf = (s) => Date.parse(`${s}T00:00:00Z`);

/**
 * 决定这一轮哪些条目记 seen、哪些留在待定账本里。
 *
 * 纯函数，不碰文件——这样「哪一条该被永久判死」这个决定是可测的。
 *
 * @param {object}   opts
 * @param {string[]} opts.ids       这一轮写进 `_pending` 的全部条目 id
 * @param {Set|Map}  opts.gatedIds  其中被名额挡掉的。传 Map 时值是闸门名
 *   （`quota` / `forum-share` / `cap` / `thin`），会逐闸记进账本；传 Set 仍然可用，
 *   只是记不出是哪道闸。
 * @param {object}   opts.deferred  上一轮的待定账本
 *   `{ id: { first, attempts, gates?: { quota: 2, thin: 1 }, last? } }`
 * @param {string}   opts.today     `YYYY-MM-DD`
 * @param {number}   [opts.rounds]  攒够几轮落成结论
 * @param {Function} [opts.sourceOf] `id => 源名`。只有配合 `mutedSources` 才有用。
 * @param {Set}      [opts.mutedSources] 这一轮被补全熔断的源名。落在这些源上的
 *   **thin** 名额落选不算一轮（我们根本没读到它），只记一次 `stalls`。
 * @returns {{ seenIds: string[], deferred: object, promoted: Array<{id, gates}>, stalled: string[] }}
 *   `seenIds` 要写进 seen；`deferred` 是新的待定账本；
 *   `promoted` 是这一轮从待定转成结论的（攒满轮次），带着它被哪几道闸挡过，只为汇报用；
 *   `stalled` 是这一轮因为源被熔断而没有计数的。
 */
export function planSeen({
  ids, gatedIds, deferred = {}, today, rounds = DEFER_ROUNDS,
  sourceOf = () => undefined, mutedSources = new Set(),
} = {}) {
  const seenIds = [];
  const next = {};
  const promoted = [];
  const stalled = [];
  const gateOf = (id) => (gatedIds instanceof Map ? gatedIds.get(id) : undefined);
  const isGated = (id) => (gatedIds instanceof Map ? gatedIds.has(id) : gatedIds.has(id));
  const cutoff = dayOf(today) - DEFER_TTL_DAYS * 86400000;

  for (const id of ids) {
    if (!isGated(id)) {
      // 内容判断——这是结论
      seenIds.push(id);
      continue;
    }
    const prev = deferred[id];
    const gate = gateOf(id);
    const gates = { ...(prev?.gates ?? {}) };
    if (gate) gates[gate] = (gates[gate] ?? 0) + 1;

    /*
     * 这一轮这个源整个被补全熔断 → 它 thin 不是因为它排不上队，是因为没人读过它。
     * 不计一轮。TTL 之外不再保护，否则一个长期限流的源会把尾巴永远挂在账本上。
     */
    const stalling = gate === 'thin'
      && mutedSources.has(sourceOf(id))
      && dayOf(prev?.first ?? today) >= cutoff;
    if (stalling) {
      const rec = { first: prev?.first ?? today, attempts: prev?.attempts ?? 0, stalls: (prev?.stalls ?? 0) + 1 };
      rec.gates = gates;
      rec.last = gate;
      next[id] = rec;
      stalled.push(id);
      continue;
    }

    const attempts = (prev?.attempts ?? 0) + 1;
    if (attempts >= rounds) {
      seenIds.push(id);
      promoted.push(prev?.stalls ? { id, gates, stalls: prev.stalls } : { id, gates });
      continue;
    }
    const rec = { first: prev?.first ?? today, attempts };
    if (prev?.stalls) rec.stalls = prev.stalls;
    if (Object.keys(gates).length) { rec.gates = gates; rec.last = gate ?? prev?.last; }
    next[id] = rec;
  }

  /*
   * 这一轮没再出现的待定条目：源没再返回它（搜索源的查询词是轮转的，
   * 隔几天才转回来），所以不能当成「排不上队」就地判死，留着等它回来。
   * 但也不能永远留——超过抓取窗口还没回来的，它已经不可能再被抓到了，清掉。
   */
  for (const [id, rec] of Object.entries(deferred)) {
    if (next[id] || seenIds.includes(id)) continue;
    if (dayOf(rec.first) >= cutoff) next[id] = rec;
  }

  return { seenIds, deferred: next, promoted, stalled };
}
