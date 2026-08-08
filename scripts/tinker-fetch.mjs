#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { extractArticleText } from '../lib/enrich.mjs';
import {
  loadSeen, saveSeen, loadStatus, saveStatus, recordSuccess, recordFailure,
  loadQueryYield, saveQueryYield, recordQueryYield,
} from '../lib/store.mjs';
import { collectFeed, collectRaw } from '../lib/tinker/collect.mjs';
import { fetchSearchItems, isSearchSource } from '../lib/tinker/search-adapters.mjs';
import { triage } from '../lib/tinker/relevance.mjs';
import { queriesForDate } from '../lib/tinker/vocab.mjs';
import { UA, BROWSER_UA } from '../lib/tinker/probe.mjs';

const SOURCES = 'tinker/sources.json';
const DATA_DIR = 'tinker/data';
const TIMEOUT_MS = 20000;
const CONCURRENCY = Number(process.env.TINKER_CONCURRENCY ?? 10);
const ENRICH_CONCURRENCY = 5;
/** 补全第二轮开始前的等待。见 `enrich()` 的注释：限流窗口没过就重试等于白跑。 */
const ENRICH_RETRY_DELAY_MS = Number(process.env.TINKER_ENRICH_RETRY_DELAY_MS ?? 60000);
/** 抓取第二轮开始前的等待。见 `RETRYABLE_FETCH_ERROR` 的注释。 */
const FEED_RETRY_DELAY_MS = Number(process.env.TINKER_FEED_RETRY_DELAY_MS ?? 20000);

/**
 * 值得重试一次的抓取失败。
 *
 * 2026-08-06 查出来的：当天 7 个「失败源」里有 **6 个其实是活的**，
 * 503 不是站点给的，是本环境出口代理给的——响应体只有 48 字节，
 * 带 `x-deny-reason: resolve_failed`，正文写着
 * "DNS resolution failed (transient resolver error)"，
 * 代理自己都说了这是 transient。另一种是上游 TLS 被 reset。
 * 而 `get()` 只把 `res.status` 拼成 `HTTP 503` 抛出去，
 * 上层无从分辨「站点死了」和「出口抖了一下」，一律记进 consecutiveFailures。
 *
 * 后果不是少抓一天，是**误判源的死活**：SkyWT / 东方星痕 / 樵夫的小站
 * 已经连续 5 天记为失败、距离「连续 ≥7 天点名停用」只剩两天，
 * 而当天手动重放，SkyWT 和 东方星痕 立刻 200，三轮都稳定 200。
 * 差一点就按代理噪声把健康的博客停掉了。
 *
 * 判据只认**网络类**失败（5xx / 超时 / 连接失败）。404、403、410 不重试：
 * 那是站点的明确答复，重试改变不了，而且 403 已经有 UA 回退兜着。
 */
const RETRYABLE_FETCH_ERROR = /HTTP (50[0234])|fetch failed|timeout|aborted|ECONNRESET|socket hang up/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * 每天跑多少个搜索查询。
 *
 * 12 → 30 是 2026-08-02 调的，依据是当天的实测：6 条入围**全部**来自搜索源，
 * 当轮新增的 51 个博客源贡献 0 条。博客月更，日更的量只能靠平台搜索撑。
 * 轮转池现在有 200+ 条（词表自动派生），30 条/天约一周轮遍。
 */
const QUERIES_PER_DAY = Number(process.env.TINKER_QUERIES ?? 30);
const THIN_THRESHOLD = 250;
const EXCERPT_CHARS = 2500;
/** LLM 环节一次能认真读完的上限。超过这个数，质量判断会退化成走过场。 */
const SHORTLIST_CAP = Number(process.env.TINKER_SHORTLIST_CAP ?? 60);

