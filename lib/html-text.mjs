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

// 单次扫描：命名实体与数字实体在同一个正则里匹配，避免先解码命名实体产出的
// `&#NN;` 文本被第二轮的数字实体规则再吃一次（例如 '&amp;#39;' 应该只解一层
// 变成 '&#39;'，而不是被连续两轮解码变成 "'"）。
const ENTITY_RE = /&(?:amp|lt|gt|quot|apos|nbsp|mdash|ndash|hellip|rsquo|lsquo|ldquo|rdquo|#(\d+)|#x([0-9a-fA-F]+));/g;

export function decodeEntities(s) {
  return s.replace(ENTITY_RE, (m, dec, hex) => {
    if (dec !== undefined) return String.fromCodePoint(Number(dec));
    if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
    return ENTITIES[m] ?? m;
  });
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
  // 用 Array.from 按码点截断，而不是按 UTF-16 单元，避免在 emoji 中间切开
  return Array.from(cleaned).slice(0, maxChars).join('');
}
