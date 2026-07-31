import { decodeEntities, htmlToText } from './html-text.mjs';

function iso(raw) {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function unique(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item.link || seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });
}

function clean(raw) {
  return htmlToText(raw ?? '', 10000);
}

function item(title, link, publishedAt, contentHtml = '') {
  return { title: clean(title), link, publishedAt: iso(publishedAt), contentHtml };
}

export function parseTheBatch(html) {
  const out = [];
  for (const match of html.matchAll(/<article\b[\s\S]*?<\/article>/gi)) {
    const block = match[0];
    const link = /href="(\/the-batch\/issue-\d+)"/i.exec(block)?.[1];
    if (!link) continue;
    const date = /href="\/the-batch\/tag\/[^"]+"[^>]*>([^<]+)<\/a>/i.exec(block)?.[1];
    const title = /<(?:h2|h3)\b[^>]*>([\s\S]*?)<\/(?:h2|h3)>/i.exec(block)?.[1]
      ?? /aria-label="([^"]+)"[^>]+href="\/the-batch\/issue-/i.exec(block)?.[1];
    const description = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1] ?? '';
    if (title && date) out.push(item(title, `https://www.deeplearning.ai${link}`, `${date} UTC`, description));
  }
  return unique(out);
}

export function parseEpoch(html) {
  const out = [];
  const starts = [...html.matchAll(/<div class="card cover-link-parent card-article-listing/g)].map((match) => match.index);
  for (let i = 0; i < starts.length; i += 1) {
    const block = html.slice(starts[i], starts[i + 1] ?? starts[i] + 10000);
    const path = /<a href="([^"]+)" class="cover-link"><\/a>/i.exec(block)?.[1];
    const afterLink = path ? block.slice(block.indexOf(`href="${path}"`)) : '';
    const title = /<span class="trim">([\s\S]*?)<\/span>/i.exec(afterLink)?.[1];
    const description = /<p class="body-3 trim">([\s\S]*?)<\/p>/i.exec(block)?.[1] ?? '';
    const date = [...block.matchAll(/<span class="badge-text">([^<]+)<\/span>/gi)]
      .map((match) => clean(match[1]).replace(/([A-Z][a-z]{2})\./, '$1'))
      .find((value) => iso(value));
    if (!path?.startsWith('/')) continue;
    if (title && date) out.push(item(title, `https://epoch.ai${path}`, `${date} UTC`, description));
  }
  return unique(out);
}

export function parseRundown(html) {
  const out = [];
  const re = /"web_title":"((?:\\.|[^"\\])*)","web_subtitle":"((?:\\.|[^"\\])*)"[\s\S]{0,1000}?"slug":"([^"]+)"[\s\S]{0,600}?"scheduled_at":"([^"]+)"/g;
  for (const match of html.matchAll(re)) {
    const [, rawTitle, rawDescription, slug, date] = match;
    let title = rawTitle;
    let description = rawDescription;
    try {
      title = JSON.parse(`"${rawTitle}"`);
      description = JSON.parse(`"${rawDescription}"`);
    } catch {
      // Beehiiv 的字段通常是 JSON 字符串；即使偶遇坏转义，也保留原文本。
    }
    out.push(item(title, `https://www.therundown.ai/p/${slug}`, date, description));
  }
  return unique(out);
}

export function parseAlignmentIndex(html) {
  const out = [];
  let month = null;
  const re = /<div class="date">([^<]+)<\/div>|<a href="([^"]+)" class="note">[\s\S]*?<h3>([\s\S]*?)<\/h3>[\s\S]*?<div class="description">([\s\S]*?)<\/div>[\s\S]*?<\/a>/gi;
  for (const match of html.matchAll(re)) {
    if (match[1]) {
      month = clean(match[1]);
      continue;
    }
    if (!month || !match[2]) continue;
    out.push({
      ...item(match[3], new URL(match[2], 'https://alignment.anthropic.com/').href, `${month} 1 UTC`, match[4]),
      month,
    });
  }
  return out;
}

export function parseAlignmentDate(html) {
  const year = /\byear\s*=\s*\{(\d{4})\}/i.exec(html)?.[1];
  const month = /\bmonth\s*=\s*\{([^}]+)\}/i.exec(html)?.[1];
  const day = /\bday\s*=\s*\{(\d{1,2})\}/i.exec(html)?.[1];
  return year && month && day ? iso(`${month} ${day}, ${year} UTC`) : null;
}

export function parseSitemap(xml, include) {
  let allowed;
  try {
    allowed = include ? new RegExp(include) : null;
  } catch {
    throw new Error(`无效的 sitemap include 正则：${include}`);
  }
  const out = [];
  for (const match of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const block = match[1];
    const link = decodeEntities(/<loc>([^<]+)<\/loc>/i.exec(block)?.[1] ?? '');
    const lastmod = /<lastmod>([^<]+)<\/lastmod>/i.exec(block)?.[1];
    if (link && (!allowed || allowed.test(link))) out.push({ link, lastmod: iso(lastmod) });
  }
  return out;
}

function metaContent(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i').exec(html)?.[1]
    ?? new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i').exec(html)?.[1]
    ?? '';
}

