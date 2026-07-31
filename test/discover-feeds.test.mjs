import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appleSearchTerm,
  candidateFeedUrls,
  isUndiscoverable,
  podcastMatchScore,
  youtubeChannelIdFromHtml,
} from '../scripts/discover-feeds.mjs';

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

test('识别出目前没有开放目录的搜索页链接', () => {
  assert.ok(isUndiscoverable('https://weixin.sogou.com/weixin?type=1&query=x'));
  assert.ok(isUndiscoverable('https://www.zhihu.com/search?q=x'));
  assert.equal(isUndiscoverable('https://podcasts.apple.com/us/search?term=x'), false);
  assert.equal(isUndiscoverable('https://simonwillison.net/'), false);
});

test('从 Apple Podcasts 搜索页取出目录查询词', () => {
  assert.equal(appleSearchTerm('https://podcasts.apple.com/us/search?term=AI%20Odyssey'), 'AI Odyssey');
  assert.equal(appleSearchTerm('https://example.com/search?term=x'), null);
});

test('播客名匹配允许副标题和 Podcast 通用后缀', () => {
  assert.equal(podcastMatchScore('No Priors', 'No Priors: Artificial Intelligence | Technology | Startups'), 80);
  assert.equal(podcastMatchScore('a16z Podcast', 'The a16z Show'), 100);
  assert.equal(podcastMatchScore('原点Talk', '口头拼贴'), 0);
  assert.equal(podcastMatchScore('Breathe', 'Brea'), 0);
});
