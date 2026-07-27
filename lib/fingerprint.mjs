import { createHash } from 'node:crypto';

/**
 * 把 URL 归一化后哈希成稳定 id。
 * 归一化是为了让同一篇文章在 feed 里换了追踪参数或末尾斜杠后仍被认成同一条，
 * 否则去重会失效、已读状态也会丢。
 */
function normalize(url) {
  try {
    const u = new URL(String(url));
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    for (const key of [...u.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || key.toLowerCase() === 'ref') {
        u.searchParams.delete(key);
      }
    }
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return String(url);
  }
}

export function itemId(url) {
  return createHash('sha256').update(normalize(url)).digest('hex').slice(0, 16);
}