/**
 * 只重放、不落任何共享状态。`TINKER_DRYRUN=1` 打开。
 *
 * 为什么需要它：调规则要用 `_raw.json`，而 `_raw.json` 不进 git（体积大、每天变）。
 * 也就是说**在一个新容器里根本没有 `_raw.json`**——周更体检每次都在新容器里跑，
 * 于是「跑 tinker-retriage 查误杀」这件事写在手册里，实际上一次都执行不了。
 * 2026-08-03 那轮就是这么卡住的：只能拿committed 的 `_pending.json` 里
 * 252 条**不带正文**的 rejected 凑合，改完规则无法离线验证。
 *
 * 但直接补跑一次 `tinker-fetch` 会犯 LESSONS 里记着的那个错：
 * 它把当天的条目写进共享的 `seen.json`，等于把云端日更那轮的原料吃掉。
 * 所以 dry-run 要同时做到三件事：
 *   1. **读**的时候忽略 seen——否则日更刚跑完，重放只会拿到零条；
 *      忽略之后拿到的是完整的 21 天窗口，正是查误杀需要的样本量。
 *   2. **写**的时候不碰 seen，不碰 status（否则会刷新 lastSuccess，
 *      把一个正在死掉的源伪装成健康的），也不碰 _pending（日更那轮还要用）。
 *   3. 只产出 `_raw.json`，给 `tinker-retriage.mjs` 用。
 */
const DRYRUN = process.env.TINKER_DRYRUN === '1';

function todayInShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function daysAgo(date, n) {
  return new Date(Date.parse(`${date}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
}

async function get(url, { ua = UA, accept = '*/*', timeout = TIMEOUT_MS } = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': ua, accept },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

/**
 * 正文补全。规则筛选看的是标题 + 摘要，feed 只给标题时几乎必然误判，
 * 所以这一步要在 triage **之前**做，而不是像信源罗盘那样只为写摘要服务。
 *
 * **论坛帖只要 feed 给了内容就不补全。** Discourse / NodeSeek 这类站点的 RSS 里
 * 本来就是首帖全文，而话题页在浏览器 UA 下返回的是 JS 外壳：没有正文，
 * 只有主题样式表和一段给爬虫看的声明。补全会拿这堆东西盖掉本来正确的首帖，
 * 中文占比被拉到 1% 后整条被判为非中文内容毙掉——2026-08-02 那天 linux.do
 * 26 条全军覆没就是这么来的。
 */
export function needsEnrich(item, threshold = THIN_THRESHOLD) {
  if (item.excerpt.length >= threshold) return false;
  if (item.thread && item.excerpt.length > 0) return false;
  return true;
}

/**
 * 论坛话题页要先切到**首帖容器**再抽正文，抽整页等于把导航、页脚和所有回复
 * 都算成作者写的东西。
 *
 * 2026-08-09 查出来的。当天 20 条入围里 V2EX 占 5 条，其中三条的首帖正文实测是
 * **空的**——「codex 20260808 重置了」0 字符、「所以买 codex pro 是没有意义的吗」
 * 0 字符、「Codex for oss 过了…求大佬们支招」17 字符（V2EX 首帖为空时页面里
 * 连 `topic_content` 这个 div 都不生成）。但它们的 excerpt 分别是 711 / 1305 / 793
 * 字符，全部越过了 `relevance.mjs` 里「论坛短帖（<600 字符）扣 3 分」那道闸，
 * 还从回复区白捡了「正文经验词 3 个」的加分，最后以 7-9 分占掉三个评审席位。
 *
 * 也就是说那条短帖闸写得没错，只是**在 V2EX 上从来没有量到过正确的字符串**：
 * 页面固定 chrome 就有三百多字符，回复再垫几百，任何一个纯标题帖都能凑过 600。
 * 这和 `FORUM_SHARE` 那次是同一类问题——规则本身合理，喂给它的输入却来自
 * 「怎么抓」而不是「抓到什么」。
 *
 * 对照组（同一天、同一个源）：`/t/1232641`「opencode go 套餐怎么样」首帖 1237 字符，
 * 切完是 1237，说明切的是首帖不是把长帖也切没了。
 *
 * 返回值三态，调用方要分清：
 * - `null` —— 这个站没有切法，按老路子抽整页
 * - `''`   —— 有切法且**确认首帖为空**，正文就是没有，不许拿整页顶上
 * - 字符串 —— 首帖 HTML
 */
export function threadBodyHtml(url, html) {
  let host;
  try { host = new URL(url).hostname; } catch { return null; }
  if (!/(^|\.)v2ex\.com$/.test(host)) return null;
  const m = html.match(/<div class="topic_content">([\s\S]*?)<\/div>\s*<\/div>/);
  return m ? m[1] : '';
}

async function enrichPass(targets, concurrency) {
  let ok = 0;
  for (let i = 0; i < targets.length; i += concurrency) {
    await Promise.all(targets.slice(i, i + concurrency).map(async (item) => {
      const before = item.excerpt.length;
      try {
        const html = await get(item.url, { ua: BROWSER_UA, accept: 'text/html,*/*' });
        const scoped = item.thread ? threadBodyHtml(item.url, html) : null;
        const text = scoped === null ? extractArticleText(html, EXCERPT_CHARS)
          : extractArticleText(scoped, EXCERPT_CHARS);
        if (text.length >= THIN_THRESHOLD && text.length >= before * 2) {
          item.excerpt = text;
          ok += 1;
        }
      } catch {
        // 抓不到原文页很常见（反爬、超时、登录墙）。保留 feed 给的摘要继续走，
        // 绝不因为补全失败就丢掉条目。
      }
    }));
  }
  return ok;
}

/**
 * 正文补全，两轮。
 *
 * **补全失败不都是反爬，有很大一部分是限流，隔一会儿再要就给。**
 * 2026-08-05 查出来的：掘金文章页在补全阶段返回的不是挑战页，是
 * `HTTP 200 + x-tt-system-error: 3` 的 2397 字节错误页——换 UA（Googlebot /
 * curl / 完整 Chrome）拿到的字节数一模一样，说明和身份无关，是服务端在限流。
 * 当轮 16 条掘金入围条目全部 thin，隔几分钟按 4 秒间隔重放，**9 条拿到了完整正文**，
 * 其中两条当天就收录了。单轮补全等于把最大供给源的一半正文白白丢掉，
 * 而 thin 条目在评审那一步是**不许收**的（只有标题，写摘要就成了编造），
 * 所以丢的不是摘要质量，是收录资格。
 *
 * **重试必须克制。** 同一轮里我接着按 3.5 秒、9 秒间隔又跑了两遍，
 * 两遍都是 0 收获——限流被打得更死了。所以只补一轮，先等 `ENRICH_RETRY_DELAY_MS`
 * 让限流窗口过去，并且用一半的并发。
 */
export async function enrich(items, { retryDelayMs = ENRICH_RETRY_DELAY_MS } = {}) {
  const targets = items.filter((it) => needsEnrich(it));
  let ok = await enrichPass(targets, ENRICH_CONCURRENCY);

  const retry = targets.filter((it) => it.excerpt.length < THIN_THRESHOLD);
  let retried = 0;
  if (retry.length) {
    await sleep(retryDelayMs);
    retried = await enrichPass(retry, Math.max(1, Math.floor(ENRICH_CONCURRENCY / 2)));
    ok += retried;
  }

  for (const it of items) it.thin = it.excerpt.length < THIN_THRESHOLD;
  return { attempted: targets.length, enriched: ok, retryAttempted: retry.length, retried };
}

/**
 * 抓一遍所有源，网络类失败的等一会儿再补几轮。
 *
 * 补轮的理由见 `RETRYABLE_FETCH_ERROR`：出口代理的 transient 503 会被
 * 原样记成源失败，而源的死活判断（连续 ≥7 天点名停用）就建在这个计数上。
 *
 * **2026-08-07：一轮不够。** 昨天上线「补一轮」之后，东方星痕当天仍然记了失败，
 * 今天是连续第 6 天——而手动验证它是**活的**：`ystyle.top` 首页 200，
 * `atom.xml`（240KB）连着 curl 三次，第一次 `Connection reset by peer`、
 * 第二次同样、**第三次 200**。三次之间只隔几秒，也就是说不是「代理抖动窗口比 20 秒长」
 * （昨天留的两个假设之一），而是**每一次连接独立地有一定概率被 reset**，
 * 大 feed 传输时间长、命中概率更高。这种情况下拉长间隔没用，加次数才有用。
 * 对照：樵夫的小站首页和 feed 都是连接失败，重试多少轮都不会回来——它是真死。
 *
 * 所以改成最多 `retryRounds` 轮（默认 2 轮补抓，合计 3 次机会），
 * 每轮只重试**上一轮仍然失败**的源，代价随轮次迅速收敛
 * （今天第一轮失败 10 个，第二轮剩 3 个，第三轮只会碰这 3 个）。
 * 其余形状不变：等一会儿、并发减半、只重试网络类失败。
 *
 * 成功的通过 `onSuccess` 当场交出去（status 要立刻记，不然重试轮会覆盖），
 * 失败的攒着，所有轮次都没拿到才交回调用方去记 failure。
 */
export async function fetchAllSources({
  sources, fetchOne, concurrency = 10, retryDelayMs = 20000, retryRounds = 2, onSuccess, log = console.error,
}) {
  const pass = async (list, limit, progress) => {
    const failed = [];
    for (let i = 0; i < list.length; i += limit) {
      await Promise.all(list.slice(i, i + limit).map(async (source) => {
        try {
          onSuccess(source, await fetchOne(source));
        } catch (err) {
          failed.push({ source, message: err.message });
        }
      }));
      if (progress) log(`已抓取 ${Math.min(i + limit, list.length)}/${list.length}`);
    }
    return failed;
  };

  const firstRound = await pass(sources, concurrency, true);
  const dead = firstRound.filter((f) => !RETRYABLE_FETCH_ERROR.test(f.message));
  let pending = firstRound.filter((f) => RETRYABLE_FETCH_ERROR.test(f.message));
  const retryAttempted = pending.length;
  if (!pending.length) return { failed: firstRound, retryAttempted: 0, retried: 0 };

  for (let round = 2; round <= retryRounds + 1 && pending.length; round += 1) {
    log(`\n抓取第 ${round} 轮：${pending.length} 个源等 ${Math.round(retryDelayMs / 1000)} 秒后重试`);
    await sleep(retryDelayMs);
    pending = await pass(pending.map((f) => f.source), Math.max(1, Math.floor(concurrency / 2)), false);
  }
  return {
    failed: [...dead, ...pending],
    retryAttempted,
    retried: retryAttempted - pending.length,
  };
}

async function main() {
  const all = JSON.parse(readFileSync(SOURCES, 'utf8'));
  const sources = all.filter((s) => s.enabled);
  const today = todayInShanghai();
  const now = new Date().toISOString();
  const seen = DRYRUN ? {} : loadSeen(DATA_DIR);
  const status = loadStatus(DATA_DIR);
  const queries = queriesForDate(today, QUERIES_PER_DAY);
  if (DRYRUN) console.error('DRYRUN：忽略 seen、只写 _raw.json，不动 seen / status / _pending');

  const items = [];
  const errors = [];
  const perSource = {};
  /** 搜索源的「部分查询失败」按源名存，重试后覆盖，避免同一个源记两条。 */
  const partials = new Map();

  const fetchOne = async (source) => {
    if (isSearchSource(source)) {
      const { items: raw, failures } = await fetchSearchItems({
        source, queries, ua: BROWSER_UA, afterDate: daysAgo(today, 21),
      });
      if (failures.length) partials.set(source.name, { source: source.name, message: `部分查询失败（${failures.length}/${queries.length}）`, partial: true });
      else partials.delete(source.name);
      return collectRaw({ source, raw, seen, today, now });
    }
    const xml = await get(source.feed, {
      ua: source.browserUa ? BROWSER_UA : UA,
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
    });
    return collectFeed({ source, xml, seen, today, now });
  };

  const { failed, retryAttempted: feedRetryAttempted, retried: feedRetried } = await fetchAllSources({
    sources,
    fetchOne,
    concurrency: CONCURRENCY,
    retryDelayMs: FEED_RETRY_DELAY_MS,
    onSuccess: (source, got) => {
      items.push(...got);
      perSource[source.name] = got.length;
      recordSuccess(status, source.name, now);
    },
  });
  // 只有两轮都没拿到的才算这个源今天失败了。
  for (const f of failed) {
    errors.push({ source: f.source.name, message: f.message });
    recordFailure(status, f.source.name, now, f.message);
  }
  errors.push(...partials.values());

  // 同一篇文章会同时出现在博客 feed 和掘金搜索里。itemId 基于归一化 URL，
  // 跨源天然去重；这里只需处理同一次运行内的碰撞。
  const byId = new Map();
  for (const it of items) if (!byId.has(it.id)) byId.set(it.id, it);
  const unique = [...byId.values()];

  const { attempted, enriched, retryAttempted, retried } = await enrich(unique);

  mkdirSync(DATA_DIR, { recursive: true });
  // 补全后、筛选前的完整快照。规则要长期调，每次改完都重抓一遍要两分半钟、
  // 还会把 seen 写脏，根本没法迭代。有了这份缓存，scripts/tinker-retriage.mjs
  // 能离线重放当天的筛选并和上一版对比。不进 git（体积大且每天变）。
  writeFileSync(`${DATA_DIR}/_raw.json`, JSON.stringify({ date: today, items: unique }, null, 2) + '\n');

  const { shortlist, rejected } = triage(unique, { cap: SHORTLIST_CAP });

  if (DRYRUN) {
    console.log(`\n${today}（DRYRUN）：抓到 ${unique.length} 条，规则入围 ${shortlist.length} 条，筛掉 ${rejected.length} 条`);
    console.log(`已写 ${DATA_DIR}/_raw.json，现在可以跑 node scripts/tinker-retriage.mjs`);
    return;
  }

  // 只有真正写进 _pending 的才记 seen。被规则毙掉的也要记——
  // 否则每天都会把同一批噪声重新抓一遍、重新扣一遍分。
  for (const it of unique) seen[it.id] = today;

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(`${DATA_DIR}/_pending.json`, JSON.stringify({
    date: today,
    generatedAt: now,
    queries,
    stats: {
      sources: sources.length,
      fetched: unique.length,
      shortlisted: shortlist.length,
      rejected: rejected.length,
      thin: unique.filter((it) => it.thin).length,
      enriched,
      enrichAttempted: attempted,
      enrichRetryAttempted: retryAttempted,
      enrichRetried: retried,
      failedSources: errors.filter((e) => !e.partial).length,
      feedRetryAttempted: feedRetryAttempted,
      feedRetried,
    },
    perSource,
    shortlist,
    rejected,
    errors,
  }, null, 2) + '\n');
  saveSeen(DATA_DIR, seen, today);
  saveStatus(DATA_DIR, status);

  const inShortlist = new Set(shortlist.map((it) => it.id));
  saveQueryYield(DATA_DIR, recordQueryYield(
    loadQueryYield(DATA_DIR),
    queries,
    unique.filter((it) => it.matchedQuery).map((it) => ({ query: it.matchedQuery, shortlisted: inShortlist.has(it.id) })),
    today,
  ));

  const s = { fetched: unique.length, shortlisted: shortlist.length, rejected: rejected.length };
  console.log(`\n${today}：抓到 ${s.fetched} 条，规则入围 ${s.shortlisted} 条，筛掉 ${s.rejected} 条`);
  console.log(`正文补全：尝试 ${attempted}，成功 ${enriched}（第二轮重试 ${retryAttempted} 条，救回 ${retried} 条）`);
  if (feedRetryAttempted) console.log(`抓取重试：${feedRetryAttempted} 个源，救回 ${feedRetried} 个`);
  console.log(`今日查询词（${queries.length}）：${queries.join('、')}`);
  if (errors.length) {
    console.log(`\n抓取失败 ${errors.length} 个源：`);
    for (const e of errors) console.log(`  ${e.source} — ${e.message}`);
  }
  const stale = Object.entries(status).filter(([, v]) => v.consecutiveFailures >= 7);
  if (stale.length) {
    console.log('\n连续失败 7 天以上（需人工处理）：');
    for (const [name, v] of stale) console.log(`  ${name} — ${v.lastErrorMessage}（连续 ${v.consecutiveFailures} 次）`);
  }
  const zero = Object.entries(perSource).filter(([, n]) => n === 0).map(([n]) => n);
  if (zero.length) console.log(`\n本次零产出的源（${zero.length}）：${zero.join('、')}`);

  // 跑够 5 轮还一条都没入围的查询词——周更体检据此换词。轮转池一周才转一圈，
  // 所以门槛按「跑过几次」而不是「过了几天」算。
  const barren = Object.entries(loadQueryYield(DATA_DIR))
    .filter(([, v]) => v.runs >= 5 && v.shortlisted === 0)
    .sort((a, b) => b[1].runs - a[1].runs);
  if (barren.length) {
    console.log(`\n跑够 5 轮仍零入围的查询词（${barren.length}）：`);
    for (const [q, v] of barren.slice(0, 20)) console.log(`  ${q} — ${v.runs} 轮，捞回 ${v.items} 条，入围 0`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
