import { htmlToText } from './html-text.mjs';

// 这些标签整块都是噪声（导航、页眉页脚、表单等），连内容一起剔除，
// 而不是留给 htmlToText 去标签之后再指望它们"恰好"不影响语义。
const NOISE_TAGS = ['script', 'style', 'nav', 'header', 'footer', 'aside', 'form', 'noscript'];
const NOISE_RE = new RegExp(`<(${NOISE_TAGS.join('|')})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi');

function stripNoise(html) {
  return html.replace(NOISE_RE, '');
}

function extractTag(html, tag) {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(html);
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
