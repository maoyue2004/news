import { matchTools, SOFT_TERMS, EXPERIENCE_MARKERS, ANTI_MARKERS } from './vocab.mjs';

/**
 * 规则预筛。
 *
 * 职责边界：这里**不**判断「写得好不好、有没有意思」——那要读完正文才知道，交给 LLM。
 * 这里只做两件事：把每天几百条压到几十条，以及保证压缩后的名单**成分健康**。
 *
 * 第二件事是第一版翻的车。第一版只按总分排序取前 60，结果 V2EX 一家占了 31 席：
 * 论坛长帖天然堆满「我」「折腾」「踩坑」这些经验词，分数虚高，
 * 把 TonyBai「我让 AI 帮我做了个浏览器插件」这种正中靶心的博客文挤到了名单外。
 * 所以现在的规则是：先按源配额切一刀，再按分数补齐。
 */

const CJK = /[一-鿿㐀-䶿]/g;

export function cjkRatio(text) {
  const s = String(text ?? '').replace(/\s+/g, '');
  if (!s.length) return 0;
  return (s.match(CJK) ?? []).length / s.length;
}

function hits(text, needles) {
  const lower = String(text ?? '').toLowerCase();
  return needles.filter((n) => lower.includes(n.toLowerCase()));
}

/**
 * 「我 + 动作」是个人折腾最强的语言指纹，比任何单个经验词都准。
 * 「我让 AI 做了个插件」「我把 Claude Code 配置整理成仓库」——
 * 这个句式几乎不会出现在新闻稿和产品软文里。
 */
const FIRST_PERSON_ACTION = /我(?:们)?(?:又|也|终于|花了|用了)?[把让用写做搭配试折玩换踩弄跑改造建]/;

/** 求助帖。有价值的讨论也可能以问号结尾，所以是扣分不是直接毙。 */
const QUESTION = /(求助|求教|请教|求推荐|怎么办|如何解决|有没有人|有大佬|求解|咨询一下)|[?？]\s*$/;

/**
 * 招聘 / 接单帖。V2EX、Ruby China 这类社区里密度很高，
 * 且因为 JD 里必写「AI Agent」而百分百命中工具词，是纯粹的注意力浪费。
 * 薪资数字是最可靠的判据。
 */
const JOB = /(\d+\s*[kK]\s*[-–~]\s*\d+\s*[kK])|(\d+\s*[wW]\s*[-–~]\s*\d+\s*[wW])|(薪资|月薪|年薪|五险一金|双休|base\s|内推|投递简历|远程全职|全职远程|招聘|诚聘|急招|可接|接私活|承接外包|求职|找工作|年经验[｜|])/;

/** 出现在标题里就基本可以断定是卖额度 / 卖账号的黑产帖。 */
const PROMO_HARD = /(拼车|中转|白嫖|代充|合租|车队|上车|开车|共享账号|批发|一键注册|免费领|折起)/;

/**
 * 产品自荐帖。这是论坛源最主要的噪声，且和真折腾长得很像——
 * 两者都在讲「我做了个东西」。区别在于自荐帖的落点是让你去用它，
 * 所以判据不是「有没有做东西」，而是有没有这套招呼语。
 *
 * 只扣分不硬毙：TonyBai 那篇「我开源了 cc-session-migrate」也带 GitHub 链接，
 * 但通篇在讲自己为什么需要它、踩了什么坑，那是好文章。
 */
const SELF_PROMO = /(求个?\s*[Ss]tar|求\s*star|欢迎试用|欢迎体验|欢迎大家|求交流|求反馈|求建议|开发者自荐|送会员|注册免费|免费体验|欢迎来|敬请期待|已上线|新版本发布|上线啦|来压测)/;

/**
 * 论坛帖的正文长度门槛。
 *
 * 博客/周刊/聚合源天生就是文章，长度不用管；论坛和搜索源混着大量三五行的
 * 自荐和提问，实测正文中位数只有 582 / 879 字符，而博客是 2258。
 * 长度在这里是**减分项而不是门槛**——「用 Claude Code 抢注游戏 wiki 站」
 * 只有 529 字符却是当天最好的一篇，硬砍会误杀。
 */
const SHORT_KINDS = new Set(['forum', 'search']);

export const MIN_CJK_RATIO = 0.15;
export const SHORTLIST_THRESHOLD = 6;
/** 单源在入围名单里的席位上限。防止任何一个高产源淹没其他源。 */
export const PER_SOURCE_QUOTA = 8;

/**
 * @returns {{score:number, tools:string[], verdict:'shortlist'|'reject', reasons:string[]}}
 */
