# AI 信源罗盘每日阅读器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把静态的「AI 信源罗盘」Artifact 改造成每日阅读器：每天自动抓取 97 个信源的新内容、生成中文摘要、重新发布到同一个 Artifact URL，页面支持 30 天回溯、已读打钩、标星收藏。

**Architecture:** 系统分两半。**离线半边**是每天北京时间 08:00 触发的云端 scheduled agent：`fetch.mjs` 并发抓 RSS/Atom 并与 `seen.json` 去重 → Claude 为新条目写中文标题和摘要 → `build.mjs` 把最近 30 天数据内嵌进自包含 HTML → 用 Artifact 工具以原 URL 重新发布。**在线半边**是页面自身，纯前端，已读/标星存 localStorage，不发任何网络请求（Artifact 的 CSP 禁止外部请求，这是整个架构分成两半的根本原因）。

**Tech Stack:** Node 24 (ESM)、`fast-xml-parser`（唯一运行时依赖）、内置 `node:test` 测试运行器、内置 `node:vm`（用于测试浏览器端纯函数）、`gh` CLI、Claude Code scheduled agent (routine)。

## Global Constraints

- Node ≥ 22，`package.json` 必须含 `"type": "module"`，所有脚本用 ESM。
- 唯一运行时依赖是 `fast-xml-parser`。测试用内置 `node:test` + `node:assert/strict`，**不引入任何测试框架**。
- 不引入 RSSHub 等第三方中转服务（spec「不做的事」明确排除）。
- 发布的页面必须完全自包含：CSS 和 JS 全部内联，不引用任何外部主机。Artifact 的 CSP 会拦截一切外部请求。
- 页面必须同时支持 `@media (prefers-color-scheme: dark)` 和 `:root[data-theme="dark"]` / `:root[data-theme="light"]`，且后者优先级更高。760px 以下折叠为单栏。
- 沿用原 artifact 的 CSS 变量名与取值：`--ink` `--paper` `--paper-raised` `--accent` `--accent-strong` `--accent-warm` `--line` `--muted` `--seed-bg` `--focus` `--shadow`。
- 所有面向用户的文案（页面文字、错误提示、commit message）用中文。
- Artifact 重新发布时必须传 `url: "https://claude.ai/code/artifact/24e0433d-3c33-4e84-8638-0c663708b9c9"`（保持链接不变）和 `favicon: "🧭"`（跨次发布保持不变）。
- git commit message 用中文，结尾附 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。
- 仓库已初始化，remote 为 `https://github.com/maoyue2004/news`（private），本地 git 身份已配 `maoyue2004` / `19606151+maoyue2004@users.noreply.github.com`。

## 数据格式约定（所有任务共享）

**`sources.json`** — 顶层是数组，每项：

```json
{
  "name": "Interconnects",
  "url": "https://www.interconnects.ai/",
  "feed": "https://www.interconnects.ai/feed",
  "type": "blog",
  "lang": "en",
  "seed": true,
  "enabled": true,
  "desc": "Nathan Lambert（前 HuggingFace / AI2 研究员）……"
}
```

`type` 取值固定为 `blog` / `newsletter` / `lab` / `media` / `community` / `podcast` / `video`。
`lang` 取值固定为 `en` / `zh`。`seed` 可选，缺省视为 `false`。
抓不到 feed 的源写 `"feed": null, "enabled": false, "disabledReason": "<中文原因>"`。

**`data/_pending.json`**（`fetch.mjs` 产出，Claude 消费，不提交到 git）：

```json
{
  "date": "2026-07-27",
  "items": [
    {
      "id": "a1b2c3d4e5f6a7b8",
      "source": "Interconnects",
      "type": "blog",
      "lang": "en",
      "url": "https://www.interconnects.ai/p/reward-hacking",
      "titleOriginal": "Reward hacking in RL environments",
      "publishedAt": "2026-07-26T18:00:00.000Z",
      "excerpt": "正文前 2000 字纯文本…",
      "brief": false
    }
  ],
  "errors": [{ "source": "Epoch AI", "message": "HTTP 503" }]
}
```

`brief: true` 表示该条来自播客或视频，`excerpt` 是官方简介而非正文。

**`data/YYYY-MM-DD.json`**（Claude 写入，`build.mjs` 消费，提交到 git）：
在 `_pending.json` 每个 item 的基础上增加 `titleZh` 和 `summaryZh` 两个字段，
并去掉 `excerpt` 字段。顶层增加 `"generatedAt": "<ISO 时间戳>"`。

**`data/seen.json`** — `{ "<itemId>": "YYYY-MM-DD" }`，值是首次见到的日期，保留 45 天。

**`data/status.json`** — `{ "<sourceName>": { "lastSuccess": "<ISO或null>", "lastError": "<ISO或null>", "lastErrorMessage": "<string或null>", "consecutiveFailures": 0 } }`

---

### Task 1: 项目骨架与 sources.json

**Files:**
- Create: `package.json`
- Create: `sources.json`
- Create: `scripts/extract-sources.mjs`

**Interfaces:**
- Consumes: 无
- Produces: `sources.json`（97 条，全部带 `enabled` 字段，`feed` 暂为 `null`），供 Task 4/6 使用

原 artifact 的 HTML 已抓取并保存在
`/Users/yuemao/.claude/projects/-Users-yuemao-workspace-news/40c226f5-c9b7-42ff-84db-092809629985/tool-results/artifact-24e0433d-1785148623-fc35.html`，
其中的 `const SOURCES = [...]` 数组是 97 条信源的原始数据。本任务把它转成 `sources.json`。

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "ai-news-reader",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "node --test test/",
    "fetch": "node scripts/fetch.mjs",
    "build": "node scripts/build.mjs"
  },
  "dependencies": {
    "fast-xml-parser": "^4.5.0"
  }
}
```

- [ ] **Step 2: 安装依赖并确认只有一个依赖树**

Run: `npm install && node -e "console.log(Object.keys(require('./package-lock.json').packages).length)"`
Expected: 安装成功，`node_modules/fast-xml-parser` 存在。`fast-xml-parser` 只有一个传递依赖 `strnum`，这是预期的。

- [ ] **Step 3: 写提取脚本**

Create `scripts/extract-sources.mjs`：

```js
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
```

- [ ] **Step 4: 运行提取脚本**

Run:
```bash
node scripts/extract-sources.mjs "/Users/yuemao/.claude/projects/-Users-yuemao-workspace-news/40c226f5-c9b7-42ff-84db-092809629985/tool-results/artifact-24e0433d-1785148623-fc35.html"
```
Expected: 输出「已写入 sources.json，共 97 条」

- [ ] **Step 5: 校验数据完整性**

Run:
```bash
node -e '
const s = JSON.parse(require("fs").readFileSync("sources.json","utf8"));
const t = {}; s.forEach(x => t[x.type] = (t[x.type]||0)+1);
console.log("总数", s.length);
console.log(t);
console.log("有 seed 的", s.filter(x=>x.seed).length);
console.log("字段齐全", s.every(x => x.name && x.url && x.type && x.lang && x.desc && "feed" in x && "enabled" in x));
'
```
Expected:
```
总数 97
{ blog: 24, newsletter: 13, podcast: 24, video: 10, community: 3, lab: 11, media: 12 }
有 seed 的 2
字段齐全 true
```

- [ ] **Step 6: 提交**

```bash
git add package.json package-lock.json sources.json scripts/extract-sources.mjs
git commit -m "信源数据：从原 artifact 提取 97 条信源为 sources.json

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Feed 解析库

**Files:**
- Create: `lib/feed-parse.mjs`
- Test: `test/feed-parse.test.mjs`

**Interfaces:**
- Consumes: `fast-xml-parser` 的 `XMLParser`
- Produces: `parseFeed(xml: string) => { items: FeedItem[] }`，
  其中 `FeedItem = { title: string, link: string, publishedAt: string|null, contentHtml: string }`。
  `publishedAt` 是 ISO 8601 字符串或 `null`。抛 `Error` 表示无法识别的格式。
  Task 4 和 Task 6 都依赖这个函数。

- [ ] **Step 1: 写失败的测试**

Create `test/feed-parse.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from '../lib/feed-parse.mjs';

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example Blog</title>
    <item>
      <title>Reward hacking in RL</title>
      <link>https://example.com/p/reward-hacking</link>
      <pubDate>Sat, 26 Jul 2026 18:00:00 GMT</pubDate>
      <description>Short blurb</description>
      <content:encoded><![CDATA[<p>Full <b>body</b> text</p>]]></content:encoded>
    </item>
    <item>
      <title>Second post</title>
      <link>https://example.com/p/second</link>
      <pubDate>Fri, 25 Jul 2026 09:30:00 GMT</pubDate>
      <description>Only a description</description>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom</title>
  <entry>
    <title>Atom entry title</title>
    <link rel="alternate" type="text/html" href="https://example.com/atom-1"/>
    <link rel="edit" href="https://example.com/edit/atom-1"/>
    <published>2026-07-26T12:00:00Z</published>
    <content type="html">&lt;p&gt;Atom body&lt;/p&gt;</content>
  </entry>
</feed>`;

const YOUTUBE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Some video title</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
    <published>2026-07-27T04:00:00+00:00</published>
    <media:group>
      <media:description>Video description here</media:description>
    </media:group>
  </entry>
</feed>`;

test('解析 RSS 2.0：取 content:encoded 作为正文', () => {
  const { items } = parseFeed(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Reward hacking in RL');
  assert.equal(items[0].link, 'https://example.com/p/reward-hacking');
  assert.equal(items[0].publishedAt, '2026-07-26T18:00:00.000Z');
  assert.match(items[0].contentHtml, /Full <b>body<\/b> text/);
});

test('解析 RSS 2.0：没有 content:encoded 时回退到 description', () => {
  const { items } = parseFeed(RSS);
  assert.equal(items[1].contentHtml, 'Only a description');
});

test('解析 Atom：link 取 rel=alternate 那一个', () => {
  const { items } = parseFeed(ATOM);
  assert.equal(items.length, 1);
  assert.equal(items[0].link, 'https://example.com/atom-1');
  assert.equal(items[0].publishedAt, '2026-07-26T12:00:00.000Z');
  assert.match(items[0].contentHtml, /Atom body/);
});

test('解析 YouTube Atom：正文取 media:description', () => {
  const { items } = parseFeed(YOUTUBE);
  assert.equal(items[0].link, 'https://www.youtube.com/watch?v=abc123');
  assert.equal(items[0].contentHtml, 'Video description here');
});

test('日期无法解析时 publishedAt 为 null', () => {
  const xml = `<rss version="2.0"><channel><item>
    <title>T</title><link>https://e.com/x</link><pubDate>not a date</pubDate>
  </item></channel></rss>`;
  const { items } = parseFeed(xml);
  assert.equal(items[0].publishedAt, null);
});

test('无法识别的格式抛错', () => {
  assert.throws(() => parseFeed('<html><body>not a feed</body></html>'), /无法识别/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/feed-parse.test.mjs`
Expected: FAIL，报错 `Cannot find module '../lib/feed-parse.mjs'`

- [ ] **Step 3: 实现 lib/feed-parse.mjs**

