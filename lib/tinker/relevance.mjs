import { matchVocab, scoringHits, SOFT_TERMS, EXPERIENCE_MARKERS, ANTI_MARKERS } from './vocab.mjs';

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
/*
 * 2026-08-31 周更体检补繁体：`們` / `終於` / `讓`。
 *
 * 查法不是凭想象列简繁对，是把语料里所有「我(们)+X」的下一个字按频次拉出来看
 * （1396 条标题，`我的` 21、`我用` 18、`我把` 7、`我讓` 3、其余各 1-2 条），
 * **唯一够得上数的繁体缺口就是 `讓` 一个**：「我讓 Claude Code 自己跑了五個月」
 * 「我讓 LINE Bot 主動回來提醒」「我讓咖啡足跡回頭影響下一次推薦」，
 * 三条全部是这个句式要找的东西，0 误伤。
 * `們` / `終於` 本轮 0 命中，跟着一起补——理由和 EXPERIENCE_MARKERS 那边一样：
 * 简繁是成对的，留一半在表外就是下一次复发。
 *
 * **这三条今天一个判定都不改**（那 3 条里 1 条本来就 12 分入围，另外 2 条卡在
 * 「没有命中任何 agent 相关词」那道更靠前的闸上）。仍然要改，因为这个句式值 4 分，
 * 而它同时是 `evaluate()` 判「这个博客够不够格」时用的同一把尺——
 * LESSONS 记着「一个候选源够格数低，可能量的是词表不是这个源」，
 * 少收的代价落在选源那一端，而那一端不会有任何报警。
 */
const FIRST_PERSON_ACTION = /我(?:们|們)?(?:又|也|终于|終於|花了|用了)?[把让讓用写做搭配试折玩换踩弄跑改造建]/;

/**
 * 求助帖。有价值的讨论也可能以问号结尾，所以是扣分不是直接毙。
 *
 * 2026-08-31 周更体检顺手补了繁体写法（唯一够得上数的是 `怎麼辦` 2 条）。
 * 同一轮量过但**没有**补繁体的是 `JOB` 和 `PROMO_HARD`：那两条是**硬毙**，
 * 代价不对称（LESSONS 里放宽招聘窗口那次已经写过这个理由），
 * 而它们的繁体缺口都只有 1-4 条、且那批噪声（卖号帖、招聘帖）几乎全在简中论坛，
 * 繁中源（iT 邦 / vocus / 台港博客）本来就不产这两类东西。
 * 漏掉的方向是**少毙**——名单里多一条噪声，比无声毙掉一篇好文便宜得多。
 */
const QUESTION = /(求助|求教|请教|請教|求推荐|求推薦|怎么办|怎麼辦|如何解决|如何解決|有没有人|有沒有人|有大佬|求解|咨询一下|諮詢一下)|[?？]\s*$/;

/**
 * 招聘 / 接单帖。V2EX、Ruby China 这类社区里密度很高，
 * 且因为 JD 里必写「AI Agent」而百分百命中工具词，是纯粹的注意力浪费。
 * 薪资数字是最可靠的判据。
 *
 * 2026-08-24 周更体检把「招…岗位词」那一支的窗口从 4 个字符放宽到 24 个。
 * 起因是 Ruby China 的「[深圳] AI 智能硬件 + App 海外产品，招 Ruby on Rails 工程师」
 * 拿 6 分进了入围名单：`招` 和 `工程师` 之间隔着 15 个字符的技术栈名，
 * 而窗口只有 4 个字符——**这条判据从来不是按语义写的，是按「岗位词紧挨着招」写的，
 * 而中文招聘帖的正常语序是「招 <一串技术栈> <岗位>」**。
 * 放宽前先量过（1173 条原始条目，只看标题，`isJobPost` 本来就只吃标题）：
 * 多命中 4 条，**4 条全是招聘帖、0 误伤**（其中 3 条本来就被 `招聘` 字面命中，
 * 真正改变结论的只有上面那一条）。窗口不敢开得更大是因为 JOB 是**硬毙**，
 * 代价不对称——和下面 `SALARY_LOOSE` 那条注释是同一个理由。
 */
