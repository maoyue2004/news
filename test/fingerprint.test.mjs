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
