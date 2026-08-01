import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TOOLS } from './vocab.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, '..', '..', 'templates', 'tinker');

/** 三个模板都是必需品：任缺其一都会产出一个能写盘但没样式/没交互的白页，且不报错。 */
function template(name) {
  return readFileSync(join(TEMPLATES, name), 'utf8');
}

/** 内嵌 JSON 必须切断 </script>，否则摘要里出现这个串会提前闭合脚本标签。 */
function embed(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    // U+2028/2029 在 JS 字符串字面量里是非法换行，中文内容偶尔会夹带这两个字符。
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function renderPage({ days, sources, status, generatedAt }) {
  const toolNames = Object.fromEntries(TOOLS.map((t) => [t.id, t.name]));
  const data = embed({ days, sources, status, toolNames, generatedAt });
  const total = days.reduce((n, d) => n + (d.items?.length ?? 0), 0);

  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent 折腾志</title>
<style>
${template('page.css')}
</style>

<div class="app">
  <header class="masthead">
    <h1 class="wordmark"><span class="prompt">$</span>Agent 折腾志</h1>
    <p class="tagline">中文圈里，人们真正把 Code / Work Agent 用起来时踩的坑、搭的流程、写的复盘。每天一批，只收个人实践，不收新闻稿。</p>
    <div class="masthead-meta">
      <span>${total} 篇</span>
      <span id="generated"></span>
      <button class="theme-toggle" id="theme" type="button">明 / 暗</button>
    </div>
  </header>

  <div class="frame">
    <aside class="rail">
      <div class="rail-block">
        <input type="search" id="search" class="view-btn" placeholder="搜索标题、摘要、作者…" aria-label="搜索">
        <div id="views"></div>
      </div>
      <div class="rail-block">
        <p class="rail-label">按工具</p>
        <div id="tools" class="tool-list"></div>
      </div>
      <div class="rail-block">
        <p class="rail-label">近 28 天</p>
        <div id="calendar" class="calendar"></div>
      </div>
    </aside>

    <main class="content">
      <div id="stream"></div>
      <div id="panel" class="panel hidden"></div>
    </main>
  </div>
</div>

<script type="application/json" id="tinker-data">${data}</script>
<script>
${template('logic.js')}
${template('ui.js')}
</script>
`;
}
