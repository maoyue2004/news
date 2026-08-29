#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderPage } from '../lib/tinker/render.mjs';
import { loadRecentDays, pruneDayFiles, loadStatus } from '../lib/store.mjs';

const WINDOW_DAYS = 30;
const KEEP_DAYS = 40;

/**
 * 日文件是 LLM 逐条手写的 JSON，没有任何写入期校验。字段缺失不会在写文件时报错，
 * 只会在浏览器里炸成一个白页且无提示。在构建期挡住，并指出是哪天哪一条。
 */
const REQUIRED = ['id', 'source', 'url', 'titleZh', 'summaryZh', 'whyRead', 'rating', 'publishedAt'];

export function validate(days) {
  for (const day of days) {
    for (const item of day.items ?? []) {
      for (const field of REQUIRED) {
        const v = item[field];
        if (v === undefined || v === null || v === '' || (Array.isArray(v) && field !== 'tools' && !v.length)) {
          throw new Error(`${day.date} 有一条缺字段 "${field}"（id=${item.id ?? '未知'} url=${item.url ?? '未知'}）`);
        }
      }
      if (!Number.isInteger(item.rating) || item.rating < 1 || item.rating > 5) {
        throw new Error(`${day.date} 的 rating 必须是 1-5 的整数，实际是 ${JSON.stringify(item.rating)}（${item.url}）`);
      }
      for (const facet of ['tools', 'topics']) {
        if (item[facet] !== undefined && !Array.isArray(item[facet])) {
          throw new Error(`${day.date} 的 ${facet} 必须是数组（${item.url}）`);
        }
      }
    }
  }
}

/**
 * 摘要字数的账。手册的区间改过三次（80-160 → 150-260 → 250-450），
 * 每一次都是拿实测分布去对齐实践，而每一次改完仍然对不上，
 * REVIEW 为此连记了五天，最后一天（08-29）的结论是「超区间的 8 条全是机制型，
 * 下一轮把上限抬到 500」。
 *
 * 2026-08-30 拿已提交的日文件复量，发现这五天量的根本不是同一个东西：
 * 手册只写了「250-450 字」，没写一个「字」是什么。同一批 08-29 的条目，
 * 按**全部字符**数中位数是 503，按**汉字**数中位数是 239——
 * 前一种读法说「几乎每条都超上限」，后一种读法说「几乎每条都不到下限」，
 * 同一份语料，两个相反的结论。而 08-29 的 REVIEW 里记下的那串数字
 * （476/481/462/…）和这两种读法都对不上，也就是说它量的是第三种口径。
 * 这正是 LESSONS 那条「量一件事要用系统自己的那把尺」的又一例，
 * 只是这次没有尺——手册给的是一个没有单位的数。
 *
 * 所以这里做两件事，而不是再改一次数字：
 *   1. 把单位钉死为 `[...s].length`（全部字符，含数字、英文、标点）。
 *      理由是摘要里的版本号、报错原文和命令占的是同样的阅读带宽。
 *   2. 让构建把当天的分布直接打出来，超区间的逐条点名。
 *      一条每天靠记性重新量一遍的规矩，五天里被重新量了五次也没收敛；
 *      交给机器之后它才会停止被重新讨论。
 *
 * 区间按同一把尺子重取：近 14 天 96 条的 P10 是 369、中位 436、P75 是 486，
 * 取整成 350-500。下限从来没有构成过约束（最短一条 302），
 * 留着它是防「干了什么 + 结论 + 数字」装不下；真正被撞的一直是上限。
 * 超出只警告不报错——机制型选题（要装下多组数字或多段机制）确实会到 550 上下，
 * 但它应该是一天里的一两条，而不是默认值，所以要被点名一次。
 */
export const SUMMARY_MIN = 350;
export const SUMMARY_MAX = 500;

export function summaryLengthReport(days, date) {
  const day = days.find((d) => d.date === date);
  if (!day || !(day.items ?? []).length) return null;
  const rows = day.items.map((it) => ({ n: [...(it.summaryZh ?? '')].length, title: it.titleZh ?? it.url }));
  const lens = rows.map((r) => r.n).sort((a, b) => a - b);
  const mid = lens.length % 2 ? lens[(lens.length - 1) / 2]
    : Math.round((lens[lens.length / 2 - 1] + lens[lens.length / 2]) / 2);
  return {
    date, count: lens.length, min: lens[0], median: mid, max: lens[lens.length - 1],
    outliers: rows.filter((r) => r.n < SUMMARY_MIN || r.n > SUMMARY_MAX),
  };
}

/**
 * 一个把成品页塞进窄 iframe 的预览页。
 *
 * 为什么需要它：浏览器窗口 resize 在这套工具链下不生效（试过，innerWidth 不变），
 * 而 iframe 有自己的视口，媒体查询会按 iframe 宽度生效——这是能真正看到
 * 手机布局的最省事办法。第一次这么看就发现了问题：
 * 手机上整条侧栏排在内容前面，要划过一屏半筛选器才见到第一篇文章。
 * 每次构建都产出它，让「顺手看一眼窄屏」成为习惯而不是额外动作。
 */
function responsiveHarness() {
  const v = Date.now();
  const frame = (w, label) => `<figure><figcaption>${label}</figcaption>`
    + `<iframe src="tinker.html?v=${v}" width="${w}" height="820" title="${label}"></iframe></figure>`;
  return `<!doctype html><meta charset="utf-8"><title>折腾志 · 响应式预览</title>
<style>body{margin:0;background:#333;display:flex;gap:16px;padding:12px;
font:12px system-ui,sans-serif;color:#fff;align-items:flex-start}
figure{margin:0}figcaption{padding:4px 0}iframe{border:0;background:#fff}</style>
${frame(390, '390 × 820（手机）')}
${frame(768, '768 × 820（平板）')}
${frame(1180, '1180 × 820（桌面）')}
`;
}

function todayInShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function buildHtml({ root = '.', today = todayInShanghai() } = {}) {
  const dataDir = join(root, 'tinker', 'data');
  pruneDayFiles(dataDir, today, KEEP_DAYS);

  const days = loadRecentDays(dataDir, today, WINDOW_DAYS);
  validate(days);
  const sources = JSON.parse(readFileSync(join(root, 'tinker', 'sources.json'), 'utf8'));
  const status = loadStatus(dataDir);

  const html = renderPage({ days, sources, status, generatedAt: new Date().toISOString() });
  const out = join(root, 'dist', 'tinker.html');
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(out, html);
  writeFileSync(join(root, 'dist', 'responsive.html'), responsiveHarness());

  return {
    dayCount: days.length,
    itemCount: days.reduce((n, d) => n + (d.items?.length ?? 0), 0),
    bytes: Buffer.byteLength(html, 'utf8'),
    summary: summaryLengthReport(days, today),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = buildHtml();
  console.log(`已生成 dist/tinker.html：${r.dayCount} 天 / ${r.itemCount} 篇 / ${(r.bytes / 1024).toFixed(0)} KB`);
  if (r.summary) {
    const s = r.summary;
    console.log(`摘要字数（全部字符）：${s.count} 条，最短 ${s.min}，中位 ${s.median}，最长 ${s.max}`
      + `　区间 ${SUMMARY_MIN}-${SUMMARY_MAX}`);
    for (const o of s.outliers) console.log(`  ⚠ ${o.n} 字　${o.title}`);
  }
}