```js
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  trimValues: true,
  // 保留 CDATA 与实体解码后的文本
  processEntities: true,
});

function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** fast-xml-parser 在有属性时把文本放进 '#text'，这里统一取出字符串。 */
function text(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object' && '#text' in v) return String(v['#text']);
  return '';
}

function toIso(raw) {
  const s = text(raw).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseRss(channel) {
  const items = asArray(channel.item).map((it) => ({
    title: text(it.title),
    link: text(it.link),
    publishedAt: toIso(it.pubDate ?? it['dc:date']),
    contentHtml: text(it['content:encoded']) || text(it.description),
  }));
  return { items };
}

function pickAtomLink(link) {
  const links = asArray(link);
  const alternate = links.find((l) => typeof l === 'object' && l['@rel'] === 'alternate');
  const chosen = alternate ?? links.find((l) => typeof l === 'object' && !l['@rel']) ?? links[0];
  if (!chosen) return '';
  return typeof chosen === 'object' ? String(chosen['@href'] ?? '') : String(chosen);
}

function parseAtom(feed) {
  const items = asArray(feed.entry).map((en) => ({
    title: text(en.title),
    link: pickAtomLink(en.link),
    publishedAt: toIso(en.published ?? en.updated),
    contentHtml:
      text(en.content) ||
      text(en.summary) ||
      text(en['media:group']?.['media:description']),
  }));
  return { items };
}

export function parseFeed(xml) {
  const doc = parser.parse(xml);
  if (doc?.rss?.channel) return parseRss(doc.rss.channel);
  if (doc?.feed) return parseAtom(doc.feed);
  if (doc?.['rdf:RDF']) {
    // RSS 1.0 / RDF：item 在顶层而非 channel 下
    return parseRss(doc['rdf:RDF']);
  }
  throw new Error('无法识别的 feed 格式');
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/feed-parse.test.mjs`
Expected: PASS，6 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add lib/feed-parse.mjs test/feed-parse.test.mjs
git commit -m "feed 解析：支持 RSS 2.0 / Atom / YouTube Atom

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: HTML 转文本与条目指纹

**Files:**
- Create: `lib/html-text.mjs`
- Create: `lib/fingerprint.mjs`
- Test: `test/html-text.test.mjs`
- Test: `test/fingerprint.test.mjs`

**Interfaces:**
- Consumes: 无（只用 Node 内置模块）
- Produces:
  - `htmlToText(html: string, maxChars?: number) => string`（`maxChars` 缺省 2000）
  - `itemId(url: string) => string`（16 位十六进制），Task 6 用它生成 id，
    页面直接读 JSON 里已算好的 id，浏览器端不重算。

- [ ] **Step 1: 写失败的测试**

Create `test/html-text.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText } from '../lib/html-text.mjs';

test('去掉标签保留文字', () => {
  assert.equal(htmlToText('<p>Hello <b>world</b></p>'), 'Hello world');
});

test('去掉 script 和 style 的内容', () => {
  assert.equal(
    htmlToText('<p>keep</p><script>var x = 1;</script><style>.a{color:red}</style>'),
    'keep',
  );
});

test('解码常见实体', () => {
  assert.equal(htmlToText('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &nbsp;f'), 'a & b <c> "d" \'e\' f');
});

test('合并空白', () => {
  assert.equal(htmlToText('<p>a</p>\n\n\n   <p>b</p>'), 'a b');
});

test('按 maxChars 截断', () => {
  const long = '<p>' + 'x'.repeat(3000) + '</p>';
  assert.equal(htmlToText(long, 100).length, 100);
});

test('空输入返回空串', () => {
  assert.equal(htmlToText(''), '');
  assert.equal(htmlToText(null), '');
  assert.equal(htmlToText(undefined), '');
});
```

Create `test/fingerprint.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemId } from '../lib/fingerprint.mjs';

test('同一 URL 得到同一 id', () => {
  assert.equal(itemId('https://example.com/a'), itemId('https://example.com/a'));
});

test('id 是 16 位十六进制', () => {
  assert.match(itemId('https://example.com/a'), /^[0-9a-f]{16}$/);
});

test('不同 URL 得到不同 id', () => {
  assert.notEqual(itemId('https://example.com/a'), itemId('https://example.com/b'));
});

test('忽略末尾斜杠、大小写主机名、hash 与 utm 参数', () => {
  const base = itemId('https://example.com/a');
  assert.equal(itemId('https://example.com/a/'), base);
  assert.equal(itemId('https://EXAMPLE.com/a'), base);
  assert.equal(itemId('https://example.com/a#section'), base);
  assert.equal(itemId('https://example.com/a?utm_source=rss&utm_medium=feed'), base);
});

test('保留非 utm 的查询参数', () => {
  assert.notEqual(itemId('https://example.com/a?id=1'), itemId('https://example.com/a'));
});

test('无法解析为 URL 时对原始字符串做哈希，不抛错', () => {
  assert.match(itemId('not a url'), /^[0-9a-f]{16}$/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/html-text.test.mjs test/fingerprint.test.mjs`
Expected: FAIL，两个 `Cannot find module` 错误

- [ ] **Step 3: 实现两个库**

Create `lib/html-text.mjs`：

```js
const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
};

function decodeEntities(s) {
  return s
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|mdash|ndash|hellip|rsquo|lsquo|ldquo|rdquo|#39);/g,
      (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

/**
 * 把 feed 里的 HTML 正文压成纯文本，供 Claude 写摘要用。
 * 不追求排版保真，只要求语义完整、无标签噪声。
 */
export function htmlToText(html, maxChars = 2000) {
  if (!html) return '';
  const text = String(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ');
  const cleaned = decodeEntities(text).replace(/\s+/g, ' ').trim();
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars) : cleaned;
}
```

Create `lib/fingerprint.mjs`：

```js
import { createHash } from 'node:crypto';

/**
 * 把 URL 归一化后哈希成稳定 id。
 * 归一化是为了让同一篇文章在 feed 里换了追踪参数或末尾斜杠后仍被认成同一条，
 * 否则去重会失效、已读状态也会丢。
 */
function normalize(url) {
  try {
    const u = new URL(String(url));
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    for (const key of [...u.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || key.toLowerCase() === 'ref') {
        u.searchParams.delete(key);
      }
    }
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return String(url);
  }
}

export function itemId(url) {
  return createHash('sha256').update(normalize(url)).digest('hex').slice(0, 16);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/html-text.test.mjs test/fingerprint.test.mjs`
Expected: PASS，12 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add lib/html-text.mjs lib/fingerprint.mjs test/html-text.test.mjs test/fingerprint.test.mjs
git commit -m "工具库：HTML 转纯文本、URL 归一化指纹

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Feed 探测脚本并填充 sources.json

**Files:**
- Create: `scripts/discover-feeds.mjs`
- Modify: `sources.json`（填入 `feed` 与 `enabled`/`disabledReason`）
- Test: `test/discover-feeds.test.mjs`

**Interfaces:**
- Consumes: `parseFeed`（Task 2）
- Produces: 填好 `feed` 字段的 `sources.json`，Task 6 的 `fetch.mjs` 直接读它

这是**一次性的探测任务**，但脚本保留在仓库里，将来新增信源时可以重跑。
纯函数 `candidateFeedUrls` 和 `youtubeFeedUrl` 要单测；整体探测过程走真实网络，靠人工审阅结果。

已知会探测失败的 18 个源（微信公众号搜狗搜索页、知乎搜索页、Apple Podcasts 搜索页），
它们会被标成 `enabled: false`。这是预期结果，不是 bug。

- [ ] **Step 1: 写失败的测试**

Create `test/discover-feeds.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateFeedUrls, youtubeChannelIdFromHtml, isUndiscoverable } from '../scripts/discover-feeds.mjs';

test('生成常见 feed 路径候选', () => {
  const c = candidateFeedUrls('https://example.com/');
  assert.ok(c.includes('https://example.com/feed'));
  assert.ok(c.includes('https://example.com/rss'));
  assert.ok(c.includes('https://example.com/atom.xml'));
  assert.ok(c.includes('https://example.com/index.xml'));
  assert.ok(c.includes('https://example.com/feed.xml'));
});

test('带子路径的站点同时试子路径和站点根', () => {
  const c = candidateFeedUrls('https://epoch.ai/blog');
  assert.ok(c.includes('https://epoch.ai/blog/feed'));
  assert.ok(c.includes('https://epoch.ai/feed'));
});

test('从 YouTube 频道页 HTML 中提取 channelId', () => {
  const html = '<meta itemprop="identifier" content="UC1234567890abcdefghijkl">';
  assert.equal(youtubeChannelIdFromHtml(html), 'UC1234567890abcdefghijkl');
});

test('从 externalId 形式的 YouTube HTML 中提取 channelId', () => {
  const html = '{"externalId":"UCabcdefghijklmnopqrstuv","other":1}';
  assert.equal(youtubeChannelIdFromHtml(html), 'UCabcdefghijklmnopqrstuv');
});

test('提取不到时返回 null', () => {
  assert.equal(youtubeChannelIdFromHtml('<html>nothing</html>'), null);
});

test('识别出天然没有 feed 的搜索页链接', () => {
  assert.ok(isUndiscoverable('https://weixin.sogou.com/weixin?type=1&query=x'));
  assert.ok(isUndiscoverable('https://www.zhihu.com/search?q=x'));
  assert.ok(isUndiscoverable('https://podcasts.apple.com/us/search?term=x'));
  assert.equal(isUndiscoverable('https://simonwillison.net/'), false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/discover-feeds.test.mjs`
Expected: FAIL，`Cannot find module '../scripts/discover-feeds.mjs'`

- [ ] **Step 3: 实现 scripts/discover-feeds.mjs**

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { parseFeed } from '../lib/feed-parse.mjs';

const UA = 'Mozilla/5.0 (compatible; ai-news-reader/1.0; +https://github.com/maoyue2004/news)';
const TIMEOUT_MS = 15000;

/** 这些链接指向搜索结果页，本身不是内容站点，不存在 feed。 */
export function isUndiscoverable(url) {
  return /weixin\.sogou\.com|zhihu\.com\/search|podcasts\.apple\.com\/.*\/search/.test(url);
}

export function candidateFeedUrls(siteUrl) {
  const paths = ['feed', 'rss', 'rss.xml', 'feed.xml', 'atom.xml', 'index.xml', 'feed/'];
  const out = [];
  let u;
  try {
    u = new URL(siteUrl);
  } catch {
    return out;
  }
  const base = u.origin + u.pathname.replace(/\/$/, '');
  const root = u.origin;
  for (const p of paths) out.push(`${base}/${p}`);
  if (base !== root) for (const p of paths) out.push(`${root}/${p}`);
  return [...new Set(out)];
}

export function youtubeChannelIdFromHtml(html) {
  const meta = html.match(/itemprop="identifier"\s+content="(UC[\w-]{20,})"/);
  if (meta) return meta[1];
  const ext = html.match(/"externalId"\s*:\s*"(UC[\w-]{20,})"/);
  if (ext) return ext[1];
  const canonical = html.match(/channel\/(UC[\w-]{20,})/);
  if (canonical) return canonical[1];
  return null;
}

