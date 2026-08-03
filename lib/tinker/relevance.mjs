import { matchVocab, SOFT_TERMS, EXPERIENCE_MARKERS, ANTI_MARKERS } from './vocab.mjs';

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
const JOB = /(\d+\s*[kK]\s*[-–~]\s*\d+\s*[kK])|(\d+\s*[wW]\s*[-–~]\s*\d+\s*[wW])|(薪资|月薪|年薪|五险一金|双休|base\s|内推|投递简历|远程全职|全职远程|招聘|诚聘|急招|急聘|直招|热招|诚招|招人|可接|接私活|承接外包|求职|找工作|年经验[｜|])|(招[\s\S]{0,4}?(全栈|前端|后端|客户端|服务端|算法|架构师|工程师|开发者?|运维|测试|产品经理|设计师|实习生?))/;

/**
 * 岗位词 + 单边薪资数字。两个都出现才算，单独一个都不算。
 *
 * 2026-08-03 的 rejected 里有两条招聘帖各拿到 5 分，离入围线只差 1 分：
 * 「远程资深后端工程师 / 后端技术专家（Go+ PHP / AI 效能方向）30-60K」
 * 和「联想 天津 直招 急聘 又来了」。前者暴露的是薪资正则的形状问题——
 * 它要求 `20K-40K` 两边都带单位，而中文招聘帖里 `30-60K` 这种只在末尾标单位的写法同样常见。
 *
 * 但**不能**直接把左边的 K 改成可选。JOB 是硬毙，代价不对称：
 * 放宽之后「省 5-10K token」「上下文 8-32K」这类正常标题会被无声毙掉，
 * 而这恰恰是这个项目最想收的那类文章。所以松的薪资形状必须和岗位词同时出现才生效。
 * （后者「直招 急聘」整条标题里一个岗位词都没有，靠上面那组词命中，不走这条。）
 */
const JOB_ROLE = /(全栈|前端|后端|客户端|服务端|算法|架构师|工程师|技术专家|开发者|运维|测试|产品经理|设计师|实习生)/;
const SALARY_LOOSE = /\d+\s*[-–~]\s*\d+\s*[kKwW](?![a-zA-Z])/;
const isJobPost = (title) => JOB.test(title) || (JOB_ROLE.test(title) && SALARY_LOOSE.test(title));

/** 出现在标题里就基本可以断定是卖额度 / 卖账号的黑产帖。 */
const PROMO_HARD = /(拼车|中转|白嫖|代充|合租|车队|上车|开车|共享账号|批发|一键注册|免费领|折起)/;

/**
 * 产品自荐帖。这是论坛源最主要的噪声，且和真折腾长得很像——
 * 两者都在讲「我做了个东西」。区别在于自荐帖的落点是让你去用它，
 * 所以判据不是「有没有做东西」，而是有没有这套招呼语。
 *
 * 只扣分不硬毙：TonyBai 那篇「我开源了 cc-session-migrate」也带 GitHub 链接，
 * 但通篇在讲自己为什么需要它、踩了什么坑，那是好文章。
 *
 * 2026-08-02 补了两组。当天 9 条入围里 4 条是自荐，一条都没被这里扣到，
 * 说明原来那套招呼语（求 Star / 欢迎试用）只覆盖了自荐帖的**结尾**。
 * 补的是开头和中段的形状：标题的开源发布语，和正文里那张功能清单——
 * 「核心功能有：1. …2. …」是自荐帖最稳定的骨架，真折腾文不会这么写。
 * 仍然只扣 6 分不硬毙，理由同上。
 */
const SELF_PROMO = /(求个?\s*[Ss]tar|求\s*star|欢迎试用|欢迎体验|欢迎大家|求交流|求反馈|求建议|开发者自荐|送会员|注册免费|免费体验|欢迎来|敬请期待|已上线|新版本发布|上线啦|来压测|\[分享开源项目\]|\[开源\]|开源一个|开源了一个|重磅开源|核心功能有|主要功能有|功能特性[:：]|在线体验[:：]|立即体验)/;

/**
 * 连载章节体标题。
 *
 * 2026-08-03 的名单被两套连载灌满：SegmentFault 上一套《OpenCode 源码详解》
 * 系列教程一天占了 19 席里的 5 席（第1章 / 第9章 / 第26章 / 第27章 / 总目录），
 * iT 邦幫忙的铁人赛又贡献了 Day1 / Day2 / Day 03 ×3。收录 0 条。
 *
 * 这一类和内容农场不一样，机械去重更分不开它——每一章讲的确实是不同的东西。
 * 但「第 N 章」这个形状本身就说明了落点：它是照着目录把一个主题铺完，
 * 而不是记录某次具体的折腾。前者的原料是文档（那套 OpenCode 连载自己写着
 * 「内容核实自 opencode.ai/docs 及 DeepWiki」），后者的原料是作者自己踩的坑。
 *
 * 只扣分不硬毙，理由和自荐帖那条一样：万一有人真的把一次长折腾拆成连载，
 * 单章分数够高时仍然进得来。扣 4 分足以把今天这 5 条全部压到入围线下。
 * 只认标题**开头**的编号，避免「用 Claude Code 重写第 3 章」这种正常句子中招。
 */