const JOB = /(\d+\s*[kK]\s*[-–~]\s*\d+\s*[kK])|(\d+\s*[wW]\s*[-–~]\s*\d+\s*[wW])|(薪资|月薪|年薪|五险一金|双休|base\s|内推|投递简历|远程全职|全职远程|招聘|诚聘|急招|急聘|直招|热招|诚招|招人|可接|接私活|承接外包|求职|找工作|年经验[｜|])|(招[\s\S]{0,24}?(全栈|前端|后端|客户端|服务端|算法|架构师|工程师|开发者?|运维|测试|产品经理|设计师|实习生?))/;

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
/**
 * JD 的**表单结构**。上面两条判据都只吃标题，而招聘帖的标题不一定招供。
 *
 * 2026-09-03 撞到的：V2EX 那条「AI 工作流工程师/高级 GO/后端---Remote」拿 6 分
 * 占了一个入围席位。逐条对判据：`招` 一个字都没有（所以 `JOB` 那支不命中），
 * 薪资 `25k-38k` 写在**正文**里、标题一个数字都没有（所以 `JOB_ROLE + SALARY_LOOSE`
 * 那支也不命中），而正文是一份齐整的 JD：岗位职责 6 条、任职要求 5 条。
 * 也就是说这条判据漏掉的不是某个词，是**招聘帖可以整个把身份写在正文里**。
 *
 * 这和 08-24 放宽「招…岗位词」窗口那次不是同一个洞：那次是限定词贴太紧
 *（LESSONS「反向规则贴太紧是多收」），这次是**取样口径**——
 * 判据只读标题，而证据在正文，正是「我取的这一段，是不是我以为的那一段」。
 *
 * 判据用 JD 的固定小标题而不是薪资：薪资数字在正常文章里到处都是
 *（「省 5-10K token」「上下文 8-32K」，见下面 SALARY_LOOSE 那段注释），
 * 而「岗位职责」「任职要求」这类四字小标题是招聘表单独有的形状，
 * 和 `MACHINE_REPORT` 那条一样属于**字面即判据**。
 *
 * **要求命中两个不同的小标题**，不是一个。理由是 JOB 属于硬毙、代价不对称：
 * 一篇正经文章顺口提一次「岗位职责」是可能的（讲 AI 会不会取代某个岗位），
 * 但不会同时把「任职要求」也当小标题写下来。
 * 量过（当天 487 条原始条目，正文口径）：命中 1 个的 4 条、命中 ≥2 个的 3 条，
 * **3 条全是招聘帖**（拼多多校招、SillyTavern 招聘、上面那条），已收录条目 0 条误伤。
 * 样本只有一天，所以照老规矩写死一句：**出现第一次误伤就退回去**，
 * 退法是把门槛从 2 个提到 3 个，而不是整条删掉。
 */
const JOB_JD_HEADINGS = [
  /岗位职责|崗位職責/,
  /任职要求|任職要求/,
  /职位描述|職位描述/,
  /岗位要求|崗位要求/,
  /投递简历|投遞履歷|简历投递|履歷投遞/,
  /薪资范围|薪資範圍/,
  /福利待遇/,
];
const JOB_JD_MIN_HEADINGS = 2;
const looksLikeJobDescription = (body) =>
  JOB_JD_HEADINGS.filter((re) => re.test(body)).length >= JOB_JD_MIN_HEADINGS;

const isJobPost = (title, body = '') =>
  JOB.test(title)
  || (JOB_ROLE.test(title) && SALARY_LOOSE.test(title))
  || looksLikeJobDescription(body);

/**
 * 出现在标题里就基本可以断定是卖额度 / 卖账号的黑产帖。
 *
 * `\d+人车` 是 2026-08-10 补的。当天 V2EX 那条「就在刚刚,耗时两小时终于在
 * 埃塞俄比亚时间下午两点四十分搞定了人生第一个 codex 20x 日区(二人车)」拿了 9 分入围，
 * 正文是一份买服务器 → 匿名买礼品卡 → 兑换 apple id → 开 plus 升 20x → 架 sub2api 的
 * 完整教程。原来那组词（拼车 / 合租 / 车队 / 上车 / 开车）覆盖的是动词写法，
 * 而「二人车」「三人车」是**名词**写法，一个都没命中。
 * 数字必须紧贴「人车」两个字，不会撞上正常句子。
 */
