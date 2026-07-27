const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
};

function decodeEntities(s) {
  return s
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|mdash|ndash|hellip|rsquo|lsquo|ldquo|rdquo|#39);/g,
      (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

/**
 * 把 feed 里的 HTML 正文压成纯文本，供 Claude 写摘要用。
 * 不追求排版保真，只要求语义完整、无标签噪声。
 */
export function htmlToText(html, maxChars = 2000) {
  if (!html) return '';
  const text = String(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ');
  const cleaned = decodeEntities(text).replace(/\s+/g, ' ').trim();
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars) : cleaned;
}
