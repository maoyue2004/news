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
 * @returns {{ seenIds: string[], deferred: object, promoted: Array<{id, gates}> }}
 *   `seenIds` 要写进 seen；`deferred` 是新的待定账本；
 *   `promoted` 是这一轮从待定转成结论的（攒满轮次），带着它被哪几道闸挡过，只为汇报用。
 */
export function planSeen({ ids, gatedIds, deferred = {}, today, rounds = DEFER_ROUNDS }) {
  const seenIds = [];
  const next = {};
  const promoted = [];
  const gateOf = (id) => (gatedIds instanceof Map ? gatedIds.get(id) : undefined);
  const isGated = (id) => (gatedIds instanceof Map ? gatedIds.has(id) : gatedIds.has(id));

  for (const id of ids) {
    if (!isGated(id)) {
      // 内容判断——这是结论
      seenIds.push(id);
      continue;
    }
    const prev = deferred[id];
    const attempts = (prev?.attempts ?? 0) + 1;
    const gate = gateOf(id);
    const gates = { ...(prev?.gates ?? {}) };
    if (gate) gates[gate] = (gates[gate] ?? 0) + 1;
    if (attempts >= rounds) {
      seenIds.push(id);
      promoted.push({ id, gates });
      continue;
    }
    const rec = { first: prev?.first ?? today, attempts };
    if (Object.keys(gates).length) { rec.gates = gates; rec.last = gate ?? prev?.last; }
    next[id] = rec;
  }

  /*
   * 这一轮没再出现的待定条目：源没再返回它（搜索源的查询词是轮转的，
   * 隔几天才转回来），所以不能当成「排不上队」就地判死，留着等它回来。
   * 但也不能永远留——超过抓取窗口还没回来的，它已经不可能再被抓到了，清掉。
   */
  const cutoff = dayOf(today) - DEFER_TTL_DAYS * 86400000;
  for (const [id, rec] of Object.entries(deferred)) {
    if (next[id] || seenIds.includes(id)) continue;
    if (dayOf(rec.first) >= cutoff) next[id] = rec;
  }

  return { seenIds, deferred: next, promoted };
}
