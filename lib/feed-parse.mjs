import { XMLParser } from 'fast-xml-parser';
import { decodeEntities } from './html-text.mjs';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  trimValues: true,
  // 关闭实体展开：真实 feed 正文常含大量 HTML 转义字符，很容易超过
  // fast-xml-parser 默认的实体展开上限（1000），触发
  // "Entity expansion limit exceeded" 而解析失败。我们抓取的是不可信的
  // 远程 feed，调高上限等于放弃 billion-laughs 式实体炸弹的防护；关闭
  // 实体展开则完全没有这个攻击面。正文本来就要经 htmlToText() 解码实体，
  // 这里再解一遍也是多余的。
  //
  // 副作用：title 和 link（RSS <link> 文本 / Atom <link href>）里的实体
  // 不会被这个解析器解码了，需要我们自己在 parseRss/parseAtom/
  // pickAtomLink 里对它们调用 decodeEntities——link 是直接渲染给用户点击、
  // 也是 itemId() 算稳定 id 的输入，不解码会产生坏链接，还会因为 & 被
  // 截断成 &amp; 而让 id 与正确 URL 的 id 不一致（去重和已读状态都靠它）。
  // 千万不要对 contentHtml 做同样的事——下游 htmlToText 会解码一次，
  // 这里再解一次就是二次解码，会把 "&amp;lt;" 错误地变成 "<"
  // （正确结果应该是 "&lt;"）。
  processEntities: false,
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
    title: decodeEntities(text(it.title)),
    // link 是纯文本字段（不会再经 htmlToText），且真实 feed 里常见
    // ?utm_source=...&utm_medium=... 这种在 XML 里转义成 &amp; 的查询串，
    // 必须解码，否则渲染出的原文链接是坏的，itemId() 算出的稳定 id 也会
    // 因为 & 被截断成 &amp; 而与正确 URL 的 id 不一致。
    link: decodeEntities(text(it.link)),
    publishedAt: toIso(it.pubDate ?? it['dc:date']),
    // 注意：contentHtml 不经 decodeEntities，留给下游 htmlToText() 解码，
    // 避免二次解码。
    contentHtml: text(it['content:encoded']) || text(it.description),
  }));
  return { items };
}

function pickAtomLink(link) {
  const links = asArray(link);
  const alternate = links.find((l) => typeof l === 'object' && l['@rel'] === 'alternate');
  const chosen = alternate ?? links.find((l) => typeof l === 'object' && !l['@rel']) ?? links[0];
  if (!chosen) return '';
  const raw = typeof chosen === 'object' ? String(chosen['@href'] ?? '') : String(chosen);
  // href 属性同样可能带 &amp; 转义的查询串（例如 YouTube 的
  // ?v=...&feature=...），需要和 RSS 的 <link> 一样解码。
  return decodeEntities(raw);
}

function parseAtom(feed) {
  const items = asArray(feed.entry).map((en) => ({
    title: decodeEntities(text(en.title)),
    link: pickAtomLink(en.link),
    publishedAt: toIso(en.published ?? en.updated),
    // 注意：contentHtml 不经 decodeEntities，留给下游 htmlToText() 解码，
    // 避免二次解码。
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
