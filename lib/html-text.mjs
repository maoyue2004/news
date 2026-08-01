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
 * 去标签。**不能用 `/<[^>]+>/g`**：属性值里合法地出现 `>` 时，那个正则会在属性
 * 中途就收尾，把标签剩下的一半当正文吐出来。真实例子是 Discourse 的响应式样式表
 * `<link media="(width >= 40rem)" rel="stylesheet" data-target="chat_desktop" />`，
 * 旧写法留下一串 `= 40rem)" rel="stylesheet" ...`，页面正文被这种碎片淹没。
 * 所以按标签内的引号状态扫描，只认引号外的 `>` 作为结束。
 *
 * 顺带修掉另一半：`<` 后面不是标签名/闭合斜杠/声明时（`1 < 2 且 3 > 2`），
 * 它就是个普通的小于号，旧写法会把它一路吃到下一个 `>`，连正文一起吞掉。
 */
function stripTags(html) {
  let out = '';
  let i = 0;
  for (;;) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { out += html.slice(i); return out; }
    out += html.slice(i, lt);
    if (!/[a-zA-Z!/?]/.test(html[lt + 1] ?? '')) { out += '<'; i = lt + 1; continue; }
    let j = lt + 1;
    let quote = null;
    while (j < html.length) {
      const c = html[j];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      j += 1;
    }
    // 一直到末尾都没有闭合的 `>`，说明这个 `<` 根本不是标签（正文里的
    // `x <y` 之类）。当成普通字符放回去，绝不能把后面的正文整段吞掉。
    if (j >= html.length) { out += '<'; i = lt + 1; continue; }
    out += ' ';
    i = j + 1;
  }
}

/** 有闭合标签才算真的带标记，`3 > 2` `x<y` 这种正文里的比较符不会命中。 */
const HAS_MARKUP = /<\/[a-zA-Z][a-zA-Z0-9]*\s*>/;

/**
 * 把 feed 里的 HTML 正文压成纯文本，供 Claude 写摘要用。
 * 不追求排版保真，只要求语义完整、无标签噪声。
 */
export function htmlToText(html, maxChars = 2000) {
  if (!html) return '';
  const text = stripTags(String(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, ''));
  // 有的 feed 把整段 HTML 实体转义后再塞进 description（BestBlogs.dev 就是），
  // 解实体之后标签才第一次现形。这时候要再去一次标签，否则整篇摘要开头全是
  // `<div style="font-family: -apple-system...">` 这种样式声明。
  // 只在解码结果里真的出现闭合标签时才走第二遍，且第二遍不再解实体，
  // 免得 `&amp;#39;` 被连解两层。
  const decoded = decodeEntities(text);
  const cleaned = (HAS_MARKUP.test(decoded) ? stripTags(decoded) : decoded)
    .replace(/\s+/g, ' ').trim();
  // 用 Array.from 按码点截断，而不是按 UTF-16 单元，避免在 emoji 中间切开
  return Array.from(cleaned).slice(0, maxChars).join('');
}