const PROMO_HARD = /(拼车|中转|白嫖|代充|合租|车队|上车|开车|\d+\s*人车|[一二两三四五六七八九十]人车|共享账号|批发|一键注册|免费领|折起)/;

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
 *
 * 2026-08-18 第三次补。DeepSeek Harness 发布周，当天 57 个入围席位里 13 席是自荐帖，
 * **这张表一条都没扣到**（13 条的 preReasons 里没有一个「疑似产品自荐帖」）。
 * 逐条看下来漏的是三种，没有一种需要新判据，全是同一套招呼语的写法没写全：
 *
 * 1. **方括号的全角写法。**`\[开源\]` 早就在表里，而 linux.do 的标题写的是「【开源】」。
 *    和 LESSONS 里「每加一个新字形的源，回头把所有中文正则查一遍」是同一个洞，
 *    只是这次换的不是简繁而是半角/全角括号。顺带把 V2EX 的节点名 `[分享创造]` 一起收进来——
 *    那个节点本来就是发自己作品的地方。
 * 2. **「欢迎大家」写成了「欢迎大佬」。**论坛语境里后者比前者常见得多。
 * 3. **征求意见的招呼语整类没有。**「请大家锐评一下」「提提意见」「欢迎拍砖」，
 *    和「求反馈 / 求建议」是同一个意思的论坛说法。
 *
 * 当天 444 条原始条目上量过：新增词命中 7 条，其中 1 条与旧表重叠，**唯一新增 6 条**，
 * 6 条全部是当天评审毙掉的自荐帖或教程稿，**收录的 8 篇一条都没命中**。
 * 照旧只扣 6 分不硬毙——「欢迎拍砖」压在结尾的真折腾文是存在的。
 *
 * 2026-08-20 第四次补，只补了一个词族：**`欢迎 star`**。
 * 表里一直只有「求 star / 求个 star」，而开源自荐帖同样常见的写法是
 * 「MIT 协议开源，欢迎 star、贡献」「觉得有用欢迎 star」。当天 320 条原始条目上量：
 * 命中 2 条（FutureOS 那条 `[开源]` 帖、dsh-web-search-ddg 插件帖），
 * **2 条全是自荐帖、0 误伤，收录的 4 篇一条没命中**。
 * 同一轮里试过但**没要**两个：
 * - `关注我`——命中的是 AlfredZhao 那条正常博文的博客园签名档，
 *   正中 LESSONS「站点级页脚广告不算软文」，加了就是拿站点模板当落点判据；
 * - `免费 token`——只在七牛云那条的**结尾**出现（「新用户 300 万免费 token」），
 *   全量正文 0 命中，样本只有 1 条，不动。下一轮如果结尾判据把它反复量到再说。
 */
const SELF_PROMO = /(求个?\s*[Ss]tar|求\s*star|欢迎\s*[Ss]tar|歡迎\s*[Ss]tar|点个\s*[Ss]tar|點個\s*[Ss]tar|给个\s*[Ss]tar|欢迎试用|欢迎体验|欢迎大家|欢迎大佬|欢迎拍砖|歡迎拍磚|请大家锐评|锐评一下|銳評一下|提提意见|提点意见|提提建議|求交流|求反馈|求建议|开发者自荐|送会员|注册免费|免费体验|欢迎来|敬请期待|已上线|新版本发布|上线啦|来压测|\[分享开源项目\]|[[【](分享创造|分享創造|开源|開源)[\]】]|开源一个|开源了一个|重磅开源|开源发布|開源發布|核心功能有|主要功能有|功能特性[:：]|在线体验[:：]|立即体验|歡迎試用|歡迎體驗|歡迎大家|求回饋|開發者自薦|送會員|註冊免費|免費體驗|歡迎來|敬請期待|新版本發布|上線啦|開源一個|開源了一個|重磅開源|線上體驗[:：]|立即體驗)/;

