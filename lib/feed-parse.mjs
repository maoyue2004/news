import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  trimValues: true,
  // 保留 CDATA 与实体解码后的文本
  processEntities: true,
});

function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** fast-xml-parser 在有属性时把文本放进 '#text'，这里统一取出字符串。 */
function text(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object' && '#text' in v) return String(v['#text']);
  return '';
}

function toIso(raw) {
  const s = text(raw).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseRss(channel) {
  const items = asArray(channel.item).map((it) => ({
    title: text(it.title),
    link: text(it.link),
    publishedAt: toIso(it.pubDate ?? it['dc:date']),
    contentHtml: text(it['content:encoded']) || text(it.description),
  }));
  return { items };
}

function pickAtomLink(link) {
  const links = asArray(link);
  const alternate = links.find((l) => typeof l === 'object' && l['@rel'] === 'alternate');
  const chosen = alternate ?? links.find((l) => typeof l === 'object' && !l['@rel']) ?? links[0];
  if (!chosen) return '';
  return typeof chosen === 'object' ? String(chosen['@href'] ?? '') : String(chosen);
}

function parseAtom(feed) {
  const items = asArray(feed.entry).map((en) => ({
    title: text(en.title),
    link: pickAtomLink(en.link),
    publishedAt: toIso(en.published ?? en.updated),
    contentHtml:
      text(en.content) ||
      text(en.summary) ||
      text(en['media:group']?.['media:description']),
  }));
  return { items };
}

export function parseFeed(xml) {
  const doc = parser.parse(xml);
  if (doc?.rss?.channel) return parseRss(doc.rss.channel);
  if (doc?.feed) return parseAtom(doc.feed);
  if (doc?.['rdf:RDF']) {
    // RSS 1.0 / RDF：item 在顶层而非 channel 下
    return parseRss(doc['rdf:RDF']);
  }
  throw new Error('无法识别的 feed 格式');
}