const SERIAL_TITLE = /(^\s*第\s*\d+\s*[章篇讲课]|^\s*[Dd][Aa][Yy]\s*\d+|系列教程|系列文章第)/;

/**
 * 论坛帖的正文长度门槛。
 *
 * 博客/周刊/聚合源天生就是文章，长度不用管；论坛和搜索源混着大量三五行的
 * 自荐和提问，实测正文中位数只有 582 / 879 字符，而博客是 2258。
 * 长度在这里是**减分项而不是门槛**——「用 Claude Code 抢注游戏 wiki 站」
 * 只有 529 字符却是当天最好的一篇，硬砍会误杀。
 */
const isThread = (item) => item.thread === true;

export const MIN_CJK_RATIO = 0.15;
export const SHORTLIST_THRESHOLD = 6;
/** 单源在入围名单里的席位上限。防止任何一个高产源淹没其他源。 */
export const PER_SOURCE_QUOTA = 8;
/**
 * 补位轮的配额放宽倍数。
 *
 * 名单凑不满时允许高产源多拿几席，但不是无限——2026-08-04 补位轮完全不看配额，
 * 掘金搜索一家拿走 45/60 席，当天 8 成名单是同一个内容农场的横评稿。
 */
export const QUOTA_RELAX = 2;

/**
 * 论坛/搜索源在名单里的占比上限。
 *
 * 按源配额只防「单个源」淹没名单，防不住「一类源」淹没名单——
 * V2EX 搜索、V2EX 技术节点、linux.do、NodeSeek 各拿 8 席就是 32 席，
 * 每个源都守规矩，合起来仍然把名单变成了论坛版。
 *
 * 更根本的是：论坛条目占多少，不该由「当天博客更没更新」来决定。
 * 博客月更，某天集体安静是常态，那天名单就会全是论坛帖——
 * 这正是用户看到的「V2EX 质量太差」。
 * 所以改成按比例封顶，让文章型源始终是主体。
 */
export const FORUM_SHARE = 0.4;
/** 但也不能一刀切死：博客确实全静的那天，论坛仍应能凑出一个能看的名单。 */
export const FORUM_FLOOR = 6;

/**
 * 只有信源上明确标了 `thread: true` 的才受占比约束。
 *
 * 原来是按 `kind in {forum, search}` 判的，那是把「怎么抓」当成了「抓到什么」——
 * 掘金搜索和 V2EX 搜索的 kind 都是 search，但前者返回文章、后者返回论坛帖。
 * 2026-08-02 实测这个误判很贵：当轮 7 条入围、**21 条被占比上限挡掉**，
 * 挡掉的全是 SegmentFault 的文章，其中包括「Hermes 多 Agent 完整拆解」
 * 这种一眼就该收的。规则本身没错（论坛碎片确实该压），错在划错了范围。
 *
 * 未知来源按文章处理——占比上限是用来压制**已知**噪声源的，
 * 不该顺手压掉一个只是元数据没写全的条目。
 */
const isForum = (item) => item.thread === true;

/**
 * @returns {{score:number, tools:string[], verdict:'shortlist'|'reject', reasons:string[]}}
 */
