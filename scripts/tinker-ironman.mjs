#!/usr/bin/env node
/**
 * 扫 iT 邦幫忙铁人赛的报名列表，找出值得单独订阅的参赛系列。
 *
 * 这是扩源的第三条通道（名录 / 友链 / 报名表 / 写作平台 / 作者个人站里的第三条）。
 * 它问的问题和别的通道都不同：名录问「谁被收进榜单」，友链问「写博客的人认识谁」，
 * 报名表问的是**「谁正在为期 30 天地写同一件事」**——供给密度天然高，
 * 而且报名时就按主题分好了组。
 *
 * 之所以要写成脚本：这条通道手工跑过两次，两次都跑错，而且两次的错都不报警。
 *
 *   2026-08-13 第一次跑，按 `signup/list?group=<组>` 抓，每组返回 10 个系列，
 *     就当成「这个组一共 10 个」——**没试过翻页**。08-17 翻第 2、3 页，
 *     四个 AI 组又多出 28 个系列、120 篇。第一页的产量不是这条通道的产量。
 *
 *   2026-08-22 第二次跑，翻到某一页返回「这一页没有系列」就收尾——
 *     而那其实是 **403**：`signup/list` 不带浏览器 UA 时一律 403，
 *     响应体只有一千多字节，解析出来是零个系列，和「翻到底了」长得一模一样。
 *     带 UA 重扫，四个 AI 组一共 80 个系列，比上一轮多 12 个。
 *
 * 所以这里把两条判据都钉死在代码里：**一律带浏览器 UA**，
 * 且**只有 HTTP 200 且解析出 0 个系列**才算翻到底；非 200 一律当成失败往上报，
 * 绝不当成「这一组扫完了」。这正是 LESSONS 那条通用判据的实例——
 * 「判一条列表通道『翻到底了』之前，先确认最后那一页是 200 而不是 403」。
 *
 * 准入判据**不能**用 harvest 的 `evaluate()`：它带一条「近 20 篇跨度 ≥14 天
 * 否则像媒体」的闸，而赛制就是日更 30 天，所有参赛系列一律不合格。
 * 这里换成和日常筛选完全一致的那把尺子：近 20 篇里几篇过 `scoreItem()` 的入围线。
 *
 * 用法：
 *   node scripts/tinker-ironman.mjs                 # 扫一遍，打印够格的系列
 *   node scripts/tinker-ironman.mjs --min-hits 3    # 收紧准入
 *   node scripts/tinker-ironman.mjs --year 2027     # 换赛季
 *
 * **不提供 `--merge`。** 和 harvest 同一个理由：机器判不出「教学连载」——
 * 铁人赛里 `Day N` 和教程内容强相关（见 LESSONS，191 篇实测），
 * 够格的系列里仍有一半是「什麼是 Vibe Coding？」这类，只能靠人扫一眼标题。
 * 脚本负责把候选找全并打好分，选哪个是人的事。
 */
import { readFileSync } from 'node:fs';
import { parseFeed } from '../lib/feed-parse.mjs';
import { htmlToText } from '../lib/html-text.mjs';
import { scoreItem } from '../lib/tinker/relevance.mjs';
import { BROWSER_UA } from '../lib/tinker/probe.mjs';

/** 报名分组里和 agent 沾边的那几个。赛季换了要回来核一遍组名还在不在。 */
const AI_GROUPS = ['claude-ai', 'chatgpt-and-codex', 'vibe-coding', 'ai-engineering'];

/** 翻页上限，纯粹是防跑飞的保险；正常靠「200 且 0 个系列」停。 */
const MAX_PAGES = 12;

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const YEAR = flag('year', '2026');
const MIN_HITS = Number(flag('min-hits', '2'));
const GROUPS = flag('group', AI_GROUPS.join(',')).split(',').filter(Boolean);

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': BROWSER_UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/**
 * 从报名列表页里抽出系列 id。
 * 报名列表上每个系列挂的是 `/users/<uid>/ironman/<seriesId>`，
 * 同一个作者还会另有一条不带 seriesId 的 `/users/<uid>/ironman`，别一起吃进来。
 */
export function parseSeriesIds(html) {
  const ids = new Set();
  for (const m of html.matchAll(/\/users\/\d+\/ironman\/(\d{3,6})\b/g)) ids.add(m[1]);
  return [...ids];
}

/**
 * 页面上还有没有「下一页」。
 * 它是「翻到底了」这个判断的第二个证人：`signup/list` 的分页器在最后一页
 * 不再吐出 `page=<n+1>` 的链接，所以「有下一页却一个系列都没解析出来」
 * 只可能是解析坏了，不可能是翻到底了。
 */
