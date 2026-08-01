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
const REQUIRED = ['id', 'source', 'url', 'titleZh', 'summaryZh', 'whyRead', 'rating', 'tools', 'publishedAt'];

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
      if (!Array.isArray(item.tools)) {
        throw new Error(`${day.date} 的 tools 必须是数组（${item.url}）`);
      }
    }
  }
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
