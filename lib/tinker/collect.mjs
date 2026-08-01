import { parseFeed } from '../feed-parse.mjs';
import { htmlToText } from '../html-text.mjs';
import { itemId } from '../fingerprint.mjs';

/**
 * 折腾志的收集层。
 *
 * 没有直接用 lib/collect.mjs：那个是为信源罗盘写的，会丢掉 author / metrics / tags /
 * 命中的查询词这些字段。这些字段在折腾志里不是装饰——
 * 「谁写的」「多少人回复」直接参与后面的排序和「值不值得读」判断。
 */

/** 个人博客更新慢，两三周前的好文章仍然值得推。比信源罗盘的 14 天放宽一些。 */
export const MAX_AGE_DAYS = 21;
const EXCERPT_CHARS = 2500;

export function collectRaw({ source, raw, seen, today, now, maxAgeDays = MAX_AGE_DAYS }) {
  const cutoff = Date.parse(`${today}T00:00:00Z`) - maxAgeDays * 86400000;
  const out = [];
  const thisRun = new Set();

  for (const it of raw) {
    if (!it.link) continue;
    const publishedAt = it.publishedAt ?? now;
    if (Date.parse(publishedAt) < cutoff) continue;

    const id = itemId(it.link);
    if (seen[id] || thisRun.has(id)) continue;
    thisRun.add(id);

    out.push({
      id,
      source: source.name,
      kind: source.kind,
      url: it.link,
      titleOriginal: it.title || '(无标题)',
      publishedAt,
      excerpt: htmlToText(it.contentHtml, EXCERPT_CHARS),
      ...(it.author ? { author: it.author } : {}),
      ...(it.metrics ? { metrics: it.metrics } : {}),
      ...(it.tags?.length ? { tags: it.tags } : {}),
      ...(it.query ? { matchedQuery: it.query } : {}),
    });
  }
  return out;
}

export function collectFeed({ source, xml, seen, today, now }) {
  return collectRaw({ source, raw: parseFeed(xml).items, seen, today, now });
}