export function hasNextPage(html, page) {
  return new RegExp(`signup/list\\?group=[^"']*(?:&|&amp;)page=${page + 1}\\b`).test(html);
}

/**
 * 一组的全部页。
 *
 * 停下来的条件只有一个：**200、解析出 0 个系列、且页面上没有下一页**。
 * 少一个证人就不算数——
 *   非 200        → 08-22 踩过：403 的响应体解析出来也是 0 个系列，和翻到底一模一样；
 *   有下一页却 0 条 → 解析坏了（今天就踩了一次：链接形状是 /users/<uid>/ironman/<id>，
 *                    而第一版正则要求 /ironman/<字母>/<数字>，于是四个组全部 200 且 0 条，
 *                    看起来像「今年没人报名」）。
 * 两种都往上报，绝不当成「这一组扫完了」。
 */
async function scanGroup(group) {
  const ids = [];
  const pages = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `https://ithelp.ithome.com.tw/${YEAR}ironman/signup/list?group=${group}&page=${page}`;
    let html;
    try {
      html = await get(url);
    } catch (err) {
      // 非 200 不是「翻到底了」——这正是 08-22 踩的那一脚，往上报，别静默收尾
      pages.push({ page, error: String(err.message ?? err) });
      break;
    }
    const found = parseSeriesIds(html);
    const next = hasNextPage(html, page);
    pages.push({ page, count: found.length });
    if (!found.length) {
      if (next) pages[pages.length - 1].error = '解析出 0 个系列但页面上还有下一页';
      break;
    }
    ids.push(...found);
    if (!next) break;
  }
  return { group, ids: [...new Set(ids)], pages };
}

/**
 * 一个系列够不够格：近 20 篇里几篇过 `scoreItem()` 的入围线。
 * 不用 harvest 的 evaluate()，理由见文件头。
 */
async function evaluateSeries(id) {
  const feed = `https://ithelp.ithome.com.tw/rss/series/${id}`;
  let xml;
  try {
    xml = await get(feed);
  } catch (err) {
    return { id, feed, ok: false, why: String(err.message ?? err) };
  }
  const { title = '', items = [] } = parseFeed(xml);
  if (!items.length) return { id, feed, title, ok: false, why: '0 条' };
  const recent = items.slice(0, 20);
  let hits = 0;
  const samples = [];
  for (const it of recent) {
    const excerpt = htmlToText(it.contentHtml ?? '', 3000);
    const r = scoreItem({ title: it.title ?? '', excerpt, kind: 'blog' });
    if (r.verdict === 'shortlist') {
      hits += 1;
      samples.push(`${r.score} ${it.title}`);
    }
  }
  return { id, feed, title, ok: hits >= MIN_HITS, hits, total: recent.length, samples };
}

async function main() {
  const known = new Set();
  try {
    const src = JSON.parse(readFileSync(new URL('../tinker/sources.json', import.meta.url), 'utf8'));
    for (const s of Array.isArray(src) ? src : src.sources ?? []) {
      const m = /\/rss\/series\/(\d+)/.exec(s.feed ?? '');
      if (m) known.add(m[1]);
    }
  } catch { /* 没有 sources.json 就当全是新的 */ }

  const all = new Set();
  for (const group of GROUPS) {
    const { ids, pages } = await scanGroup(group);
    const trail = pages.map((p) => (p.error ? `p${p.page}:${p.error}` : `p${p.page}:${p.count}`)).join(' ');
    console.log(`${group}：${ids.length} 个系列（${trail}）`);
    if (pages.some((p) => p.error)) console.log(`  ⚠ 这一组翻页中断，上面的数字不是全量`);
    for (const id of ids) all.add(id);
  }

  const fresh = [...all].filter((id) => !known.has(id));
  console.log(`\n共 ${all.size} 个系列，其中已订阅 ${all.size - fresh.length} 个，待评估 ${fresh.length} 个\n`);

  const passed = [];
  for (const id of fresh) {
    const r = await evaluateSeries(id);
    if (r.ok) {
      passed.push(r);
      console.log(`✓ ${id} ${r.title}  ${r.hits}/${r.total}`);
      for (const s of r.samples.slice(0, 4)) console.log(`    ${s}`);
    }
  }
  console.log(`\n够格 ${passed.length} 个（近 20 篇里 ≥${MIN_HITS} 篇过收录线）。`);
  console.log('人工扫一眼标题再决定加哪个——铁人赛里 Day N 和教学连载强相关，机器分不出。');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
