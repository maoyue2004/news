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

test('【修复】同一篇文章从不同 feed 进来（?sc= 来源标记）算出同一个 id', () => {
  // iT 邦幫忙全站 feed 打 ?sc=rss.qu，铁人赛系列 feed 打 ?sc=rss.iron。
  // 不归一化的话同一篇文章有两个 id，seen.json 挡不住，会隔天重复收录。
  const a = 'https://ithelp.ithome.com.tw/articles/10402000?sc=rss.qu';
  const b = 'https://ithelp.ithome.com.tw/articles/10402000?sc=rss.iron';
  const bare = 'https://ithelp.ithome.com.tw/articles/10402000';
  assert.equal(itemId(a), itemId(b));
  assert.equal(itemId(a), itemId(bare));
  // spm 同理（阿里系站点的来源标记）
  assert.equal(itemId('https://example.com/a?spm=1001.2014'), itemId('https://example.com/a'));
});

test('保留非 utm 的查询参数', () => {
  assert.notEqual(itemId('https://example.com/a?id=1'), itemId('https://example.com/a'));
});

test('无法解析为 URL 时对原始字符串做哈希，不抛错', () => {
  assert.match(itemId('not a url'), /^[0-9a-f]{16}$/);
});

test('【修复】末尾斜杠裁剪在有查询参数时不失效', () => {
  // https://e.com/a/ 和 https://e.com/a?id=1 应该有不同 id（前者没参数，后者有）
  // 但 https://e.com/a/?id=1 和 https://e.com/a?id=1 应该有相同 id（路径都是 /a）
  assert.equal(itemId('https://e.com/a/?id=1'), itemId('https://e.com/a?id=1'));
});

test('【修复】scheme 与 www 前缀归一化', () => {
  const base = itemId('https://example.com/a');
  // http 转为 https
  assert.equal(itemId('http://example.com/a'), base);
  // www 前缀去掉
  assert.equal(itemId('https://www.example.com/a'), base);
  // 两者都改
  assert.equal(itemId('http://www.example.com/a'), base);
});

test('【修复】查询参数顺序不影响 id', () => {
  assert.equal(
    itemId('https://example.com/a?x=1&y=2'),
    itemId('https://example.com/a?y=2&x=1'),
  );
});
