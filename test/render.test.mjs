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
