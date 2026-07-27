import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, '..', 'templates');

function readTemplate(name) {
  const p = join(TEMPLATES, name);
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

/**
 * 内嵌 JSON 时必须切断 </script>，否则摘要里出现这个串会提前闭合脚本标签。
 * 同时转义 U+2028/2029，它们在 JS 字符串里是非法换行。
 */
function embedJson(value) {
  const stringified = JSON.stringify(value);
  return stringified
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function renderPage({ days, sources, status, generatedAt }) {
  const css = readTemplate('page.css');
  const logic = readTemplate('logic.js');
  const ui = readTemplate('ui.js');
  const data = embedJson({ days, sources, status, generatedAt });

  return `<title>AI 信源罗盘</title>
<style>
${css}
</style>

<div class="app">
  <header class="masthead">
    <h1>AI 信源罗盘</h1>
    <span class="stats" id="stats"></span>
    <div class="toolbar">
      <div class="filter-group" id="filters">
        <button data-filter="all" class="active">全部</button>
        <button data-filter="unread">未读</button>
        <button data-filter="starred">已标星</button>
      </div>
      <input type="search" id="search" class="search-box" placeholder="搜索标题或摘要…" aria-label="搜索" />
    </div>
  </header>

  <aside class="sidebar">
    <div class="side-section">
      <p class="side-label">最近 30 天</p>
      <div id="calendar"></div>
    </div>
    <div class="side-section">
      <p class="side-label">其他</p>
      <button class="view-btn" data-view="starred">★ 收藏</button>
      <button class="view-btn" data-view="sources">信源管理</button>
    </div>
  </aside>

  <main class="content">
    <div id="stream"></div>
    <div id="sources-view" class="hidden"></div>
  </main>
</div>

<script type="application/json" id="reader-data">${data}</script>
<script>
${logic}
${ui}
</script>
`;
}