async function get(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

/** 从站点 HTML 的 <link rel="alternate"> 里读官方声明的 feed 地址。这是最可靠的一条路。 */
function declaredFeedFromHtml(html, baseUrl) {
  const re = /<link\b[^>]*>/gi;
  for (const tag of html.match(re) ?? []) {
    if (!/rel=["']?alternate/i.test(tag)) continue;
    if (!/type=["'](application\/(rss|atom)\+xml)["']/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i);
    if (href) {
      try {
        return new URL(href[1], baseUrl).toString();
      } catch {
        /* 忽略无法解析的相对地址 */
      }
    }
  }
  return null;
}

async function verifyFeed(url) {
  const xml = await get(url);
  const { items } = parseFeed(xml);
  if (items.length === 0) throw new Error('feed 里没有条目');
  return items.length;
}

async function discoverOne(source) {
  if (isUndiscoverable(source.url)) {
    return { feed: null, reason: '链接指向搜索结果页，不是内容站点，没有可用 feed' };
  }

  // YouTube 频道：从频道页解析 channelId，再拼官方 feed。
  if (/youtube\.com\/@/.test(source.url)) {
    const html = await get(source.url);
    const id = youtubeChannelIdFromHtml(html);
    if (!id) return { feed: null, reason: '无法从 YouTube 频道页解析出 channelId' };
    const feed = `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
    await verifyFeed(feed);
    return { feed, reason: null };
  }

  // 先看站点自己声明的 feed。
  try {
    const html = await get(source.url);
    const declared = declaredFeedFromHtml(html, source.url);
    if (declared) {
      await verifyFeed(declared);
      return { feed: declared, reason: null };
    }
  } catch {
    /* 站点首页拿不到也不要紧，继续试常见路径 */
  }

  for (const candidate of candidateFeedUrls(source.url)) {
    try {
      await verifyFeed(candidate);
      return { feed: candidate, reason: null };
    } catch {
      /* 试下一个 */
    }
  }
  return { feed: null, reason: '试遍常见 feed 路径均未找到可用 feed' };
}

async function main() {
  const sources = JSON.parse(readFileSync('sources.json', 'utf8'));
  const results = [];
  const CONCURRENCY = 8;

  for (let i = 0; i < sources.length; i += CONCURRENCY) {
    const batch = sources.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (s) => {
        try {
          return { source: s, ...(await discoverOne(s)) };
        } catch (err) {
          return { source: s, feed: null, reason: `探测出错：${err.message}` };
        }
      }),
    );
    results.push(...settled);
    console.error(`已探测 ${Math.min(i + CONCURRENCY, sources.length)}/${sources.length}`);
  }

  const updated = results.map(({ source, feed, reason }) =>
    feed
      ? { ...source, feed, enabled: true }
      : { ...source, feed: null, enabled: false, disabledReason: reason },
  );

  writeFileSync('sources.json', JSON.stringify(updated, null, 2) + '\n');

  const ok = updated.filter((s) => s.enabled);
  console.log(`\n可抓取 ${ok.length} / ${updated.length}`);
  console.log('\n--- 未找到 feed ---');
  for (const s of updated.filter((s) => !s.enabled)) {
    console.log(`  ${s.name}  (${s.type}/${s.lang})  — ${s.disabledReason}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/discover-feeds.test.mjs`
Expected: PASS，6 个测试全绿

- [ ] **Step 5: 真实跑一遍探测**

Run: `node scripts/discover-feeds.mjs`
Expected: 输出进度，最后打印可抓取数量和未找到 feed 的清单。
预计可抓取 75-85 个；未找到的应当包含那 18 个搜索页链接的源
（数字生命卡兹克、宝玉xp、karminski-牙医、海辛Hyacinth、归藏的AI工具箱、
海外独角兽、AI科技评论，以及 11 个 Apple Podcasts 搜索页的中文播客）。

- [ ] **Step 6: 人工审阅探测结果**

Run: `node -e '
const s = JSON.parse(require("fs").readFileSync("sources.json","utf8"));
console.log("启用", s.filter(x=>x.enabled).length, "/ 停用", s.filter(x=>!x.enabled).length);
console.log("\n启用的源与 feed：");
s.filter(x=>x.enabled).forEach(x=>console.log("  ", x.name, "→", x.feed));
'`

逐条看一遍启用的 feed 地址是否合理。重点检查：
- feed 地址的域名应当与信源官网同域（YouTube 源除外，它们指向 `youtube.com/feeds/videos.xml`）。
- 若某个源探测到的是站点的评论 feed（地址里含 `comments`），手工改成正文 feed 或标为停用。

若发现明显错误，手工修正 `sources.json` 中对应条目。

- [ ] **Step 7: 提交**

```bash
git add scripts/discover-feeds.mjs test/discover-feeds.test.mjs sources.json
git commit -m "feed 探测：自动发现各信源的 RSS 地址并标注无 feed 的源

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 数据存储层

**Files:**
- Create: `lib/store.mjs`
- Test: `test/store.test.mjs`

**Interfaces:**
- Consumes: 无（只用 Node 内置模块）
- Produces:
  - `loadSeen(dataDir) => Record<string, string>`
  - `saveSeen(dataDir, seen, today) => void`（写入前裁掉早于 `today` 45 天的条目）
  - `loadStatus(dataDir) => Record<string, SourceStatus>`
  - `saveStatus(dataDir, status) => void`
  - `recordSuccess(status, sourceName, nowIso) => void`（原地修改）
  - `recordFailure(status, sourceName, nowIso, message) => void`（原地修改）
  - `saveDay(dataDir, date, payload) => void`
  - `loadRecentDays(dataDir, today, n) => DayFile[]`（按日期倒序，缺失的日期跳过）
  - `pruneDayFiles(dataDir, today, keepDays) => string[]`（返回被删掉的文件名）

  `SourceStatus = { lastSuccess: string|null, lastError: string|null, lastErrorMessage: string|null, consecutiveFailures: number }`
  Task 6（fetch）和 Task 9（build）都依赖这些函数。

- [ ] **Step 1: 写失败的测试**

Create `test/store.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadSeen, saveSeen, loadStatus, saveStatus,
  recordSuccess, recordFailure,
  saveDay, loadRecentDays, pruneDayFiles,
} from '../lib/store.mjs';

function tmp() {
  return mkdtempSync(join(tmpdir(), 'news-store-'));
}

test('seen 文件不存在时返回空对象', () => {
  assert.deepEqual(loadSeen(tmp()), {});
});

test('seen 写入后能读回', () => {
  const d = tmp();
  saveSeen(d, { abc: '2026-07-27' }, '2026-07-27');
  assert.deepEqual(loadSeen(d), { abc: '2026-07-27' });
});

test('seen 裁掉超过 45 天的条目', () => {
  const d = tmp();
  saveSeen(d, { old: '2026-01-01', fresh: '2026-07-20' }, '2026-07-27');
  const got = loadSeen(d);
  assert.equal('old' in got, false);
  assert.equal(got.fresh, '2026-07-20');
});

test('seen 保留刚好 45 天前的条目', () => {
  const d = tmp();
  saveSeen(d, { edge: '2026-06-12' }, '2026-07-27'); // 相隔 45 天
  assert.ok('edge' in loadSeen(d));
});

test('status 记录成功会清零连续失败次数', () => {
  const status = { A: { lastSuccess: null, lastError: '2026-07-26T00:00:00.000Z', lastErrorMessage: 'boom', consecutiveFailures: 3 } };
  recordSuccess(status, 'A', '2026-07-27T00:00:00.000Z');
  assert.equal(status.A.consecutiveFailures, 0);
  assert.equal(status.A.lastSuccess, '2026-07-27T00:00:00.000Z');
});

test('status 记录失败会累加连续失败次数', () => {
  const status = {};
  recordFailure(status, 'B', '2026-07-27T00:00:00.000Z', 'HTTP 503');
  recordFailure(status, 'B', '2026-07-28T00:00:00.000Z', 'HTTP 503');
  assert.equal(status.B.consecutiveFailures, 2);
  assert.equal(status.B.lastErrorMessage, 'HTTP 503');
  assert.equal(status.B.lastSuccess, null);
});

test('status 写入后能读回', () => {
  const d = tmp();
  const status = {};
  recordSuccess(status, 'A', '2026-07-27T00:00:00.000Z');
  saveStatus(d, status);
  assert.equal(loadStatus(d).A.consecutiveFailures, 0);
});

test('saveDay 与 loadRecentDays 按日期倒序返回', () => {
  const d = tmp();
  saveDay(d, '2026-07-25', { date: '2026-07-25', items: [], errors: [] });
  saveDay(d, '2026-07-27', { date: '2026-07-27', items: [], errors: [] });
  const days = loadRecentDays(d, '2026-07-27', 30);
  assert.deepEqual(days.map((x) => x.date), ['2026-07-27', '2026-07-25']);
});

test('loadRecentDays 只看窗口内的日期', () => {
  const d = tmp();
  saveDay(d, '2026-07-27', { date: '2026-07-27', items: [], errors: [] });
  saveDay(d, '2026-05-01', { date: '2026-05-01', items: [], errors: [] });
  const days = loadRecentDays(d, '2026-07-27', 30);
  assert.deepEqual(days.map((x) => x.date), ['2026-07-27']);
});

test('pruneDayFiles 删掉窗口外的日文件并返回文件名', () => {
  const d = tmp();
  saveDay(d, '2026-07-27', { date: '2026-07-27', items: [], errors: [] });
  saveDay(d, '2026-05-01', { date: '2026-05-01', items: [], errors: [] });
  const removed = pruneDayFiles(d, '2026-07-27', 35);
  assert.deepEqual(removed, ['2026-05-01.json']);
  assert.equal(existsSync(join(d, '2026-05-01.json')), false);
  assert.equal(existsSync(join(d, '2026-07-27.json')), true);
});

test('pruneDayFiles 不碰 seen.json 和 status.json', () => {
  const d = tmp();
  writeFileSync(join(d, 'seen.json'), '{}');
  writeFileSync(join(d, 'status.json'), '{}');
  pruneDayFiles(d, '2026-07-27', 35);
  assert.equal(existsSync(join(d, 'seen.json')), true);
  assert.equal(existsSync(join(d, 'status.json')), true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/store.test.mjs`
Expected: FAIL，`Cannot find module '../lib/store.mjs'`

- [ ] **Step 3: 实现 lib/store.mjs**

```js
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const SEEN_KEEP_DAYS = 45;

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function daysBetween(fromDate, toDate) {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export function loadSeen(dataDir) {
  return readJson(join(dataDir, 'seen.json'), {});
}

export function saveSeen(dataDir, seen, today) {
  const kept = {};
  for (const [id, firstDate] of Object.entries(seen)) {
    if (daysBetween(firstDate, today) <= SEEN_KEEP_DAYS) kept[id] = firstDate;
  }
  writeJson(join(dataDir, 'seen.json'), kept);
}

export function loadStatus(dataDir) {
  return readJson(join(dataDir, 'status.json'), {});
}

export function saveStatus(dataDir, status) {
  writeJson(join(dataDir, 'status.json'), status);
}

function ensureEntry(status, name) {
  if (!status[name]) {
    status[name] = { lastSuccess: null, lastError: null, lastErrorMessage: null, consecutiveFailures: 0 };
  }
  return status[name];
}

export function recordSuccess(status, sourceName, nowIso) {
  const e = ensureEntry(status, sourceName);
  e.lastSuccess = nowIso;
  e.consecutiveFailures = 0;
}

export function recordFailure(status, sourceName, nowIso, message) {
  const e = ensureEntry(status, sourceName);
  e.lastError = nowIso;
  e.lastErrorMessage = message;
  e.consecutiveFailures += 1;
}

export function saveDay(dataDir, date, payload) {
  writeJson(join(dataDir, `${date}.json`), payload);
}

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

export function loadRecentDays(dataDir, today, n) {
  if (!existsSync(dataDir)) return [];
  return readdirSync(dataDir)
    .map((f) => DAY_FILE.exec(f))
    .filter(Boolean)
    .map((m) => m[1])
    .filter((date) => {
      const diff = daysBetween(date, today);
      return diff >= 0 && diff < n;
    })
    .sort()
    .reverse()
    .map((date) => readJson(join(dataDir, `${date}.json`), null))
    .filter(Boolean);
}

export function pruneDayFiles(dataDir, today, keepDays) {
  if (!existsSync(dataDir)) return [];
  const removed = [];
  for (const f of readdirSync(dataDir)) {
    const m = DAY_FILE.exec(f);
    if (!m) continue;
    if (daysBetween(m[1], today) >= keepDays) {
      unlinkSync(join(dataDir, f));
      removed.push(f);
    }
  }
  return removed.sort();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/store.test.mjs`
Expected: PASS，11 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add lib/store.mjs test/store.test.mjs
git commit -m "存储层：seen 去重、源状态追踪、日文件读写与保留期裁剪

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 抓取脚本

**Files:**
- Create: `lib/collect.mjs`
- Create: `scripts/fetch.mjs`
- Test: `test/collect.test.mjs`

**Interfaces:**
- Consumes: `parseFeed`（Task 2）、`htmlToText` 与 `itemId`（Task 3）、`lib/store.mjs`（Task 5）
- Produces:
  - `collectFromFeed({ source, xml, seen, today, now }) => { items: PendingItem[] }`
    纯函数，不发网络请求，方便单测。
  - `scripts/fetch.mjs` 写出 `data/_pending.json`，更新 `data/seen.json` 与 `data/status.json`

把「解析 + 过滤 + 组装」抽成纯函数 `collectFromFeed`，
网络 IO 留在 `scripts/fetch.mjs` 里，这样核心逻辑可以完全靠单测覆盖。

- [ ] **Step 1: 写失败的测试**

Create `test/collect.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectFromFeed } from '../lib/collect.mjs';

const blogSource = {
  name: 'Example Blog', url: 'https://example.com/', feed: 'https://example.com/feed',
  type: 'blog', lang: 'en', enabled: true, desc: 'x',
};

const podcastSource = { ...blogSource, name: 'Example Pod', type: 'podcast' };

function rss(items) {
  return `<rss version="2.0"><channel>${items}</channel></rss>`;
}

const ITEM_FRESH = `<item>
  <title>Fresh post</title><link>https://example.com/p/fresh</link>
  <pubDate>Mon, 27 Jul 2026 06:00:00 GMT</pubDate>
  <description><![CDATA[<p>Body of the fresh post</p>]]></description>
</item>`;

const ITEM_OLD = `<item>
  <title>Ancient post</title><link>https://example.com/p/ancient</link>
  <pubDate>Mon, 01 Jan 2024 06:00:00 GMT</pubDate>
  <description>old</description>
</item>`;

const TODAY = '2026-07-27';
const NOW = '2026-07-27T08:00:00.000Z';

test('抓出未见过的新条目', () => {
  const { items } = collectFromFeed({ source: blogSource, xml: rss(ITEM_FRESH), seen: {}, today: TODAY, now: NOW });
  assert.equal(items.length, 1);
  assert.equal(items[0].titleOriginal, 'Fresh post');
  assert.equal(items[0].source, 'Example Blog');
  assert.equal(items[0].type, 'blog');
  assert.equal(items[0].lang, 'en');
  assert.equal(items[0].excerpt, 'Body of the fresh post');
  assert.equal(items[0].brief, false);
  assert.match(items[0].id, /^[0-9a-f]{16}$/);
});

test('已在 seen 里的条目被跳过', () => {
  const first = collectFromFeed({ source: blogSource, xml: rss(ITEM_FRESH), seen: {}, today: TODAY, now: NOW });
  const seen = { [first.items[0].id]: '2026-07-26' };
  const second = collectFromFeed({ source: blogSource, xml: rss(ITEM_FRESH), seen, today: TODAY, now: NOW });
  assert.equal(second.items.length, 0);
});

test('超过 14 天的老条目被跳过，避免首次运行灌进几百条历史', () => {
  const { items } = collectFromFeed({ source: blogSource, xml: rss(ITEM_OLD), seen: {}, today: TODAY, now: NOW });
  assert.equal(items.length, 0);
});

test('播客与视频条目标记 brief', () => {
  const { items } = collectFromFeed({ source: podcastSource, xml: rss(ITEM_FRESH), seen: {}, today: TODAY, now: NOW });
  assert.equal(items[0].brief, true);
});

test('没有发布时间的条目按当前时间收下', () => {
  const noDate = `<item><title>No date</title><link>https://example.com/p/nd</link><description>d</description></item>`;
  const { items } = collectFromFeed({ source: blogSource, xml: rss(noDate), seen: {}, today: TODAY, now: NOW });
  assert.equal(items.length, 1);
  assert.equal(items[0].publishedAt, NOW);
});

test('没有链接的条目被丢弃', () => {
  const noLink = `<item><title>No link</title><pubDate>Mon, 27 Jul 2026 06:00:00 GMT</pubDate></item>`;
  const { items } = collectFromFeed({ source: blogSource, xml: rss(noLink), seen: {}, today: TODAY, now: NOW });
  assert.equal(items.length, 0);
});

test('同一次抓取里重复的链接只保留一条', () => {
  const { items } = collectFromFeed({ source: blogSource, xml: rss(ITEM_FRESH + ITEM_FRESH), seen: {}, today: TODAY, now: NOW });
  assert.equal(items.length, 1);
});

test('excerpt 截断在 2000 字以内', () => {
  const long = `<item><title>L</title><link>https://example.com/p/l</link>
    <pubDate>Mon, 27 Jul 2026 06:00:00 GMT</pubDate>
    <description>${'x'.repeat(5000)}</description></item>`;
  const { items } = collectFromFeed({ source: blogSource, xml: rss(long), seen: {}, today: TODAY, now: NOW });
  assert.equal(items[0].excerpt.length, 2000);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/collect.test.mjs`
Expected: FAIL，`Cannot find module '../lib/collect.mjs'`

- [ ] **Step 3: 实现 lib/collect.mjs**

```js
import { parseFeed } from './feed-parse.mjs';
import { htmlToText } from './html-text.mjs';
import { itemId } from './fingerprint.mjs';

/** 首次运行时不把 feed 里的全部历史都灌进来，只收最近这些天发布的。 */
const MAX_AGE_DAYS = 14;
const EXCERPT_CHARS = 2000;
const BRIEF_TYPES = new Set(['podcast', 'video']);

export function collectFromFeed({ source, xml, seen, today, now }) {
  const { items: raw } = parseFeed(xml);
  const brief = BRIEF_TYPES.has(source.type);
  const cutoff = Date.parse(`${today}T00:00:00Z`) - MAX_AGE_DAYS * 86400000;

  const out = [];
  const seenThisRun = new Set();

  for (const it of raw) {
    if (!it.link) continue;

    const publishedAt = it.publishedAt ?? now;
    if (Date.parse(publishedAt) < cutoff) continue;

    const id = itemId(it.link);
    if (seen[id] || seenThisRun.has(id)) continue;
    seenThisRun.add(id);

    out.push({
      id,
      source: source.name,
      type: source.type,
      lang: source.lang,
      url: it.link,
      titleOriginal: it.title || '(无标题)',
      publishedAt,
      excerpt: htmlToText(it.contentHtml, EXCERPT_CHARS),
      brief,
    });
  }

  return { items: out };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/collect.test.mjs`
Expected: PASS，8 个测试全绿

- [ ] **Step 5: 实现 scripts/fetch.mjs**

```js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { collectFromFeed } from '../lib/collect.mjs';
import { loadSeen, saveSeen, loadStatus, saveStatus, recordSuccess, recordFailure } from '../lib/store.mjs';

const DATA_DIR = 'data';
const UA = 'Mozilla/5.0 (compatible; ai-news-reader/1.0; +https://github.com/maoyue2004/news)';
const TIMEOUT_MS = 20000;
const CONCURRENCY = 8;

function todayInShanghai() {
  // 定时任务按北京时间跑，日期也要按北京时间算，否则跨零点会错位。
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function main() {
  const sources = JSON.parse(readFileSync('sources.json', 'utf8')).filter((s) => s.enabled && s.feed);
  const today = todayInShanghai();
  const now = new Date().toISOString();
  const seen = loadSeen(DATA_DIR);
  const status = loadStatus(DATA_DIR);

  const items = [];
  const errors = [];

  for (let i = 0; i < sources.length; i += CONCURRENCY) {
    const batch = sources.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (source) => {
        try {
          const xml = await fetchFeed(source.feed);
          const got = collectFromFeed({ source, xml, seen, today, now });
          items.push(...got.items);
          recordSuccess(status, source.name, now);
        } catch (err) {
          errors.push({ source: source.name, message: err.message });
          recordFailure(status, source.name, now, err.message);
        }
      }),
    );
    console.error(`已抓取 ${Math.min(i + CONCURRENCY, sources.length)}/${sources.length}`);
  }

  items.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  // 只有真正写进 _pending 的条目才记进 seen，否则抓取失败会导致漏内容。
  for (const it of items) seen[it.id] = today;

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(`${DATA_DIR}/_pending.json`, JSON.stringify({ date: today, items, errors }, null, 2) + '\n');
  saveSeen(DATA_DIR, seen, today);
  saveStatus(DATA_DIR, status);

  console.log(`日期 ${today}：新条目 ${items.length} 条，失败 ${errors.length} 个源`);
  const stale = Object.entries(status).filter(([, s]) => s.consecutiveFailures >= 7);
  if (stale.length) {
    console.log('\n连续失败 7 天以上的源（需要人工处理）：');
    for (const [name, s] of stale) console.log(`  ${name} — ${s.lastErrorMessage}（连续 ${s.consecutiveFailures} 次）`);
  }
}

await main();
```

- [ ] **Step 6: 真实跑一次抓取**

Run: `node scripts/fetch.mjs`
Expected: 打印进度，最后输出「日期 YYYY-MM-DD：新条目 N 条，失败 M 个源」。
N 应当在 30-300 之间（首次运行会收下最近 14 天的内容，条数偏多是正常的）。
检查 `data/_pending.json` 存在且 `items[0]` 含全部约定字段。

Run: `node -e '
const p = JSON.parse(require("fs").readFileSync("data/_pending.json","utf8"));
console.log("条目", p.items.length, "错误", p.errors.length);
console.log("字段齐全", p.items.every(i => i.id && i.source && i.type && i.lang && i.url && i.titleOriginal && i.publishedAt && "excerpt" in i && "brief" in i));
console.log("样例:", JSON.stringify(p.items[0], null, 2).slice(0, 500));
'`

- [ ] **Step 7: 提交**

```bash
git add lib/collect.mjs scripts/fetch.mjs test/collect.test.mjs data/seen.json data/status.json
git commit -m "抓取：并发拉取各信源 feed，去重后产出待摘要条目

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: 页面骨架与样式

**Files:**
- Create: `templates/page.css`
- Create: `lib/render.mjs`
- Test: `test/render.test.mjs`

**Interfaces:**
- Consumes: `templates/page.css`、`templates/logic.js` 与 `templates/ui.js`（后两个在 Task 8 创建；
  本任务先允许它们不存在，`render.mjs` 读不到时用空串代替）
- Produces: `renderPage({ days, sources, status, generatedAt }) => string`（完整 HTML 字符串）。
  Task 9 的 `build.mjs` 调用它。
  页面把数据放在 `<script type="application/json" id="reader-data">` 里，
  结构为 `{ days: DayFile[], sources: Source[], status: Record<string, SourceStatus>, generatedAt: string }`。

- [ ] **Step 1: 写失败的测试**

Create `test/render.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../lib/render.mjs';

const FIXTURE = {
  generatedAt: '2026-07-27T00:10:00.000Z',
  days: [
    {
      date: '2026-07-27',
      generatedAt: '2026-07-27T00:10:00.000Z',
      items: [
        {
          id: 'aaaaaaaaaaaaaaaa', source: 'Interconnects', type: 'blog', lang: 'en',
          url: 'https://example.com/a', titleOriginal: 'Reward hacking in RL',
          titleZh: 'RL 环境里的报酬黑客问题', summaryZh: '摘要正文。', 
          publishedAt: '2026-07-26T18:00:00.000Z', brief: false,
        },
      ],
      errors: [{ source: 'Epoch AI', message: 'HTTP 503' }],
    },
  ],
  sources: [
    { name: 'Interconnects', url: 'https://example.com/', feed: 'https://example.com/feed', type: 'blog', lang: 'en', enabled: true, desc: 'd' },
    { name: '归藏的AI工具箱', url: 'https://weixin.sogou.com/x', feed: null, type: 'blog', lang: 'zh', enabled: false, disabledReason: '搜索页', desc: 'd' },
  ],
  status: { Interconnects: { lastSuccess: '2026-07-27T00:00:00.000Z', lastError: null, lastErrorMessage: null, consecutiveFailures: 0 } },
};

test('产出完整 HTML 且带标题', () => {
  const html = renderPage(FIXTURE);
  assert.match(html, /<title>AI 信源罗盘<\/title>/);
});

test('数据以 JSON 内嵌，且能被解析回来', () => {
  const html = renderPage(FIXTURE);
  const m = html.match(/<script type="application\/json" id="reader-data">([\s\S]*?)<\/script>/);
  assert.ok(m, '找不到内嵌数据块');
  const data = JSON.parse(m[1]);
  assert.equal(data.days[0].items[0].titleZh, 'RL 环境里的报酬黑客问题');
  assert.equal(data.sources.length, 2);
});

test('内嵌 CSS，不引用外部样式表', () => {
  const html = renderPage(FIXTURE);
  assert.match(html, /<style>/);
  assert.equal(/<link[^>]+stylesheet/.test(html), false);
});

test('不含任何外部主机的资源引用', () => {
  const html = renderPage(FIXTURE);
  assert.equal(/<script[^>]+\bsrc=/.test(html), false);
  assert.equal(/<img[^>]+\bsrc=["']https?:/.test(html), false);
});

test('同时定义 prefers-color-scheme 与 data-theme 两套暗色变量', () => {
  const html = renderPage(FIXTURE);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.match(html, /:root\[data-theme="dark"\]/);
  assert.match(html, /:root\[data-theme="light"\]/);
});

test('内容里的 </script> 被转义，不会截断内嵌 JSON', () => {
  const evil = structuredClone(FIXTURE);
  evil.days[0].items[0].summaryZh = 'x </script><script>alert(1)</script>';
  const html = renderPage(evil);
  const m = html.match(/<script type="application\/json" id="reader-data">([\s\S]*?)<\/script>/);
  const data = JSON.parse(m[1]);
  assert.equal(data.days[0].items[0].summaryZh, 'x </script><script>alert(1)</script>');
});

test('包含左栏日历、主区、信源管理三个挂载点', () => {
  const html = renderPage(FIXTURE);
  assert.match(html, /id="calendar"/);
  assert.match(html, /id="stream"/);
  assert.match(html, /id="sources-view"/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/render.test.mjs`
Expected: FAIL，`Cannot find module '../lib/render.mjs'`

- [ ] **Step 3: 写 templates/page.css**

沿用原 artifact 的变量与配色，新增阅读器所需的组件样式。

```css
:root {
  --ink: #161c1a;
  --paper: #f2f5f2;
  --paper-raised: #ffffff;
  --accent: #2f6f5e;
  --accent-strong: #215345;
  --accent-warm: #a8722f;
  --line: #dbe2dc;
  --muted: #5b665f;
  --seed-bg: #eaf1ec;
  --focus: #1f6f5e;
  --shadow: 0 1px 2px rgba(20, 30, 25, 0.04);
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #e9efe9; --paper: #101513; --paper-raised: #161d1a;
    --accent: #59b39e; --accent-strong: #7fcdb9; --accent-warm: #d7a45e;
    --line: #263129; --muted: #93a39a; --seed-bg: #17251f;
    --shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  }
}
:root[data-theme="dark"] {
  --ink: #e9efe9; --paper: #101513; --paper-raised: #161d1a;
  --accent: #59b39e; --accent-strong: #7fcdb9; --accent-warm: #d7a45e;
  --line: #263129; --muted: #93a39a; --seed-bg: #17251f;
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
}
:root[data-theme="light"] {
  --ink: #161c1a; --paper: #f2f5f2; --paper-raised: #ffffff;
  --accent: #2f6f5e; --accent-strong: #215345; --accent-warm: #a8722f;
  --line: #dbe2dc; --muted: #5b665f; --seed-bg: #eaf1ec;
  --shadow: 0 1px 2px rgba(20, 30, 25, 0.04);
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--paper);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", "Hiragino Sans GB", sans-serif;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
h1, h2 { font-weight: 600; letter-spacing: -0.01em; text-wrap: balance; }

.app { display: grid; grid-template-columns: 220px minmax(0, 1fr); align-items: start; }
@media (max-width: 760px) { .app { grid-template-columns: 1fr; } }

header.masthead {
  grid-column: 1 / -1;
  padding: 20px 24px 14px;
  border-bottom: 1px solid var(--line);
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px 20px;
}
header.masthead h1 { font-size: 22px; margin: 0; }
header.masthead .stats {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums;
}
header.masthead .stats b { color: var(--accent-strong); font-weight: 600; }
.toolbar { margin-left: auto; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.filter-group { display: flex; gap: 4px; }
.filter-group button {
  font: inherit; font-size: 12.5px; padding: 5px 11px; border-radius: 7px;
  border: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer;
}
.filter-group button.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.search-box {
  font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 8px; width: 180px;
  border: 1px solid var(--line); background: var(--paper-raised); color: var(--ink);
}
.search-box:focus, .filter-group button:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }

aside.sidebar {
  position: sticky; top: 0; align-self: start; max-height: 100vh; overflow-y: auto;
  padding: 14px 10px 30px 18px; border-right: 1px solid var(--line);
}
@media (max-width: 760px) {
  aside.sidebar {
    position: static; max-height: none; overflow: visible;
    border-right: none; border-bottom: 1px solid var(--line);
    display: flex; gap: 6px; overflow-x: auto; padding: 12px 18px;
  }
  #calendar { display: flex; gap: 6px; }
  .side-section { display: flex; gap: 6px; }
}
.side-label {
  font-family: ui-monospace, monospace; font-size: 10.5px; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--muted); margin: 0 0 6px 10px;
}
button.day-btn, button.view-btn {
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  width: 100%; font: inherit; font-size: 13px; text-align: left;
  padding: 6px 10px; border-radius: 7px; border: 1px solid transparent;
  background: transparent; color: var(--ink); cursor: pointer; white-space: nowrap;
}
button.day-btn:hover, button.view-btn:hover { background: var(--seed-bg); }
button.day-btn.active, button.view-btn.active { background: var(--accent); color: #fff; }
button.day-btn.active .day-count, button.view-btn.active .day-count { color: #fff; opacity: 0.85; }
button.day-btn:focus-visible, button.view-btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.day-count { font-family: ui-monospace, monospace; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.unread-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent-warm); flex: none; }
button.day-btn.active .unread-dot { background: #fff; }
.side-section { margin-top: 18px; }

main.content { min-width: 0; padding: 16px 24px 60px; }
.group-head {
  display: flex; align-items: baseline; gap: 10px;
  margin: 22px 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--line);
}
.group-head:first-child { margin-top: 0; }
.group-head h2 { font-size: 15px; margin: 0; }
.group-head .group-count { font-family: ui-monospace, monospace; font-size: 11.5px; color: var(--muted); }

.item {
  display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: 4px 8px;
  padding: 9px 10px; border-radius: 9px; align-items: start;
}
.item:hover { background: var(--paper-raised); }
.item.read .item-title a, .item.read .item-summary { opacity: 0.5; }
.item.hidden { display: none; }
.toggle {
  font: inherit; font-size: 14px; line-height: 1.2; padding: 1px 3px; cursor: pointer;
  background: none; border: none; color: var(--muted); border-radius: 4px;
}
.toggle:hover { color: var(--accent-strong); }
.toggle:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.toggle.star-on { color: var(--accent-warm); }
.item-body { grid-column: 3; min-width: 0; }
.item-meta {
  font-size: 11.5px; color: var(--muted); display: flex; flex-wrap: wrap;
  gap: 6px; align-items: baseline; margin-bottom: 1px;
}
.item-meta .src { font-weight: 600; color: var(--accent-strong); }
.item-title { font-size: 14.5px; font-weight: 600; margin: 0 0 1px; }
.item-title a { color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--accent); }
.item-title a:hover { color: var(--accent-strong); }
.item-title a:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.item-orig { font-size: 11.5px; color: var(--muted); margin: 0 0 3px; }
.item-summary {
  font-size: 13px; color: var(--muted); margin: 0; cursor: pointer;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.item-summary.expanded { -webkit-line-clamp: unset; display: block; }
.brief-note {
  font-family: ui-monospace, monospace; font-size: 10px; padding: 1px 5px; border-radius: 4px;
  background: var(--seed-bg); color: var(--accent-strong); white-space: nowrap;
}

table.sources-table { width: 100%; border-collapse: collapse; font-size: 13px; }
table.sources-table th, table.sources-table td {
  text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: top;
}
table.sources-table th { font-size: 11.5px; color: var(--muted); font-weight: 600; }
table.sources-table tr.disabled td { color: var(--muted); }
.table-scroll { overflow-x: auto; }

.empty-state { padding: 50px 0; text-align: center; color: var(--muted); font-size: 14px; }
.errors-note {
  margin-top: 30px; padding: 10px 12px; border-radius: 8px;
  background: var(--seed-bg); font-size: 12.5px; color: var(--muted);
}
.hidden { display: none !important; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
```

- [ ] **Step 4: 实现 lib/render.mjs**

```js
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
  return JSON.stringify(value)
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
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test test/render.test.mjs`
Expected: PASS，7 个测试全绿（此时 `logic.js` 与 `ui.js` 还不存在，渲染出的页面没有交互，
但结构、内嵌数据与自包含性都已满足）

- [ ] **Step 6: 提交**

```bash
git add templates/page.css lib/render.mjs test/render.test.mjs
git commit -m "页面渲染：自包含 HTML 骨架与样式，数据以 JSON 内嵌

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: 浏览器端逻辑与交互

**Files:**
- Create: `templates/logic.js`
- Create: `templates/ui.js`
- Test: `test/logic.test.mjs`

**Interfaces:**
- Consumes: Task 7 渲染出的 DOM 挂载点（`#stats` `#filters` `#search` `#calendar` `#stream` `#sources-view`）
  和内嵌数据块 `#reader-data`
- Produces: 全局对象 `window.ReaderLogic`，含纯函数
  `groupByType(items)`、`applyFilter(items, { filter, query, readSet, starSet })`、
  `computeStats(items, readSet, starSet)`、`formatDayLabel(dateStr, todayStr)`、
  `TYPE_LABELS`、`TYPE_ORDER`。
  这些函数不碰 DOM，用 `node:vm` 加载后单测。

`templates/logic.js` 是纯逻辑，`templates/ui.js` 是 DOM 装配。两者都是经典脚本
（不是 ES module），按顺序内联进页面，`ui.js` 通过 `window.ReaderLogic` 使用前者。

- [ ] **Step 1: 写失败的测试**

Create `test/logic.test.mjs`：

```js
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let L;
before(() => {
  const code = readFileSync('templates/logic.js', 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  L = sandbox.window.ReaderLogic;
});

function item(over = {}) {
  return {
    id: 'id-' + (over.id ?? '1'), source: 'S', type: 'blog', lang: 'en',
    url: 'https://e.com/x', titleOriginal: 'Original Title',
    titleZh: '中文标题', summaryZh: '中文摘要内容',
    publishedAt: '2026-07-27T00:00:00.000Z', brief: false, ...over,
  };
}

test('按类型分组并遵循固定顺序', () => {
  const groups = L.groupByType([
    item({ id: '1', type: 'podcast' }),
    item({ id: '2', type: 'blog' }),
    item({ id: '3', type: 'lab' }),
  ]);
  assert.deepEqual(groups.map((g) => g.type), ['blog', 'lab', 'podcast']);
  assert.equal(groups[0].items.length, 1);
});

test('分组里不出现空类型', () => {
  const groups = L.groupByType([item({ id: '1', type: 'blog' })]);
  assert.equal(groups.length, 1);
});

test('每个类型都有中文标签', () => {
  for (const t of L.TYPE_ORDER) {
    assert.equal(typeof L.TYPE_LABELS[t], 'string');
    assert.ok(L.TYPE_LABELS[t].length > 0);
  }
});

test('未读筛选排除已读条目', () => {
  const items = [item({ id: '1' }), item({ id: '2' })];
  const out = L.applyFilter(items, { filter: 'unread', query: '', readSet: new Set(['id-1']), starSet: new Set() });
  assert.deepEqual(out.map((i) => i.id), ['id-2']);
});

test('标星筛选只留标星条目', () => {
  const items = [item({ id: '1' }), item({ id: '2' })];
  const out = L.applyFilter(items, { filter: 'starred', query: '', readSet: new Set(), starSet: new Set(['id-2']) });
  assert.deepEqual(out.map((i) => i.id), ['id-2']);
});

test('搜索同时命中中文标题、中文摘要、英文原标题和信源名', () => {
  const items = [item({ id: '1', titleZh: '报酬黑客', summaryZh: 'x', titleOriginal: 'y', source: 'z' })];
  const opts = { filter: 'all', readSet: new Set(), starSet: new Set() };
  assert.equal(L.applyFilter(items, { ...opts, query: '报酬' }).length, 1);
  assert.equal(L.applyFilter([item({ id: '2', summaryZh: '独特摘要' })], { ...opts, query: '独特' }).length, 1);
  assert.equal(L.applyFilter([item({ id: '3', titleOriginal: 'Unique English' })], { ...opts, query: 'unique' }).length, 1);
  assert.equal(L.applyFilter([item({ id: '4', source: 'Interconnects' })], { ...opts, query: 'intercon' }).length, 1);
  assert.equal(L.applyFilter(items, { ...opts, query: '不存在的词' }).length, 0);
});

test('搜索大小写不敏感', () => {
  const items = [item({ titleOriginal: 'Reward Hacking' })];
  const out = L.applyFilter(items, { filter: 'all', query: 'REWARD', readSet: new Set(), starSet: new Set() });
  assert.equal(out.length, 1);
});

test('统计给出总数、未读数与标星数', () => {
  const items = [item({ id: '1' }), item({ id: '2' }), item({ id: '3' })];
  const s = L.computeStats(items, new Set(['id-1']), new Set(['id-2', 'id-3']));
  assert.deepEqual(s, { total: 3, unread: 2, starred: 2 });
});

test('日期标签：今天和昨天用中文词', () => {
  assert.equal(L.formatDayLabel('2026-07-27', '2026-07-27'), '今天');
  assert.equal(L.formatDayLabel('2026-07-26', '2026-07-27'), '昨天');
});

test('日期标签：更早的显示月日与星期', () => {
  assert.equal(L.formatDayLabel('2026-07-24', '2026-07-27'), '7月24日 周五');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/logic.test.mjs`
Expected: FAIL，读不到 `templates/logic.js`

- [ ] **Step 3: 实现 templates/logic.js**

```js
/* 纯逻辑，不碰 DOM。挂在 window.ReaderLogic 上，供 ui.js 与单测共用。 */
(function () {
  var TYPE_ORDER = ['blog', 'newsletter', 'lab', 'media', 'community', 'podcast', 'video'];
  var TYPE_LABELS = {
    blog: '博客', newsletter: 'Newsletter', lab: '实验室',
    media: '媒体', community: '社区', podcast: '播客', video: '视频',
  };
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function groupByType(items) {
    var buckets = {};
    items.forEach(function (it) {
      (buckets[it.type] = buckets[it.type] || []).push(it);
    });
    return TYPE_ORDER
      .filter(function (t) { return buckets[t] && buckets[t].length; })
      .map(function (t) {
        var list = buckets[t].slice().sort(function (a, b) {
          return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
        });
        return { type: t, label: TYPE_LABELS[t], items: list };
      });
  }

  function applyFilter(items, opts) {
    var q = (opts.query || '').trim().toLowerCase();
    return items.filter(function (it) {
      if (opts.filter === 'unread' && opts.readSet.has(it.id)) return false;
      if (opts.filter === 'starred' && !opts.starSet.has(it.id)) return false;
      if (!q) return true;
      var hay = [it.titleZh, it.summaryZh, it.titleOriginal, it.source].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function computeStats(items, readSet, starSet) {
    var unread = 0, starred = 0;
    items.forEach(function (it) {
      if (!readSet.has(it.id)) unread++;
      if (starSet.has(it.id)) starred++;
    });
    return { total: items.length, unread: unread, starred: starred };
  }

  function formatDayLabel(dateStr, todayStr) {
    var diff = Math.round((Date.parse(todayStr + 'T00:00:00Z') - Date.parse(dateStr + 'T00:00:00Z')) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    var d = new Date(dateStr + 'T00:00:00Z');
    return (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日 ' + WEEKDAYS[d.getUTCDay()];
  }

  window.ReaderLogic = {
    TYPE_ORDER: TYPE_ORDER,
    TYPE_LABELS: TYPE_LABELS,
    groupByType: groupByType,
    applyFilter: applyFilter,
    computeStats: computeStats,
    formatDayLabel: formatDayLabel,
  };
})();
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/logic.test.mjs`
Expected: PASS，10 个测试全绿

- [ ] **Step 5: 实现 templates/ui.js**

```js
/* DOM 装配。依赖 window.ReaderLogic 与页面里的 #reader-data。 */
(function () {
  var L = window.ReaderLogic;
  var DATA = JSON.parse(document.getElementById('reader-data').textContent);
  var READ_KEY = 'airadar.read.v1';
  var STAR_KEY = 'airadar.star.v1';

  function loadSet(key) {
    try {
      var raw = localStorage.getItem(key);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (e) {
      return new Set();
    }
  }
  function saveSet(key, set) {
    try {
      localStorage.setItem(key, JSON.stringify([...set]));
    } catch (e) {
      /* 隐私模式下写不进去，功能降级为本次会话有效 */
    }
  }

  var readSet = loadSet(READ_KEY);
  var starSet = loadSet(STAR_KEY);
  var today = DATA.days.length ? DATA.days[0].date : '';
  var state = { view: today ? { kind: 'day', date: today } : { kind: 'sources' }, filter: 'all', query: '' };

  var elStats = document.getElementById('stats');
  var elCal = document.getElementById('calendar');
  var elStream = document.getElementById('stream');
  var elSources = document.getElementById('sources-view');
  var elSearch = document.getElementById('search');
  var elFilters = document.getElementById('filters');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function allItems() {
    return DATA.days.reduce(function (acc, d) { return acc.concat(d.items); }, []);
  }

  function currentItems() {
    if (state.view.kind === 'starred') {
      return allItems().filter(function (it) { return starSet.has(it.id); });
    }
    var day = DATA.days.find(function (d) { return d.date === state.view.date; });
    return day ? day.items : [];
  }

  function currentErrors() {
    if (state.view.kind !== 'day') return [];
    var day = DATA.days.find(function (d) { return d.date === state.view.date; });
    return day && day.errors ? day.errors : [];
  }

  function renderCalendar() {
    var html = DATA.days.map(function (d) {
      var unread = d.items.filter(function (it) { return !readSet.has(it.id); }).length;
      var active = state.view.kind === 'day' && state.view.date === d.date;
      return '<button class="day-btn' + (active ? ' active' : '') + '" data-date="' + d.date + '">' +
        '<span>' + esc(L.formatDayLabel(d.date, today)) + '</span>' +
        '<span class="day-count">' + (unread ? '<span class="unread-dot"></span> ' : '') + d.items.length + '</span>' +
        '</button>';
    }).join('');
    elCal.innerHTML = html;
  }

  function renderStats() {
    var s = L.computeStats(currentItems(), readSet, starSet);
    var label = state.view.kind === 'starred' ? '收藏' :
      state.view.kind === 'sources' ? '' : L.formatDayLabel(state.view.date, today);
    elStats.innerHTML = label
      ? label + ' <b>' + s.total + '</b> 条 · 未读 <b>' + s.unread + '</b> · ★ <b>' + s.starred + '</b>'
      : '';
  }

  function itemHtml(it) {
    var isRead = readSet.has(it.id);
    var isStar = starSet.has(it.id);
    var time = new Date(it.publishedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return '<article class="item' + (isRead ? ' read' : '') + '" data-id="' + it.id + '">' +
      '<button class="toggle" data-act="read" aria-label="标记已读" aria-pressed="' + isRead + '">' + (isRead ? '☑' : '☐') + '</button>' +
      '<button class="toggle' + (isStar ? ' star-on' : '') + '" data-act="star" aria-label="标星" aria-pressed="' + isStar + '">' + (isStar ? '★' : '☆') + '</button>' +
      '<div class="item-body">' +
        '<div class="item-meta">' +
          '<span class="src">' + esc(it.source) + '</span>' +
          '<span>' + esc(L.TYPE_LABELS[it.type] || it.type) + '</span>' +
          '<span>' + esc(it.lang.toUpperCase()) + '</span>' +
          '<span>' + esc(time) + '</span>' +
          (it.brief ? '<span class="brief-note">' + (it.type === 'video' ? '▶' : '🎧') + ' 基于官方简介，未收听</span>' : '') +
        '</div>' +
        '<h3 class="item-title"><a href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.titleZh || it.titleOriginal) + '</a></h3>' +
        (it.titleZh ? '<p class="item-orig">原标题 ' + esc(it.titleOriginal) + '</p>' : '') +
        '<p class="item-summary">' + esc(it.summaryZh) + '</p>' +
      '</div>' +
    '</article>';
  }

  function renderStream() {
    elSources.classList.add('hidden');
    elStream.classList.remove('hidden');

    var items = L.applyFilter(currentItems(), {
      filter: state.filter, query: state.query, readSet: readSet, starSet: starSet,
    });

    if (!items.length) {
      elStream.innerHTML = '<div class="empty-state">这里没有内容 — 换个筛选条件或看看别的日期。</div>';
      return;
    }

    var groups = L.groupByType(items);
    var html = groups.map(function (g) {
      return '<div class="group-head"><h2>' + esc(g.label) + '</h2>' +
        '<span class="group-count">' + g.items.length + ' 条</span></div>' +
        g.items.map(itemHtml).join('');
    }).join('');

    var errors = currentErrors();
    if (errors.length) {
      html += '<div class="errors-note">今天有 ' + errors.length + ' 个源没抓到：' +
        errors.map(function (e) { return esc(e.source) + '（' + esc(e.message) + '）'; }).join('、') + '</div>';
    }
    elStream.innerHTML = html;
  }

  function renderSources() {
    elStream.classList.add('hidden');
    elSources.classList.remove('hidden');

    var enabled = DATA.sources.filter(function (s) { return s.enabled; });
    var disabled = DATA.sources.filter(function (s) { return !s.enabled; });

    function row(s) {
      var st = DATA.status[s.name] || {};
      var last = st.lastSuccess ? new Date(st.lastSuccess).toLocaleDateString('zh-CN') : '—';
      var note = s.enabled
        ? (st.consecutiveFailures ? '连续失败 ' + st.consecutiveFailures + ' 次：' + esc(st.lastErrorMessage || '') : '正常')
        : esc(s.disabledReason || '未启用');
      return '<tr class="' + (s.enabled ? '' : 'disabled') + '">' +
        '<td><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.name) + '</a></td>' +
        '<td>' + esc(L.TYPE_LABELS[s.type] || s.type) + '</td>' +
        '<td>' + esc(s.lang.toUpperCase()) + '</td>' +
        '<td>' + last + '</td><td>' + note + '</td></tr>';
    }

    elSources.innerHTML =
      '<div class="group-head"><h2>正在抓取</h2><span class="group-count">' + enabled.length + ' 个</span></div>' +
      '<div class="table-scroll"><table class="sources-table">' +
      '<tr><th>信源</th><th>类型</th><th>语言</th><th>最近成功</th><th>状态</th></tr>' +
      enabled.map(row).join('') + '</table></div>' +
      '<div class="group-head"><h2>未启用</h2><span class="group-count">' + disabled.length + ' 个</span></div>' +
      '<div class="table-scroll"><table class="sources-table">' +
      '<tr><th>信源</th><th>类型</th><th>语言</th><th>最近成功</th><th>原因</th></tr>' +
      disabled.map(row).join('') + '</table></div>' +
      '<div class="errors-note">信源列表以仓库里的 sources.json 为准。要增删信源，直接告诉 Claude，改动次日生效。' +
      '<br>已读与标星存在这台设备的浏览器里，换设备或清缓存会丢失；' +
      '<button id="export-stars" class="toggle" style="text-decoration:underline">导出收藏</button></div>';

    var btn = document.getElementById('export-stars');
    if (btn) btn.addEventListener('click', exportStars);
  }

  function exportStars() {
    var starred = allItems().filter(function (it) { return starSet.has(it.id); });
    var payload = JSON.stringify({ exportedAt: new Date().toISOString(), items: starred }, null, 2);
    if (window.claude && window.claude.downloads) {
      window.claude.downloads.save({ filename: 'ai-radar-stars.json', data: payload }).catch(function () {});
    } else {
      var blob = new Blob([payload], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ai-radar-stars.json';
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }

  function render() {
    renderCalendar();
    renderStats();
    if (state.view.kind === 'sources') renderSources();
    else renderStream();
    document.querySelectorAll('.view-btn').forEach(function (b) {
      b.classList.toggle('active', state.view.kind === b.dataset.view);
    });
  }

  elCal.addEventListener('click', function (e) {
    var btn = e.target.closest('.day-btn');
    if (!btn) return;
    state.view = { kind: 'day', date: btn.dataset.date };
    render();
  });

  document.querySelectorAll('.view-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      state.view = { kind: b.dataset.view };
      render();
    });
  });

  elFilters.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    elFilters.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === btn); });
    renderStream();
    renderStats();
  });

  elSearch.addEventListener('input', function () {
    state.query = elSearch.value;
    if (state.view.kind !== 'sources') { renderStream(); renderStats(); }
  });

  elStream.addEventListener('click', function (e) {
    var summary = e.target.closest('.item-summary');
    if (summary) { summary.classList.toggle('expanded'); return; }

    var btn = e.target.closest('.toggle');
    if (!btn) return;
    var id = btn.closest('.item').dataset.id;
    if (btn.dataset.act === 'read') {
      if (readSet.has(id)) readSet.delete(id); else readSet.add(id);
      saveSet(READ_KEY, readSet);
    } else {
      if (starSet.has(id)) starSet.delete(id); else starSet.add(id);
      saveSet(STAR_KEY, starSet);
    }
    render();
  });

  render();
})();
```

- [ ] **Step 6: 生成一个页面并在浏览器里手工验证**

先造一份小样本数据跑通渲染：

```bash
mkdir -p /tmp/reader-check && node -e '
import("./lib/render.mjs").then(({ renderPage }) => {
  const fs = require("fs");
  const item = (o) => ({
    id: o.id, source: o.source, type: o.type, lang: "en",
    url: "https://example.com/" + o.id, titleOriginal: "Original " + o.id,
    titleZh: "中文标题 " + o.id, summaryZh: "这是一段用于验证折叠与展开行为的中文摘要，重复若干次以便超过两行。".repeat(3),
    publishedAt: "2026-07-27T06:00:00.000Z", brief: o.type === "podcast",
  });
  const html = renderPage({
    generatedAt: new Date().toISOString(),
    days: [
      { date: "2026-07-27", items: [item({id:"a",source:"Interconnects",type:"blog"}), item({id:"b",source:"Latent Space",type:"podcast"})], errors: [{source:"Epoch AI",message:"HTTP 503"}] },
      { date: "2026-07-26", items: [item({id:"c",source:"Import AI",type:"newsletter"})], errors: [] },
    ],
    sources: JSON.parse(fs.readFileSync("sources.json","utf8")),
    status: {},
  });
  fs.writeFileSync("/tmp/reader-check/index.html", html);
  console.log("已写入 /tmp/reader-check/index.html");
});
'
open /tmp/reader-check/index.html```

在浏览器里逐项确认（这些是 DOM 交互，单测覆盖不到，必须人眼过一遍）：

- 左栏两个日期都能点，点击后主区切换，当前日期高亮
- 点 ☐ 变 ☑ 且条目变灰；刷新页面后状态还在（localStorage 生效）
- 点 ☆ 变 ★；点「★ 收藏」视图能看到刚标星的那条
- 点摘要文字能展开/收起
- 顶部「未读」「已标星」筛选生效，搜索框输入「中文标题 a」只剩一条
- 播客那条显示「🎧 基于官方简介，未收听」
- 主区底部显示「今天有 1 个源没抓到：Epoch AI（HTTP 503）」
- 点「信源管理」显示两张表，未启用的 18 个源带停用原因
- 把系统切成深色模式，配色正确
- 窗口拖窄到 700px 以下，布局折叠为单栏且不出现横向滚动条

- [ ] **Step 7: 提交**

```bash
git add templates/logic.js templates/ui.js test/logic.test.mjs
git commit -m "页面交互：日历切换、已读标星、筛选搜索、信源管理与收藏导出

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: 构建脚本

**Files:**
- Create: `scripts/build.mjs`
- Test: `test/build.test.mjs`

**Interfaces:**
- Consumes: `renderPage`（Task 7）、`loadRecentDays` 与 `pruneDayFiles` 与 `loadStatus`（Task 5）
- Produces: `dist/index.html`。Task 10 的每日流程调用 `npm run build` 后把它交给 Artifact 工具发布。

- [ ] **Step 1: 写失败的测试**

Create `test/build.test.mjs`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHtml } from '../scripts/build.mjs';

function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'news-build-'));
  const data = join(root, 'data');
  mkdirSync(data, { recursive: true });
  writeFileSync(join(root, 'sources.json'), JSON.stringify([
    { name: 'A', url: 'https://a.com/', feed: 'https://a.com/feed', type: 'blog', lang: 'en', enabled: true, desc: 'd' },
  ]));
  writeFileSync(join(data, 'status.json'), JSON.stringify({ A: { lastSuccess: '2026-07-27T00:00:00.000Z', lastError: null, lastErrorMessage: null, consecutiveFailures: 0 } }));
  writeFileSync(join(data, '2026-07-27.json'), JSON.stringify({
    date: '2026-07-27', generatedAt: '2026-07-27T00:00:00.000Z',
    items: [{ id: 'x1', source: 'A', type: 'blog', lang: 'en', url: 'https://a.com/1', titleOriginal: 'T', titleZh: '标题', summaryZh: '摘要', publishedAt: '2026-07-27T00:00:00.000Z', brief: false }],
    errors: [],
  }));
  writeFileSync(join(data, '2026-01-01.json'), JSON.stringify({ date: '2026-01-01', items: [], errors: [] }));
  return root;
}

test('构建产出 dist/index.html', () => {
  const root = fixtureRepo();
  buildHtml({ root, today: '2026-07-27' });
  assert.ok(existsSync(join(root, 'dist', 'index.html')));
});

test('产出的页面内嵌了当天数据', () => {
  const root = fixtureRepo();
  buildHtml({ root, today: '2026-07-27' });
  const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
  const m = html.match(/<script type="application\/json" id="reader-data">([\s\S]*?)<\/script>/);
  const data = JSON.parse(m[1]);
  assert.equal(data.days.length, 1);
  assert.equal(data.days[0].items[0].titleZh, '标题');
  assert.equal(data.sources.length, 1);
  assert.equal(data.status.A.consecutiveFailures, 0);
});

test('构建时裁掉超过 35 天的日文件', () => {
  const root = fixtureRepo();
  buildHtml({ root, today: '2026-07-27' });
  assert.equal(existsSync(join(root, 'data', '2026-01-01.json')), false);
  assert.equal(existsSync(join(root, 'data', '2026-07-27.json')), true);
});

test('构建返回摘要信息供日志使用', () => {
  const root = fixtureRepo();
  const res = buildHtml({ root, today: '2026-07-27' });
  assert.equal(res.dayCount, 1);
  assert.equal(res.itemCount, 1);
  assert.ok(res.bytes > 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/build.test.mjs`
Expected: FAIL，`Cannot find module '../scripts/build.mjs'`

- [ ] **Step 3: 实现 scripts/build.mjs**

```js
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/build.test.mjs`
Expected: PASS，4 个测试全绿

- [ ] **Step 5: 跑一遍全量测试**

Run: `npm test`
Expected: 全部测试通过（feed-parse 6 + html-text 6 + fingerprint 6 + discover-feeds 6 + store 11 + collect 8 + render 7 + logic 10 + build 4 = 54 个）

- [ ] **Step 6: 提交**

```bash
git add scripts/build.mjs test/build.test.mjs
git commit -m "构建：把最近 30 天数据内嵌进自包含页面并裁剪历史

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: 首次真实运行与发布

**Files:**
- Create: `DAILY.md`
- Create: `README.md`
- Modify: `.gitignore`（确认 `data/_pending.json` 与 `dist/` 的处理）

**Interfaces:**
- Consumes: 前九个任务的全部产出
- Produces: 一个已更新的线上 Artifact，以及一份可被云端 routine 逐条执行的 `DAILY.md`

本任务要真的抓一次、真的写摘要、真的发布。这是第一次端到端验证。

- [ ] **Step 1: 确认 .gitignore**

`dist/index.html` 要提交（这样能追溯每天发布了什么，且云端 agent 出问题时可回滚），
`data/_pending.json` 不提交（中间产物）。确认 `.gitignore` 内容为：

```
node_modules/
data/_pending.json
.DS_Store
```

- [ ] **Step 2: 抓取一次**

Run: `npm run fetch`
Expected: 输出「日期 YYYY-MM-DD：新条目 N 条，失败 M 个源」

- [ ] **Step 3: 写中文摘要，生成当天数据文件**

读 `data/_pending.json`，为每条写 `titleZh` 与 `summaryZh`，写入 `data/<date>.json`。

规格（来自 spec）：
- `titleZh`：中文标题，**意译不直译**。原文本就是中文的，直接沿用 `titleOriginal`。
- `summaryZh`：**3-4 句，60-120 字**，说清「这篇在讲什么、结论是什么」。
  目标是让读者判断要不要点开原文，不是取代原文。
- `brief: true` 的条目（播客/视频）：`excerpt` 是官方简介而非正文，
  摘要如实基于简介写，**不要编造节目内容**。页面会自动标注「基于官方简介，未收听」。
- 输出的 item 保留 `_pending.json` 里除 `excerpt` 外的全部字段，加上 `titleZh` 和 `summaryZh`。
- 顶层结构：`{ date, generatedAt, items, errors }`，`errors` 原样从 `_pending.json` 复制。

条目多时分批处理，每批 20-30 条，最后合并写入一个文件。

- [ ] **Step 4: 校验当天数据文件**

Run:
```bash
node -e '
const fs = require("fs");
const date = JSON.parse(fs.readFileSync("data/_pending.json","utf8")).date;
const d = JSON.parse(fs.readFileSync(`data/${date}.json`,"utf8"));
const p = JSON.parse(fs.readFileSync("data/_pending.json","utf8"));
console.log("条数一致:", d.items.length === p.items.length, d.items.length, "vs", p.items.length);
console.log("都有中文摘要:", d.items.every(i => i.titleZh && i.summaryZh));
console.log("没有残留 excerpt:", d.items.every(i => !("excerpt" in i)));
const lens = d.items.map(i => [...i.summaryZh].length);
console.log("摘要字数 min/中位/max:", Math.min(...lens), lens.sort((a,b)=>a-b)[Math.floor(lens.length/2)], Math.max(...lens));
'
```
Expected: 前三项都是 `true`，摘要字数中位数落在 60-120 区间。
若中位数明显偏离，回到 Step 3 调整后重写。

- [ ] **Step 5: 构建页面**

Run: `npm run build`
Expected: 输出「已生成 dist/index.html：N 天 / M 条 / K KB」。
K 若超过 1500 KB，说明摘要写得过长或条目过多，回到 Step 3 检查。

- [ ] **Step 6: 本地打开确认**

Run: `open dist/index.html`

确认真实数据下页面正常：日历有当天、条目按类型分组、摘要是中文、
信源管理里两张表都对、底部错误提示与 `_pending.json` 的 `errors` 一致。

- [ ] **Step 7: 发布到原 Artifact URL**

用 Artifact 工具发布，参数必须是：

- `file_path`: `/Users/yuemao/workspace/news/dist/index.html`
- `url`: `https://claude.ai/code/artifact/24e0433d-3c33-4e84-8638-0c663708b9c9`
- `favicon`: `🧭`
- `description`: `每日更新的 AI 信源阅读器：中文摘要、30 天回溯、已读与标星`

Expected: 发布成功，返回的还是原来那个 URL。

- [ ] **Step 8: 在浏览器里打开线上版本确认**

打开 `https://claude.ai/code/artifact/24e0433d-3c33-4e84-8638-0c663708b9c9`，
确认 localStorage 在 artifact 的 iframe 环境里确实可用——
点几个 ☐ 和 ☆，刷新页面，看状态是否保留。

**这一步若失败**（iframe 的存储被沙箱隔离），已读/标星功能就不成立，
必须停下来告诉用户，并重新讨论方案，不要继续往下走。

- [ ] **Step 9: 写 DAILY.md**

Create `DAILY.md`：

```markdown
# 每日流程

云端 scheduled agent 每天北京时间 08:00 照此执行。每一步失败都要在最终汇报里说明，不要静默跳过。

## 1. 抓取

    npm ci --omit=dev
    npm run fetch

产出 `data/_pending.json`。输出里会打印新条目数、失败源数，
以及连续失败 7 天以上的源清单。

## 2. 写中文摘要

读 `data/_pending.json`，为每条写 `titleZh` 与 `summaryZh`，写入 `data/<date>.json`。

- `titleZh`：中文标题，意译不直译。原文是中文的直接沿用 `titleOriginal`。
- `summaryZh`：3-4 句，60-120 字，说清「这篇在讲什么、结论是什么」。
- `brief: true` 的条目（播客/视频）：`excerpt` 是官方简介而非正文，
  如实基于简介写，**不要编造节目内容**。
- 保留除 `excerpt` 外的全部原字段。顶层结构 `{ date, generatedAt, items, errors }`，
  `errors` 原样复制。
- 条目多时分批处理，每批 20-30 条。

若 `_pending.json` 的 `items` 为空（当天没有任何新内容），
仍要写出一个 `items: []` 的当天文件，让日历上出现这一天。

## 3. 构建并发布

    npm run build

然后用 Artifact 工具发布 `dist/index.html`：

- `url`: `https://claude.ai/code/artifact/24e0433d-3c33-4e84-8638-0c663708b9c9`
- `favicon`: `🧭`（固定不变）

`url` 必须传，否则会新建一个 artifact 而不是更新原来那个。

## 4. 提交

    git add -A
    git commit -m "每日更新：<date>，<N> 条"
    git push

## 5. 汇报

一段话说明：新增多少条、多少个源抓取失败、有没有连续失败 7 天以上的源。
有连续失败的源要点名，由用户决定修 feed 还是停用。
```

- [ ] **Step 10: 写 README.md**

Create `README.md`：

```markdown
# AI 信源罗盘

每天抓取 97 个 AI 信源的新内容，生成中文摘要，发布到
<https://claude.ai/code/artifact/24e0433d-3c33-4e84-8638-0c663708b9c9>。

## 结构

- `sources.json` — 信源列表，**唯一真相源**。增删信源改这里。
- `scripts/fetch.mjs` — 并发抓 feed，去重，产出 `data/_pending.json`
- `scripts/build.mjs` — 把最近 30 天数据内嵌进 `dist/index.html`
- `scripts/discover-feeds.mjs` — 探测信源的 feed 地址（新增信源后跑一次）
- `lib/` — feed 解析、HTML 转文本、URL 指纹、存储层、页面渲染
- `templates/` — 页面的 CSS 与浏览器端 JS，构建时内联进 HTML
- `data/` — `seen.json` 去重记录、`status.json` 各源抓取状态、`YYYY-MM-DD.json` 每天的条目
- `DAILY.md` — 云端定时 agent 每天执行的流程

## 本地跑一遍

    npm ci
    npm test
    npm run fetch
    # 手工或由 Claude 写摘要生成 data/<date>.json
    npm run build
    open dist/index.html

## 增删信源

告诉 Claude「加一个 X」或「把 Y 删了」即可。新增的源需要跑一次
`node scripts/discover-feeds.mjs` 探测 feed 地址。改动次日生效。

## 已知限制

已读与标星存在浏览器 localStorage，按设备隔离，换设备或清缓存会丢失。
Artifact 页面没有服务端存储，这是平台约束。信源管理页有「导出收藏」可做备份。
```

- [ ] **Step 11: 提交并推送**

```bash
git add -A
git commit -m "首次端到端运行：抓取、摘要、构建、发布，并补齐流程文档

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

- [ ] **Step 12: 创建云端定时 agent**

调用 `schedule` skill，按它的指引创建一个 routine：

- 仓库：`https://github.com/maoyue2004/news`（private）
- 时间：每天北京时间 08:00（`Asia/Shanghai`）
- 提示词：

```
读 DAILY.md 并严格照其中的四步执行：抓取、写中文摘要、构建并发布到指定 artifact URL、提交推送。
最后按第 5 节的要求汇报。任何一步失败都要在汇报里说清楚，不要静默跳过。
```

创建后**立刻手动触发一次**，验证云端环境确实能：
1. 拿到私有仓库的代码
2. 跑 `npm ci` 装依赖
3. 联网抓 feed
4. 调用 Artifact 工具发布
5. `git push` 回仓库

**若云端环境不具备其中任何一项**（尤其是第 4 项，Artifact 工具在 routine 里未必可用），
停下来把具体缺什么告诉用户，并给出退路：改成 routine 只负责抓取+摘要+提交，
发布环节退回到本地手动触发。不要假装成功。

- [ ] **Step 13: 最终汇报**

向用户汇报：线上 artifact 已更新（附链接）、今天收了多少条、
多少个源没抓到、routine 是否创建成功并手动跑通、
以及那 18 个没有 feed 的源的清单（让用户知道哪些内容不在覆盖范围内）。

---

## 自查记录

**Spec 覆盖检查**

| spec 要求 | 对应任务 |
|---|---|
| 每天新内容列表 + 中文摘要 | Task 6（抓取）、Task 10 Step 3（摘要规格）、DAILY.md 第 2 节 |
| 最近一个月可追溯 | Task 5（`loadRecentDays`/`pruneDayFiles`）、Task 9（30 天窗口）、Task 8（日历） |
| 信源可编辑（增删） | Task 1（`sources.json`）、Task 4（feed 探测）、README「增删信源」、Task 8（只读信源管理页） |
| 已读打钩 / 标星 | Task 8（localStorage + 导出收藏）、Task 10 Step 8（线上验证存储可用） |
| 云端每天 08:00 触发 | Task 10 Step 12 |
| 播客/视频只翻译简介且标注 | Task 6（`brief` 标记）、Task 8（`brief-note` 徽标）、Task 10 Step 3 |
| 无 feed 的源标 `enabled: false` | Task 4 Step 3、Task 8（信源管理页「未启用」表） |
| 抓取失败不中断、连续 7 天点名 | Task 5（`recordFailure`）、Task 6（错误收集）、Task 8（底部错误提示） |
| 页面自包含、CSP 兼容 | Task 7（内联 CSS/JS，测试断言无外部引用） |
| 亮暗双主题、760px 单栏 | Task 7（`page.css` + 测试断言） |
| 沿用原配色变量 | Task 7（`page.css` 变量与原 artifact 一致） |
| 数据保留 35 天 | Task 9（`KEEP_DAYS`）、Task 5（`pruneDayFiles` 测试） |
| 发布保持原 URL | Global Constraints、Task 10 Step 7、DAILY.md 第 3 节 |

**类型一致性检查**：`FeedItem` 的字段（`title`/`link`/`publishedAt`/`contentHtml`）
在 Task 2 定义、Task 6 消费，命名一致。`PendingItem` 在数据格式约定一节定义，
Task 6 产出、Task 10 Step 3 消费、Task 7/8 渲染，字段名一致。
`SourceStatus` 在 Task 5 定义，Task 6 写入、Task 8 读取（`consecutiveFailures`/`lastErrorMessage`/`lastSuccess`），一致。
`renderPage` 的入参 `{ days, sources, status, generatedAt }` 在 Task 7 定义、Task 9 调用，一致。

**已知的计划外风险**（实施时若命中要停下来告知用户，不要自行绕过）：
1. Artifact iframe 里 localStorage 可能被沙箱隔离 → Task 10 Step 8 专门验证。
2. 云端 routine 可能没有 Artifact 发布工具 → Task 10 Step 12 专门验证并给了退路。
3. 部分站点会用 Cloudflare 挡住非浏览器 UA → 会体现为 Task 4 探测失败，
   相应源标为 `enabled: false`，属于可接受的降级。
