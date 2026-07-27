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
