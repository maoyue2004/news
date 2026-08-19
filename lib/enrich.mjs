import { htmlToText } from './html-text.mjs';

// 这些标签整块都是噪声（导航、页眉页脚、表单等），连内容一起剔除，
// 而不是留给 htmlToText 去标签之后再指望它们"恰好"不影响语义。
const NOISE_TAGS = ['script', 'style', 'nav', 'header', 'footer', 'aside', 'form', 'noscript'];
const NOISE_RE = new RegExp(`<(${NOISE_TAGS.join('|')})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi');

function stripNoise(html) {
  return html.replace(NOISE_RE, '');
}

function extractTag(html, tag) {
  // 贪婪匹配：从第一个开标签跨到最后一个对应闭标签。
  // 正则没有真正的嵌套标签感知能力，但很多博客主题会把「相关文章/推荐阅读」
  // 组件也包在同名标签里，且往往排在正文前面；非贪婪匹配会在第一个内层闭标签
  // 就收手，把外层真正的正文整段丢弃。贪婪匹配从首个开标签跨到最后一个闭标签，
  // 宁可多带一点嵌套的噪声文本，也不能把正文丢了——丢了正文会让 excerpt 看起来
  // "足够长"从而被误判为非 thin，摘要环节就会拿噪声内容当正文写，比老实标 thin 更糟。
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*)<\\/${tag}>`, 'i').exec(html);
  return m ? m[1] : null;
}

/**
 * 从文章页 HTML 里提取正文纯文本，用来给「瘦 feed」（只有标题没有正文）补内容。
 * 优先级：<article> > <main> > <body> > 整个输入（当页面连 body 标签都没有时的兜底）。
 * 噪声标签（导航/页眉页脚/表单/脚本样式等）在提取之前就整块剔除，
 * 避免它们出现在选中的 <article>/<main> 内部时漏网。
 * 最终的去标签、解实体、合并空白、按码点截断全部复用 htmlToText，不重复实现。
 */
export function extractArticleText(html, maxChars = 2000) {
  if (!html) return '';
  const cleaned = stripNoise(String(html));
  const content = extractTag(cleaned, 'article') ?? extractTag(cleaned, 'main') ?? extractTag(cleaned, 'body') ?? cleaned;
  return htmlToText(content, maxChars);
}

/**
 * 同上，但额外带回**正文真正的结尾**。
 *
 * 起因（2026-08-20）：折腾志有一条「结尾落在推广语上」的判据，量的是 `excerpt.slice(-400)`，
 * 而 excerpt 是 `extractArticleText(html, 2500)` 的产物——**只要文章超过 2500 字符，
 * 那 400 个字符就是正文的腰，不是尾巴**。当天 36 个入围条目里 22 条被截断，
 * 结尾判据对它们全部失效，而自荐帖的招呼语恰恰压在最后一段
 * （「项目地址：GitHub…欢迎 star」「相关阅读」）。
 * 和 LESSONS 里「论坛帖篇幅量的是整页而不是首帖」是同一个形状：
 * 规则本身合理，喂给它的输入却由「怎么抓」决定。
 *
 * 返回 `{ text, tail }`：`text` 和 `extractArticleText` 完全一致（不改任何现有行为），
 * `tail` 是正文最后 `tailChars` 个码点；正文没被截断时 `tail` 为空串——
 * 那种情况下 `excerpt.slice(-400)` 量到的本来就是真结尾，不必多存一份。
 */
export function extractArticleParts(html, maxChars = 2000, tailChars = 400) {
  if (!html) return { text: '', tail: '' };
  const cleaned = stripNoise(String(html));
  const content = extractTag(cleaned, 'article') ?? extractTag(cleaned, 'main') ?? extractTag(cleaned, 'body') ?? cleaned;
  const full = htmlToText(content, Number.MAX_SAFE_INTEGER);
  const chars = Array.from(full);
  const text = chars.slice(0, maxChars).join('');
  const tail = chars.length > maxChars ? chars.slice(-tailChars).join('') : '';
  return { text, tail };
}
