import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderPage } from '../lib/render.mjs';
import { loadRecentDays, pruneDayFiles, loadStatus } from '../lib/store.mjs';

const WINDOW_DAYS = 30;   // 页面内嵌最近多少天
const KEEP_DAYS = 35;     // data/ 保留多少天

function todayInShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function buildHtml({ root = '.', today = todayInShanghai() } = {}) {
  const dataDir = join(root, 'data');

  pruneDayFiles(dataDir, today, KEEP_DAYS);

  const days = loadRecentDays(dataDir, today, WINDOW_DAYS);
  const sources = JSON.parse(readFileSync(join(root, 'sources.json'), 'utf8'));
  const status = loadStatus(dataDir);

  const html = renderPage({ days, sources, status, generatedAt: new Date().toISOString() });

  const distDir = join(root, 'dist');
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, 'index.html'), html);

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