export function parseArticleMeta(html, link, fallbackDate) {
  const title = metaContent(html, 'og:title') || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || link;
  const description = metaContent(html, 'og:description') || metaContent(html, 'description');
  const published = /"datePublished"\s*:\s*"([^"]+)"/i.exec(html)?.[1]
    || metaContent(html, 'article:published_time')
    || fallbackDate;
  return item(title, link, published, description);
}

export function parseSinaMedia(html) {
  const out = [];
  for (const match of html.matchAll(/<a class="post-link" href="([^"]+)">[\s\S]*?<article class="post">([\s\S]*?)<\/article>[\s\S]*?<\/a>/gi)) {
    const [, path, block] = match;
    const date = /<div class="time">\s*([^<]+)/i.exec(block)?.[1]?.trim();
    const body = /<div class="post-text">([\s\S]*?)<\/div>/i.exec(block)?.[1] ?? '';
    const title = clean(body).slice(0, 120) || '(无标题)';
    if (date) out.push(item(title, new URL(path, 'https://www.sina.cn/').href, `${date}+08:00`, body));
  }
  return unique(out);
}

export function parseWaytoagi(html) {
  const out = [];
  const re = /href="(https:\/\/blog\.waytoagi\.com\/article\/news-(\d{4})(\d{2})(\d{2}))"[\s\S]{0,1000}?<div class="text-sm font-bold">([\s\S]*?)<\/div>\s*<div class="text-gray-500[^>]*>([\s\S]*?)<\/div>/gi;
  for (const match of html.matchAll(re)) {
    const [, link, year, month, day, title, description] = match;
    out.push(item(title, link, `${year}-${month}-${day}T00:00:00+08:00`, description));
  }
  return unique(out);
}

export function parseGwernNewsletter(html, link) {
  const title = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const description = /<div class="page-description">([\s\S]*?)<\/div>/i.exec(html)?.[1] ?? metaContent(html, 'description');
  const date = /\/newsletter\/(\d{4})\/(\d{2})/.exec(link);
  if (!title || !date) return null;
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] ?? description;
  return item(title, link, `${date[1]}-${date[2]}-01T00:00:00Z`, article);
}

async function mapConcurrent(values, concurrency, fn) {
  const out = [];
  for (let i = 0; i < values.length; i += concurrency) {
    out.push(...(await Promise.all(values.slice(i, i + concurrency).map(fn))));
  }
  return out;
}

export async function fetchAdapterItems({ source, html, fetchText, now = new Date().toISOString() }) {
  let items;
  switch (source.adapter) {
    case 'the-batch':
      items = parseTheBatch(html);
      break;
    case 'epoch':
      items = parseEpoch(html);
      break;
    case 'rundown':
      items = parseRundown(html);
      break;
    case 'alignment': {
      const cutoff = Date.parse(now) - 75 * 86400000;
      const candidates = parseAlignmentIndex(html).filter((entry) => Date.parse(entry.publishedAt) >= cutoff);
      items = await mapConcurrent(candidates, 6, async (entry) => {
        const articleHtml = await fetchText(entry.link);
        return { ...entry, publishedAt: parseAlignmentDate(articleHtml) ?? entry.publishedAt };
      });
      break;
    }
    case 'sitemap': {
      const cutoff = Date.parse(now) - 45 * 86400000;
      const candidates = parseSitemap(html, source.include)
        .filter((entry) => !entry.lastmod || Date.parse(entry.lastmod) >= cutoff)
        .sort((a, b) => Date.parse(b.lastmod ?? 0) - Date.parse(a.lastmod ?? 0))
        .slice(0, 40);
      items = await mapConcurrent(candidates, 8, async (entry) => {
        const articleHtml = await fetchText(entry.link);
        return parseArticleMeta(articleHtml, entry.link, entry.lastmod);
      });
      break;
    }
    case 'sina-media':
      items = parseSinaMedia(html);
      break;
    case 'waytoagi':
      items = parseWaytoagi(html);
      break;
    case 'gwern-newsletter': {
      const current = new Date(now);
      const derived = [];
      for (let offset = 0; offset < 5; offset += 1) {
        const month = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - offset, 1));
        derived.push(`https://gwern.net/newsletter/${month.getUTCFullYear()}/${String(month.getUTCMonth() + 1).padStart(2, '0')}`);
      }
      const archived = [...html.matchAll(/href="(\/newsletter\/\d{4}\/\d{2})/g)]
        .map((match) => new URL(match[1], 'https://gwern.net/').href);
      const links = [...new Set([...derived, ...archived.sort().reverse()])].slice(0, 6);
      items = (await mapConcurrent(links, 4, async (link) => {
        try {
          const newsletter = await fetchText(link);
          return parseGwernNewsletter(newsletter, link);
        } catch {
          // 月初时本月 newsletter 可能尚未建立，继续尝试前几个月。
          return null;
        }
      })).filter(Boolean);
      break;
    }
    default:
      throw new Error(`未知 source adapter：${source.adapter}`);
  }
  items = unique(items).filter((entry) => entry.title && entry.link && entry.publishedAt);
  if (!items.length) throw new Error(`${source.adapter} adapter 没有解析出任何条目`);
  return items;
}