export function scoreItem({ title = '', excerpt = '', metrics = null, thread = false } = {}) {
  const body = `${title}\n${excerpt}`;
  const reasons = [];
  const all = matchVocab(body);
  const reject = (why) => ({ score: 0, tools: all.tools, topics: all.topics, verdict: 'reject', reasons: [why] });

  const ratio = cjkRatio(body);
  if (ratio < MIN_CJK_RATIO) return reject(`中文占比 ${(ratio * 100).toFixed(0)}%，低于门槛`);
  if (isJobPost(title)) return reject('招聘 / 接单帖');
  if (PROMO_HARD.test(title)) return reject('标题含卖额度 / 卖账号特征');

  // 打分时工具和话题等价：标题里出现 MCP 和出现 Cursor 一样说明这篇在讲 agent。
  const inTitle = matchVocab(title);
  const titleHits = [...inTitle.tools, ...inTitle.topics];
  const allHits = [...all.tools, ...all.topics];
  const soft = hits(body, SOFT_TERMS);
  if (!allHits.length && !soft.length) return reject('没有命中任何 agent 相关词');

  let score = 0;

  // —— 主题相关性：标题命中工具名是「这篇就是在讲它」，正文命中只是「顺带提到」——
  if (titleHits.length) {
    score += 6 + Math.min(titleHits.length - 1, 2);
    reasons.push(`标题命中：${titleHits.join('/')}`);
  } else if (allHits.length) {
    score += allHits.length >= 2 ? 2 : 1;
    reasons.push(`正文命中：${allHits.slice(0, 3).join('/')}`);
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
  } else if (SELF_PROMO.test(excerpt.slice(-400))) {
    // 手册里的判据是「落点在哪」，而落点字面上就是结尾——
    // 「古法编程做了个剪映」那篇通篇像折腾文，招呼语（来体验 / GitHub 求 Star）全压在最后一段，
    // 只看开头 400 字符完全扣不到它。
    // 但结尾比标题和开头弱：不少真折腾文也会在末尾挂一句「代码在 GitHub，欢迎 star」，
    // 那是顺手补充而不是全文目的。所以只扣一半，让它降权而不是出局。
    score -= 3;
    reasons.push('结尾落在推广语上');
  }

  if (SERIAL_TITLE.test(title)) {
    score -= 4;
    reasons.push('连载章节体标题');
  }

  // —— 论坛帖的篇幅 ——
  if (thread) {
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
  return { score, tools: all.tools, topics: all.topics, verdict, reasons };
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
export function triage(items, { cap = 60, quota = PER_SOURCE_QUOTA, forumShare = FORUM_SHARE } = {}) {
  const passed = [];
  const rejected = [];

  for (const item of items) {
    const r = scoreItem({ title: item.titleOriginal, excerpt: item.excerpt, metrics: item.metrics, thread: isThread(item) });
    if (r.verdict === 'shortlist') {
      passed.push({ ...item, preScore: r.score, tools: r.tools, topics: r.topics, preReasons: r.preReasons ?? r.reasons });
    } else {
      rejected.push(slim(item, r.score, r.reasons));
    }
  }
  passed.sort((a, b) => b.preScore - a.preScore);

  /**
   * 按源配额取，超配额的留到补位轮。
   *
   * 补位轮**不能无视配额**，否则 quota 形同虚设：2026-08-04 掘金搜索
   * 一家在 60 席里拿了 45 席（配额是 8），因为补位轮不再看 used。
   * 补位放宽到 `quota * QUOTA_RELAX` 席，既能在博客集体没更新的那天把名单凑满，
   * 又不至于让一个源整个吃下名单。
   */
  function byQuota(list, limit) {
    const taken = [];
    const overflow = [];
    const used = new Map();
    const take = (item) => { used.set(item.source, (used.get(item.source) ?? 0) + 1); taken.push(item); };
    for (const item of list) {
      if (taken.length >= limit) { overflow.push(item); continue; }
      if ((used.get(item.source) ?? 0) >= quota) { overflow.push(item); continue; }
      take(item);
    }
    for (const item of overflow) {
      if (taken.length >= limit) break;
      if ((used.get(item.source) ?? 0) >= quota * QUOTA_RELAX) continue;
      take(item);
    }
    return taken;
  }

  const articles = passed.filter((it) => !isForum(it));
  const forums = passed.filter(isForum);

  // 论坛席位要先**预留**出来，再让文章填。
  //
  // 原来是反的：文章先按 cap 取满，论坛拿 `cap - takenArticles.length`。
  // 文章型源一旦自己就够 60 条，这个差恒为 0，论坛一席都拿不到——
  // 于是 FORUM_SHARE 在「文章供给充足」的那些天里等于没写。
  // 而且它是断崖式的：59 条文章时论坛能拿 39 席，60 条时直接归零。
  // 2026-08-04 的代价是当天分数最高的一条（V2EX「四个从翻车里长出来的
  // Claude Code skill」，16 分）被判「已达占比上限」，而占满名单的
  // 是掘金上一批「X 平替方案有哪些」的同选题横评农场文。
  //
  // 预留额先按 cap 估，再用**实际取到的文章数**收紧（s/(1-s)，和原来同一个公式）——
  // 后半步保住原有意图：博客集体安静的那天，论坛不该反过来变成名单主体。
  const reserve = Math.min(forums.length, Math.max(FORUM_FLOOR, Math.round(cap * forumShare)));
  const takenArticles = byQuota(articles, cap - reserve);
  const budget = Math.max(FORUM_FLOOR, Math.min(reserve, Math.round((takenArticles.length * forumShare) / (1 - forumShare))));
  const takenForums = byQuota(forums, Math.min(budget, cap - takenArticles.length));

  const shortlist = [...takenArticles, ...takenForums].sort((a, b) => b.preScore - a.preScore).slice(0, cap);
  const chosen = new Set(shortlist.map((it) => it.id));
  for (const item of passed) {
    if (chosen.has(item.id)) continue;
    const why = isForum(item) ? '论坛/搜索源已达当日占比上限，未进入人工评审' : '超出当日入围上限，未进入人工评审';
    rejected.push(slim(item, item.preScore, [...item.preReasons, why]));
  }
  return { shortlist, rejected };
}