/**
 * 「AI 賦能師 / 微型創業教練」体。这是繁中写作平台特有的一类营销文，
 * 简中语料里几乎不出现，所以上面那两组词一条都拦不住它。
 *
 * 2026-08-16 量出来的：方格子 vocus 接进来第二天，13 个入围席位里 5 席是这一类，
 * 全部在评审那一步被毙；同一天全量 390 条里这类共 10 条，另外 5 条本来就没过分数线。
 * 它和产品自荐帖不是同一种东西——自荐帖推的是一个能装的东西，
 * 这一类推的是**课程、工作坊和教练服务**，落点是「來上我的課」。
 * 形状极稳定：作者签名带「AI賦能師」，正文讲「我帶的學員 / 一日實戰工作坊」，
 * 结尾是「歡迎按愛心、收藏並分享」，卖点永远是「每天為自己贖回 2 小時」。
 *
 * 判据仍然是落点，不是话题——这类文章确实在讲用 AI 干活，
 * 和 LESSONS 里 TRAE 投稿潮那条一样，「干货是真的」不影响判断。
 *
 * **`一人公司` 试过但没要**：它是个正常的商业概念，当天就误伤了一篇讲电影的稿子。
 * 去掉它之后今天 10 条一条不漏、0 条误伤。
 * 和 SELF_PROMO 一样只扣 6 分不硬毙：真有人一边办工作坊一边写实践文，
 * 扣到线下就够了，不必一票否决。
 */
const COACH_PROMO = /(賦能師|賦能教練|AI\s*賦能|我的學員|帶學員|輔導超過|實戰工作坊|一日工作坊|微型創業|贖回.{0,4}(時間|小時)|歡迎按愛心|按愛心|收藏並分享)/;

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
 * 机器产出的「源码静态分析报告」。
 *
 * 2026-08-31 冒出来的一整类新噪声：掘金上「GitHub每日热评｜X 源码解析」那一批，
 * 署名一律是「Valhalla Matrix治理实验室」，当天一口气吃掉 3 个入围席位，
 * 分数还很高（14 / 10 / 10）——因为它们选题极其对口（Codex 源码、ai-memory、
 * Playwright CLI），工具词和话题词命中密集，正文里全是文件数、测试文件数、
 * crate 划分这类看起来很硬的数字。
 *
 * 它和 LESSONS 里「AI 编造的伪深度文」不是同一种东西：那一类是把错的说得像实测，
 * 靠核对可验证的机制事实才认得出；这一类**数字大多是真的**，问题在于
 * 没有任何人动手——它自己在开头和结尾写得清清楚楚：
 * 「本文基于 openai/codex 的指定源码快照进行静态分析」
 * 「本文未执行 Codex 源码、测试、构建、依赖漏洞扫描或生产环境部署」
 * 「本文结论类型：源码静态观察」。
 *
 * 也就是说这条判据不用去猜落点，它是**自述**的：一篇明说「我没有运行过」的稿子，
 * 按定义就不是「作者自己动手做了什么」。这是这个项目少见的、字面即判据的情形，
 * 所以敢做成规则；反过来也意味着它一旦改口播模板就会失效，
 * 和「推广稿会脱掉容易认的外衣」是同一条——真正的闸仍然在评审那一步。
 *
 * 量过再加（LESSONS：唯一命中数 + 误伤）：`tinker-retriage --probe` 在当天
 * 347 条语料上三个口径分别命中 3 / 2 / 3 条，逐条看完全部是这一类，
 * 而拿创刊以来的日文件对了一遍，**已收录条目 0 条误伤**。
 *
 * 扣 6 分不硬毙，和 SELF_PROMO 同一档：万一哪天真有人先老老实实读完源码、
 * 再补一句「本文未执行构建」的免责，单篇分数够高时仍然进得来。
 */
const MACHINE_REPORT = /(本文未执行|本文基于[^。]{0,40}(源码|原始碼)快照|本文结论类型|未执行项目构建|静态(扫描|观察)得到)/;

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
 * 抓不到正文（`thin: true`）的条目在名单里的占比上限。
 *
 * 这条**不是**说 thin 的东西质量差——thin 是补全被限流的结果，是「怎么抓」不是
 * 「抓到什么」，按它扣分就重蹈 FORUM_SHARE 和 V2EX 首帖那两脚。所以分数一分不动，
 * 动的是**席位分配**：入围名单是评审预算，而 thin 条目在评审那一步只能看标题，
 * 编辑规则又明写「绝对不许编造」「拿不准就不收」，一个席位换回一条收录的概率极低。
 *
 * 创刊以来的实测账（8 天，按当天 `_pending.json` 的 thin 标记对当天日文件）：
 *   thin 席位 54 → 收录 2（3.7%），且那 2 条都是编辑手动重抓正文之后才收的；
 *   非 thin 席位 148 → 收录 31（21%）。
 * 一个 thin 席位的期望产出只有普通席位的六分之一，却吃掉同样的评审预算。
 * 极端的日子代价很直观：8-05 是 34 席里 16 席 thin，8-08 是 37 席里 18 席，
 * 今天（8-10）是 22 席里 13 席——掘金一波 TRAE Work 投稿全部补全失败，
 * 名单里六成条目是打不开的标题。
 *
 * 不设成 0 的理由和 summaryPage 那条正相反：thin 是**偶发**而不是结构性的，
 * 8-05 那两条收录（MCP 插件接入实战、Kimi Code CLI 替代 Claude Code）在 thin
 * 内部分数排第 1 和第 2——按分数留前几席，这类「标题实在够硬、值得手动补一次正文」
 * 的条目一条都不会丢。
 */
