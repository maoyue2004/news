import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractArticleText, extractArticleParts } from '../lib/enrich.mjs';

test('优先取 <article> 的内容，忽略页面其它部分', () => {
  const html = `
    <html><body>
      <header>Site Header</header>
      <div class="sidebar">Sidebar junk</div>
      <article><p>这是正文第一段。</p><p>这是正文第二段。</p></article>
      <footer>Site Footer</footer>
    </body></html>`;
  const text = extractArticleText(html);
  assert.equal(text, '这是正文第一段。 这是正文第二段。');
});

test('没有 <article> 时退回 <main>', () => {
  const html = `
    <html><body>
      <nav>导航链接</nav>
      <main><p>main 里的正文内容。</p></main>
    </body></html>`;
  const text = extractArticleText(html);
  assert.equal(text, 'main 里的正文内容。');
});

test('既没有 <article> 也没有 <main> 时退回 <body>', () => {
  const html = `<html><body><p>只有 body 里的正文。</p></body></html>`;
  const text = extractArticleText(html);
  assert.equal(text, '只有 body 里的正文。');
});

test('剔除 nav/header/footer/aside/form/script/style/noscript 及其内容', () => {
  const html = `
    <html><body>
      <article>
        <nav>导航噪声</nav>
        <header>文章内头部噪声</header>
        <p>真正的正文。</p>
        <aside>侧边栏噪声</aside>
        <form><input value="表单噪声"></form>
        <script>var junk = "脚本噪声";</script>
        <style>.x{color:红}</style>
        <noscript>无脚本提示噪声</noscript>
        <footer>文章内尾部噪声</footer>
      </article>
    </body></html>`;
  const text = extractArticleText(html);
  assert.equal(text, '真正的正文。');
});

test('按 maxChars 截断，且按码点计数（复用 htmlToText 的截断逻辑）', () => {
  const html = `<article><p>${'字'.repeat(3000)}</p></article>`;
  const text = extractArticleText(html, 100);
  assert.equal(Array.from(text).length, 100);
});

test('空输入返回空串', () => {
  assert.equal(extractArticleText(''), '');
  assert.equal(extractArticleText(null), '');
  assert.equal(extractArticleText(undefined), '');
});

test('嵌套 <article>（相关文章/推荐阅读组件）不会导致真正的正文被丢弃', () => {
  const html = '<article><div><article>广告内容</article></div><p>真正的正文内容。</p></article>';
  const text = extractArticleText(html);
  assert.match(text, /真正的正文内容/);
});

test('嵌套 <main>（同类结构）也不会导致真正的正文被丢弃', () => {
  const html = '<body><main><div><main>推荐侧栏内容</main></div><p>main 里真正的正文。</p></main></body>';
  const text = extractArticleText(html);
  assert.match(text, /main 里真正的正文/);
});

test('贪婪匹配不会把 </article> 之后的页脚等内容也吸进来', () => {
  const html = '<article>正文内容。</article><footer>页脚版权信息</footer>';
  const text = extractArticleText(html);
  assert.doesNotMatch(text, /页脚/);
});

test('贪婪匹配在 </article> 处停止，不吸入其后未被判定为噪声的兄弟内容', () => {
  const html = '<article>正文内容。</article><div class="related">你可能还喜欢：其它文章推荐</div>';
  const text = extractArticleText(html);
  assert.doesNotMatch(text, /其它文章推荐/);
});

test('extractArticleParts 带回正文真正的结尾，正文没被截断时不重复存', () => {
  const body = `<article><p>${'折腾记录。'.repeat(200)}</p><p>项目地址在 GitHub，欢迎 star。</p></article>`;
  const { text, tail } = extractArticleParts(body, 300, 40);
  assert.equal(Array.from(text).length, 300, 'text 仍然按 maxChars 截断，和 extractArticleText 一致');
  assert.equal(text, extractArticleText(body, 300), '不改变原有取值');
  assert.ok(tail.includes('欢迎 star'), '结尾要来自正文最后一段，而不是被截断处');
  assert.equal(Array.from(tail).length, 40);

  // 正文本来就短：excerpt 自己的尾巴就是真尾巴，不必多存一份
  assert.equal(extractArticleParts('<article><p>短正文，欢迎 star。</p></article>', 300, 40).tail, '');
});
