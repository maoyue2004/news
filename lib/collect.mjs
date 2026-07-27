import { parseFeed } from './feed-parse.mjs';
import { htmlToText } from './html-text.mjs';
import { itemId } from './fingerprint.mjs';

/** 首次运行时不把 feed 里的全部历史都灌进来，只收最近这些天发布的。 */
const MAX_AGE_DAYS = 14;
const EXCERPT_CHARS = 2000;
const BRIEF_TYPES = new Set(['podcast', 'video']);

export function collectFromFeed({ source, xml, seen, today, now }) {
  const { items: raw } = parseFeed(xml);
  const brief = BRIEF_TYPES.has(source.type);
  const cutoff = Date.parse(`${today}T00:00:00Z`) - MAX_AGE_DAYS * 86400000;

  const out = [];
  const seenThisRun = new Set();

  for (const it of raw) {
    if (!it.link) continue;

    const publishedAt = it.publishedAt ?? now;
    if (Date.parse(publishedAt) < cutoff) continue;

    const id = itemId(it.link);
    if (seen[id] || seenThisRun.has(id)) continue;
    seenThisRun.add(id);

    out.push({
      id,
      source: source.name,
      type: source.type,
      lang: source.lang,
      url: it.link,
      titleOriginal: it.title || '(无标题)',
      publishedAt,
      excerpt: htmlToText(it.contentHtml, EXCERPT_CHARS),
      brief,
    });
  }

  return { items: out };
}