export const THIN_SHARE = 0.25;
/** 全天供给都是 thin 的那天，仍留几席让编辑有得挑（8-05 的两条收录就在前 2）。 */
export const THIN_FLOOR = 3;

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
 * 聚合站自己生成的 AI 摘要页，整源不可能入选。
 *
 * 和「这个源最近没货」是两回事：BestBlogs.dev 的条目落地页是
 * `bestblogs.dev/article/<id>`，页面本身就是站方生成的摘要而不是作者原文。
 * 收它等于把读者送到二手摘要页，而 `summaryZh` 的每一句也只能来自那份摘要，
 * 踩在「转载而无本人补充」上——这条是**页面性质**判的，跟内容好坏无关，
 * 所以再好的条目也过不了评审。数据也是这么走的：创刊 7 天，
 * 它天天有 2-3 条进入围名单，**收录累计 0 条**。
 *
 * 但不停用这个源，因为它的落选条目仍然有用：它告诉我们该去接哪个**原文源**
 * （今天那条 AGENTS.md 上下文工程的原文在腾讯技术工程，8-04 那条 Agent Memory
 * 实测的原文在 Datawhale）。所以标 `summaryPage: true` 的源照抓、照打分、
 * 照进 `rejected` 留痕，只是不再占用评审名单的席位。
 *
 * 留存标准写着「连续 30 天零入选才清理」，那条是保护月更博主的——
 * 它保护的是「今天没货但明天可能有」的源，而这里是「结构上永远不会有」。
 */
const isSummaryPage = (item) => item.summaryPage === true;

/**
 * @returns {{score:number, tools:string[], verdict:'shortlist'|'reject', reasons:string[]}}
 */
