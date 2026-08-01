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
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = buildHtml();
  console.log(`已生成 dist/tinker.html：${r.dayCount} 天 / ${r.itemCount} 篇 / ${(r.bytes / 1024).toFixed(0)} KB`);
}
