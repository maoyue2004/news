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
/** 额外留存的正文结尾长度，和 relevance.mjs 里结尾判据看的窗口一致。 */
const TAIL_CHARS = 400;

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

    // 正文真正的结尾。feed 给全文时（个人博客大多如此）excerpt 同样截在 2500 字符，
    // 「结尾落在推广语上」那条判据量的就不再是结尾，而是正文的腰。
    // 只在被截断时才存——没截断的话 excerpt 自己的尾巴就是真尾巴。见 lib/enrich.mjs。
    const full = htmlToText(it.contentHtml, Number.MAX_SAFE_INTEGER);
    const fullChars = Array.from(full);
    const tail = fullChars.length > EXCERPT_CHARS ? fullChars.slice(-TAIL_CHARS).join('') : '';

    out.push({
      id,
      source: source.name,
      kind: source.kind,
      // 「抓法」和「抓到什么」是两回事：掘金搜索和 V2EX 搜索的 kind 都是 search，
      // 但前者返回文章、后者返回论坛帖。下游的篇幅惩罚和占比上限只该管后者。
      ...(source.thread ? { thread: true } : {}),
      // 落地页是站方生成的摘要而不是作者原文——整源不进评审名单，只留在 rejected 里当原文源线索。
      ...(source.summaryPage ? { summaryPage: true } : {}),
      url: it.link,
      titleOriginal: it.title || '(无标题)',
      publishedAt,
      excerpt: fullChars.slice(0, EXCERPT_CHARS).join(''),
      ...(tail ? { tail } : {}),
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
