import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderPage } from '../lib/render.mjs';
import { loadRecentDays, pruneDayFiles, loadStatus } from '../lib/store.mjs';

const WINDOW_DAYS = 30;   // 页面内嵌最近多少天
const KEEP_DAYS = 35;     // data/ 保留多少天
const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER_TEMPLATE = join(HERE, '..', 'templates', 'worker.js');

// 日文件由 Claude 逐条手写 229 条 JSON，没有任何校验。字段缺失不会在写 JSON
// 时报错，只会在页面渲染时才炸（比如 lang 缺失导致 it.lang.toUpperCase() 抛
// TypeError，整页空白且无提示）。在构建期就把关，缺字段直接 throw 并指出是
// 哪一天哪一条，让故障停在构建期而不是发布后。
const REQUIRED_ITEM_FIELDS = [
  'id', 'source', 'type', 'lang', 'url', 'titleOriginal', 'titleZh', 'summaryZh', 'publishedAt',
];

function validateDays(days) {
  for (const day of days) {
    for (const item of day.items || []) {
      for (const field of REQUIRED_ITEM_FIELDS) {
        if (item[field] === undefined || item[field] === null || item[field] === '') {
          throw new Error(
            `日文件 ${day.date} 中有一条记录缺少字段 "${field}"（id=${item.id ?? '未知'}, url=${item.url ?? '未知'}）`,
          );
        }
      }
    }
  }
}

function todayInShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function buildWorkerSource(html) {
  const template = readFileSync(WORKER_TEMPLATE, 'utf8');
  const placeholder = '__AI_NEWS_HTML__';
  if (!template.includes(placeholder)) {
    throw new Error(`Worker 模板缺少占位符 ${placeholder}`);
  }
  return template.replace(placeholder, JSON.stringify(html));
}

export function buildHtml({ root = '.', today = todayInShanghai() } = {}) {
  const dataDir = join(root, 'data');

  pruneDayFiles(dataDir, today, KEEP_DAYS);

  const days = loadRecentDays(dataDir, today, WINDOW_DAYS);
  validateDays(days);
  const sources = JSON.parse(readFileSync(join(root, 'sources.json'), 'utf8'));
  const status = loadStatus(dataDir);

  const html = renderPage({ days, sources, status, generatedAt: new Date().toISOString() });

  const distDir = join(root, 'dist');
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, 'index.html'), html);

  // Codex Sites expects a Cloudflare Worker entry point. Keep the existing
  // single-file page unchanged, add the authenticated sync API, and serve the
  // exact page build from the worker.
  const serverDir = join(distDir, 'server');
  mkdirSync(serverDir, { recursive: true });
  writeFileSync(join(serverDir, 'index.js'), buildWorkerSource(html));

  return {
    dayCount: days.length,
    itemCount: days.reduce((n, d) => n + d.items.length, 0),
    bytes: Buffer.byteLength(html, 'utf8'),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = buildHtml();
  console.log(`已生成 dist/index.html：${res.dayCount} 天 / ${res.itemCount} 条 / ${(res.bytes / 1024).toFixed(0)} KB`);
}
