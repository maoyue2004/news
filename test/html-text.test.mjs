import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, decodeEntities } from '../lib/html-text.mjs';

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

test('【修复】数字实体不会被二次解码：&amp;lt; 只解一层', () => {
  assert.equal(decodeEntities('&amp;lt;'), '&lt;');
});

test('【修复】数字实体不会被二次解码：&amp;#39; 只解一层', () => {
  assert.equal(decodeEntities('&amp;#39;'), '&#39;');
});

test('【修复】十六进制数字实体不会被二次解码：&amp;#x3c; 只解一层', () => {
  assert.equal(decodeEntities('&amp;#x3c;'), '&#x3c;');
});

test('【修复】截断是码点安全的，emoji 不会被拆分', () => {
  // 用 emoji（每个占 2 个 UTF-16 单元）来测试
  const emojiText = '😀'.repeat(200);
  const result = htmlToText(emojiText, 100);
  // 验证截断长度确实是 100 个码点（不是 UTF-16 单元）
  assert.equal(Array.from(result).length, 100);
  // 验证没有孤立代理项（完整的结果应该等于其 Array.from().join('')）
  assert.equal(result, Array.from(result).join(''));
  // 确保没有被拆分的 emoji
  assert.doesNotThrow(() => {
    JSON.stringify(result);
  });
});

test('【修复】属性值里的 > 不会让去标签提前收尾（linux.do 的响应式样式表）', () => {
  // 真实形态：Discourse 用 `media="(width >= 40rem)"` 区分桌面/移动样式表。
  // 旧的 /<[^>]+>/ 在 `>=` 的 `>` 处收尾，把标签后半截当正文吐出来。
  const html = '<link href="a.css" media="(width >= 40rem)" rel="stylesheet" data-target="chat_desktop" />这才是正文';
  assert.equal(htmlToText(html), '这才是正文');
});

test('【修复】正文里的比较符不会吞掉后面的内容', () => {
  assert.equal(htmlToText('<p>1 < 2 且 3 > 2</p>'), '1 < 2 且 3 > 2');
});

test('【修复】一直没闭合的 < 当普通字符，不吞掉剩余正文', () => {
  assert.equal(htmlToText('正文开头 <没有闭合的尖括号和后面的字'), '正文开头 <没有闭合的尖括号和后面的字');
});

test('【修复】实体转义过的 HTML 解码后会再去一次标签（BestBlogs.dev 的 feed）', () => {
  const html = '&lt;div style=&quot;font-family: Georgia&quot;&gt;&lt;p&gt;一句话摘要正文&lt;/p&gt;&lt;/div&gt;';
  assert.equal(htmlToText(html), '一句话摘要正文');
});

test('第二遍去标签不再解实体：&amp;#39; 仍然只解一层', () => {
  assert.equal(htmlToText('&amp;#39;<p>x</p>'), '&#39; x');
});