export function scoreItem({ title = '', excerpt = '', tail = '', metrics = null, thread = false } = {}) {
  const body = `${title}\n${excerpt}`;
  const reasons = [];
  const all = matchVocab(body);
  const reject = (why) => ({ score: 0, tools: all.tools, topics: all.topics, verdict: 'reject', reasons: [why] });

  const ratio = cjkRatio(body);
  if (ratio < MIN_CJK_RATIO) return reject(`中文占比 ${(ratio * 100).toFixed(0)}%，低于门槛`);
  // 正文那一支要连 tail 一起给：JD 的「任职要求」常压在最后，而 excerpt 截在 2500 字符。
  if (isJobPost(title, `${excerpt}\n${tail}`)) return reject('招聘 / 接单帖');
  if (PROMO_HARD.test(title)) return reject('标题含卖额度 / 卖账号特征');

  // 打分时工具和话题等价：标题里出现 MCP 和出现 Cursor 一样说明这篇在讲 agent。
  // `scoringHits` 滤掉只用来打标签的词条（`score: false`，目前只有 `rag`）。
  // `all.tools` / `all.topics` 本身一个都不滤——那两个是给页面标签用的，
  // 而「标签要加、分不要给」正是那个字段存在的理由。
  const inTitle = matchVocab(title);
  const titleHits = scoringHits([...inTitle.tools, ...inTitle.topics]);
  const allHits = scoringHits([...all.tools, ...all.topics]);
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
  } else if (SELF_PROMO.test(tail || excerpt.slice(-400))) {
    // 手册里的判据是「落点在哪」，而落点字面上就是结尾——
    // 「古法编程做了个剪映」那篇通篇像折腾文，招呼语（来体验 / GitHub 求 Star）全压在最后一段，
    // 只看开头 400 字符完全扣不到它。
    // 但结尾比标题和开头弱：不少真折腾文也会在末尾挂一句「代码在 GitHub，欢迎 star」，
    // 那是顺手补充而不是全文目的。所以只扣一半，让它降权而不是出局。
    //
    // **2026-08-20：这条规则此前从来没有量到过长文的结尾。** `excerpt` 截在 2500 字符，
    // 当天 36 个入围条目里 22 条（61%）被截断，对它们来说 `excerpt.slice(-400)` 取的是
    // 正文的腰。抓取层现在把真正的结尾单独带回来（`tail`，见 lib/enrich.mjs），
    // 有就用它，没有（正文没被截断）才退回 `excerpt` 自己的尾巴。
    // 和「论坛帖篇幅量的是整页而不是首帖」是同一个形状：判据合理，输入却由「怎么抓」决定。
    score -= 3;
    reasons.push('结尾落在推广语上');
  }

  if (COACH_PROMO.test(body)) {
    score -= 6;
    reasons.push('疑似课程 / 教练营销文');
  }

  if (MACHINE_REPORT.test(body) || MACHINE_REPORT.test(tail || '')) {
    score -= 6;
    reasons.push('自述未运行过的源码静态分析报告');
  }

  if (SERIAL_TITLE.test(title)) {
    // 2026-08-13：`Day N` 在 iT 邦幫忙不是作者选的形状，是铁人赛**要求**的格式——
    // 8-9 月赛季里那个平台上所有连载都长这样，包括真折腾。也就是说这一条对
    // iT 邦幫忙来说量的是「怎么发」而不是「写了什么」，和 FORUM_SHARE 按 kind 判、
    // 论坛篇幅量整页是同一族错。
    // 但**直接减轻罚分是错的**，这次拿数据验过：把 2026 铁人赛 claude-ai /
    // chatgpt-and-codex / vibe-coding 三个组共 30 个系列、191 篇拉下来重放，
    // 罚 4 分时 3 篇够格，罚 1 分时 18 篇——多出来的 15 篇全部是教学连载
    // （「認識 ChatGPT 與 Codex：AI 開發新搭檔」「什麼是Vibe Coding？」
    // 「打造AI開發環境 Cursor / VS Code + AI插件最佳設定」）。
    // 在这个平台上「Day N」确实和教程强相关，原来那条判断没错。
    // 能分开两者的不是罚分大小，是**正文经验词密度**：那 15 篇是 1-3 个，
    // 而被误杀的那篇「Day 13：我的 AI 沒有資料庫全 Markdown 架構的瘋狂與合理」
    // （SOUL.md / AGENTS.md / MEMORY.md 全档案化，作者跑了半年）是 4 个。
    // 所以只在正文经验词 ≥4 时把罚分减半。同一份 191 篇样本上重放：
    // **够格数仍然是 3，一篇教学连载都没多进来**，而误杀那篇 5 → 7 进了名单。
    score -= expBody.length >= 4 ? 2 : 4;
    reasons.push(expBody.length >= 4 ? '连载章节体标题（正文够实，减半）' : '连载章节体标题');
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

/**
 * `gated` 区分「这条我们判过了」和「这条我们没排上队」。
 *
 * 落选分两种，长得一样但含义完全相反：一种是**内容判断**——分数不够、
 * 命中反向词、是摘要页、是转帖，明天再来一次结论还是一样；另一种是**名额判断**
 * ——单源配额满了、名单满了、thin 名额满了，跟这一条本身是什么毫无关系，
 * 换一天供给结构不同它就进来了。
 *
 * 之所以要把这件事标出来，是因为 `seen.json` 把两者记成同一件事：
 * 凡是写进 `_pending` 的都记 seen，于是被名额挡掉的条目**再也不会被抓第二次**。
 * 2026-08-23 量到这个代价：当天名单只有 29 条（cap 60，空着 31 席），
 * 而 19 条掘金条目（分数 6-10）被 `quota * QUOTA_RELAX` 那道单源闸挡下并永久出局。
 * 席位空着不要钱，永久丢掉一条却是不可逆的。
 *
 * 形状和 LESSONS 里那条账本判据是同一个：**一份「记下来省得下次再做」的账，
 * 写之前先问一句「这一条记的是结论，还是记的是一次没排上队」。**
 */
function slim(item, score, reasons, gated = false) {
  const out = { id: item.id, source: item.source, url: item.url, title: item.titleOriginal, score, reasons };
  if (gated) {
    out.gated = true;
    // `gate` 是给机器读的那一份「是哪道闸挡的」，`reasons` 那句中文是给人读的。
    // 两者必须一起改，否则会再犯 2026-08-22 那一脚（理由字符串把配额说成了 cap）。
    out.gate = typeof gated === 'string' ? gated : 'unknown';
  }
  return out;
}

/**
 * 标题归一化，只为「这两条是不是同一篇」这一个用途服务。
 *
 * 去掉所有非字母数字和非 CJK 的字符（空格、全半角标点、破折号都算），
 * 英文转小写。博客园那种在标题末尾挂「 - 作者名」的写法保留在结果里——
 * 这条判据要的是**严格同题**，宁可漏也不要误判。
 */
export function titleKey(title) {
  return String(title ?? '')
    .toLowerCase()
    .replace(/[^0-9a-z一-鿿㐀-䶿]+/g, '');
}

/**
 * 一组严格同题的条目里，哪一条值得留下。
 *
 * 顺序是有讲究的：`thin` 排在分数前面，因为一条打不开正文的条目
 * 就算分数高一分，留下来也只是一个标题（thin 席位创刊以来的兑现率是普通席位的六分之一）。
 */
function betterCopy(a, b) {
  if ((a.thin === true) !== (b.thin === true)) return b.thin === true;
  if (a.preScore !== b.preScore) return a.preScore > b.preScore;
  return String(a.publishedAt ?? '') > String(b.publishedAt ?? '');
}

/**
 * 打分、分流、按源配额裁剪。
 *
 * 裁剪分两轮：第一轮每个源最多拿 quota 席，保证成分多样；
 * 第二轮把剩余席位按全局分数补齐，避免某天博客源集体没更新时名单凑不满。
 *
 * `publishedTitles` 是已收录条目的标题集合（`titleKey()` 之后）。
 * `seen.json` 按 id/url 去重，挡不住**同一篇文章从另一个源再来一次**：
 * 2026-08-19 实测到的例子是 kuhung 的《如何最大化 Claude Code Session 的价值》——
 * 08-18 从 V2EX 的转帖收过一次，当天他的个人博客刚接进 sources.json，
 * 同一篇又以 kuhung.me 的 URL 占了一个入围席位。
 * 「接一个作者的个人站」和「已经从平台收过他的转帖」是必然同时发生的两件事
 * （第五条扩源通道本来就是从收录条目的作者反查出站点的），所以这不是偶发。
 */
export function triage(items, { cap = 60, quota = PER_SOURCE_QUOTA, forumShare = FORUM_SHARE, thinShare = THIN_SHARE, publishedTitles = new Set() } = {}) {
  let passed = [];
  const rejected = [];

  for (const item of items) {
    const r = scoreItem({ title: item.titleOriginal, excerpt: item.excerpt, tail: item.tail ?? '', metrics: item.metrics, thread: isThread(item) });
    if (isSummaryPage(item)) {
      // 照常打分再毙，分数留在 rejected 里——高分的那几条正是该去接原文源的线索。
      rejected.push(slim(item, r.score, [...r.reasons, '聚合站 AI 摘要页，按编辑规则整类不收']));
    } else if (publishedTitles.has(titleKey(item.titleOriginal))) {
      // 严格同题 = 同一篇的转帖。评审席位是这个项目最稀缺的东西，
      // 让一篇已经出过刊的文章换个 URL 再占一席是纯浪费。
      rejected.push(slim(item, r.score, [...r.reasons, '与已收录条目严格同题，判为同一篇的转帖']));
    } else if (r.verdict === 'shortlist') {
      passed.push({ ...item, preScore: r.score, tools: r.tools, topics: r.topics, preReasons: r.preReasons ?? r.reasons });
    } else {
      rejected.push(slim(item, r.score, r.reasons));
    }
  }
  passed.sort((a, b) => b.preScore - a.preScore);

  // 本轮之内的严格同题，也是同一篇，只留一条。
  //
  // 上面那道 `publishedTitles` 挡的是「已经出过刊的那篇换个 URL 又来一次」，
  // 挡不住**同一轮里**同一篇占掉好几个席位。2026-08-29 量的账：
  // 474 条原始条目里有 7 组严格同题、多吃 11 个席位，最大一组是掘金作者
  // 「好的999」把《5.28文章改写：用 Claude Code 接入 GLM-5.1》发了 6 遍，
  // 其中 4 条进了当日 43 席的入围名单——评审预算的 9% 花在同一篇上。
  //
  // 判据故意和 `publishedTitles` 一字不差：**只比严格同题，不比作者**。
  // 那 7 组里有 2 组的 author 一边有值一边是空串（《HelloGitHub》第 125 期
  // 同时从 V2EX 和 HelloGitHub 自己的 feed 进来，码哥字节那篇同时来自
  // 掘金和 SegmentFault），要求同作者恰好会漏掉最该挡的跨源转帖。
  // 这不是「机械去重」那条死路——那条说的是同题材的不同文章分不开
  // （见 LESSONS「筛选规则」），而同一篇的标题逐字相同，用不着相似度。
  // 误伤量过：创刊以来 175 条已收录条目里严格同题 0 组。
  //
  // 留哪一条：先要能读的（thin 的留下来等于留了个打不开的标题），
  // 再要分高的，最后要新的。落选的照常记 seen——「这条 URL 是另一篇的副本」
  // 是对这条内容的结论，不是「今天没排上队」，明天再判还是同一个答案。
  const bestByTitle = new Map();
  for (const item of passed) {
    const key = titleKey(item.titleOriginal);
    if (!key) continue;
    const prev = bestByTitle.get(key);
    if (!prev || betterCopy(item, prev)) bestByTitle.set(key, item);
  }
  const dupes = new Set(passed.filter((it) => {
    const key = titleKey(it.titleOriginal);
    return key && bestByTitle.get(key) !== it;
  }).map((it) => it.id));
  if (dupes.size) {
    for (const item of passed) {
      if (!dupes.has(item.id)) continue;
      rejected.push(slim(item, item.preScore, [...item.preReasons, '与本轮另一条严格同题，判为同一篇，只留最好的一条']));
    }
    passed = passed.filter((it) => !dupes.has(it.id));
  }

  // 抓不到正文的条目先按名额切一刀，再进配额分配。
  //
  // 放在配额之前是有意的：thin 条目占着席位不产出，把它们腾走之后，
  // 原本被单源配额挤出去的**能读的**条目才补得进来。
  // 名额按「能读的条目有多少」算，和 FORUM_SHARE 的 budget 用同一个公式。
  const thinPassed = passed.filter((it) => it.thin === true);
  const readable = passed.length - thinPassed.length;
  const thinLimit = Math.max(THIN_FLOOR, Math.round((readable * thinShare) / (1 - thinShare)));
  if (thinPassed.length > thinLimit) {
    const dropped = new Set(thinPassed.slice(thinLimit).map((it) => it.id));
    for (const item of passed) {
      if (!dropped.has(item.id)) continue;
      rejected.push(slim(item, item.preScore, [...item.preReasons, '抓不到正文的条目已达当日名额，未进入人工评审'], 'thin'));
    }
    passed = passed.filter((it) => !dropped.has(it.id));
  }

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

  /**
   * 落选理由要分清是「名单满了」还是「你这个源的配额满了」。
   *
   * 2026-08-22 踩的：当天 22 条掘金条目（最高 9 分）全部记成
   * 「超出当日入围上限」，而名单只有 49 条、cap 是 60——**名单根本没满**，
   * 挡住它们的是 `quota * QUOTA_RELAX` 这道单源闸。
   * 照字面读这条理由，下次会去调 cap，而该看的是配额。
   * 和「分布过于整齐时先怀疑管道」是同一类：诊断字符串本身也是数据，
   * 它错了，后面基于它的判断就全错。
   */
  const seats = new Map();
  for (const it of shortlist) seats.set(it.source, (seats.get(it.source) ?? 0) + 1);
  for (const item of passed) {
    if (chosen.has(item.id)) continue;
    const used = seats.get(item.source) ?? 0;
    let why; let gate;
    if (used >= quota * QUOTA_RELAX) {
      why = `单源配额已满（${item.source} 占 ${used} 席），未进入人工评审`;
      gate = 'quota';
    } else if (isForum(item)) {
      why = '论坛/搜索源已达当日占比上限，未进入人工评审';
      gate = 'forum-share';
    } else {
      why = '超出当日入围上限，未进入人工评审';
      gate = 'cap';
    }
    rejected.push(slim(item, item.preScore, [...item.preReasons, why], gate));
  }
  return { shortlist, rejected };
}
