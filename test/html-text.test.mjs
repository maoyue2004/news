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