export function scoreItem({ title = '', excerpt = '', metrics = null, kind = null } = {}) {
  const body = `${title}\n${excerpt}`;
  const reasons = [];
  const reject = (why) => ({ score: 0, tools: matchTools(body), verdict: 'reject', reasons: [why] });

  const ratio = cjkRatio(body);
  if (ratio < MIN_CJK_RATIO) return reject(`中文占比 ${(ratio * 100).toFixed(0)}%，低于门槛`);
  if (JOB.test(title)) return reject('招聘 / 接单帖');
  if (PROMO_HARD.test(title)) return reject('标题含卖额度 / 卖账号特征');

  const titleTools = matchTools(title);
  const allTools = [...new Set([...titleTools, ...matchTools(excerpt)])];
  const soft = hits(body, SOFT_TERMS);
  if (!allTools.length && !soft.length) return reject('没有命中任何 agent 相关词');

  let score = 0;

  // —— 主题相关性：标题命中工具名是「这篇就是在讲它」，正文命中只是「顺带提到」——
  if (titleTools.length) {
    score += 6 + Math.min(titleTools.length - 1, 2);
    reasons.push(`标题工具：${titleTools.join('/')}`);
  } else if (allTools.length) {
    score += allTools.length >= 2 ? 2 : 1;
    reasons.push(`正文工具：${allTools.slice(0, 3).join('/')}`);
  }
  if (soft.length) {
    score += Math.min(soft.length, 2);
    reasons.push(`泛 agent 词 ${soft.length} 个`);
  }

  // —— 个人折腾味 ——
  if (FIRST_PERSON_ACTION.test(title)) {
    score += 4;
    reasons.push('标题是「我+动作」句式');
  }
  const expTitle = hits(title, EXPERIENCE_MARKERS);
  if (expTitle.length) {
    score += 3;
    reasons.push(`标题经验词「${expTitle[0]}」`);
  }
  const expBody = hits(excerpt, EXPERIENCE_MARKERS);
  if (expBody.length) {
    score += Math.min(expBody.length, 3);
    reasons.push(`正文经验词 ${expBody.length} 个`);
  }

  // —— 扣分 ——
  if (QUESTION.test(title)) {
    score -= 3;
    reasons.push('疑似求助 / 提问帖');
  }
  const promo = hits(body, ANTI_MARKERS.promo);
  const news = hits(body, ANTI_MARKERS.news);
  const academic = hits(body, ANTI_MARKERS.academic);
  if (promo.length) {
    score -= promo.length * 4;
    reasons.push(`营销词 ${promo.length} 个：${promo.slice(0, 3).join('/')}`);
  }
  if (news.length) {
    score -= news.length * 2;
    reasons.push(`新闻腔 ${news.length} 个：${news.slice(0, 3).join('/')}`);
  }
  if (academic.length) {
    score -= academic.length * 2;
    reasons.push(`学术腔 ${academic.length} 个`);
  }

  if (SELF_PROMO.test(`${title}\n${excerpt.slice(0, 400)}`)) {
    score -= 6;
    reasons.push('疑似产品自荐帖');
  }

  // —— 论坛帖的篇幅 ——
  if (SHORT_KINDS.has(kind)) {
    if (excerpt.length < 600) {
      score -= 3;
      reasons.push(`论坛短帖（正文 ${excerpt.length} 字符）`);
    } else if (excerpt.length >= 1800) {
      score += 1;
      reasons.push('论坛长帖');
    }
  }

  // —— 互动量：弱信号，只做微调，不让它左右结论 ——
  if (metrics) {
    if ((metrics.views ?? 0) >= 2000 || (metrics.comments ?? 0) >= 15) {
      score += 1;
      reasons.push('互动量较高');
    }
  }

  const verdict = score >= SHORTLIST_THRESHOLD ? 'shortlist' : 'reject';
  if (verdict === 'reject') reasons.push(`总分 ${score} 低于入围线 ${SHORTLIST_THRESHOLD}`);
  return { score, tools: allTools, verdict, reasons };
}

function slim(item, score, reasons) {
  return { id: item.id, source: item.source, url: item.url, title: item.titleOriginal, score, reasons };
}

/**
 * 打分、分流、按源配额裁剪。
 *
 * 裁剪分两轮：第一轮每个源最多拿 quota 席，保证成分多样；
 * 第二轮把剩余席位按全局分数补齐，避免某天博客源集体没更新时名单凑不满。
 */
export function triage(items, { cap = 60, quota = PER_SOURCE_QUOTA } = {}) {
  const passed = [];
  const rejected = [];

  for (const item of items) {
    const r = scoreItem({ title: item.titleOriginal, excerpt: item.excerpt, metrics: item.metrics, kind: item.kind });
    if (r.verdict === 'shortlist') {
      passed.push({ ...item, preScore: r.score, tools: r.tools, preReasons: r.reasons });
    } else {
      rejected.push(slim(item, r.score, r.reasons));
    }
  }
  passed.sort((a, b) => b.preScore - a.preScore);

  const taken = [];
  const overflow = [];
  const used = new Map();
  for (const item of passed) {
    const n = used.get(item.source) ?? 0;
    if (n >= quota) { overflow.push(item); continue; }
    used.set(item.source, n + 1);
    taken.push(item);
  }
  for (const item of overflow) {
    if (taken.length >= cap) break;
    taken.push(item);
  }

  const shortlist = taken.slice(0, cap);
  const chosen = new Set(shortlist.map((it) => it.id));
  for (const item of passed) {
    if (chosen.has(item.id)) continue;
    rejected.push(slim(item, item.preScore, [...item.preReasons, '超出当日入围上限，未进入人工评审']));
  }
  shortlist.sort((a, b) => b.preScore - a.preScore);
  return { shortlist, rejected };
}
