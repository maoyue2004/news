// 一次性脚本：从原 artifact 的 HTML 中提取 SOURCES 数组，转成 sources.json。
// 用完即可保留在仓库里作为数据来源的记录，但日常流程不会再跑它。
import { readFileSync, writeFileSync } from 'node:fs';

const ARTIFACT_HTML = process.argv[2];
if (!ARTIFACT_HTML) {
  console.error('用法: node scripts/extract-sources.mjs <artifact.html>');
  process.exit(1);
}

const html = readFileSync(ARTIFACT_HTML, 'utf8');
const start = html.indexOf('const SOURCES = [');
const end = html.indexOf('\n  ];', start);
if (start < 0 || end < 0) {
  console.error('在 HTML 中找不到 SOURCES 数组');
  process.exit(1);
}

const literal = html.slice(start, end + 5).replace(/^const SOURCES = /, '').replace(/;\s*$/, '');
// 这是我们自己生成的、来自本地文件的可信数据，用 Function 求值 JS 字面量。
const sources = new Function(`return ${literal}`)();

const out = sources.map((s) => ({
  name: s.name,
  url: s.url,
  feed: null,
  type: s.type,
  lang: s.lang,
  ...(s.seed ? { seed: true } : {}),
  enabled: true,
  desc: s.desc,
}));

writeFileSync('sources.json', JSON.stringify(out, null, 2) + '\n');
console.log(`已写入 sources.json，共 ${out.length} 条`);
