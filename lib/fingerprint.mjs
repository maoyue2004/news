import { createHash } from 'node:crypto';

/**
 * 把 URL 归一化后哈希成稳定 id。
 * 归一化是为了让同一篇文章在 feed 里换了追踪参数或末尾斜杠后仍被认成同一条，
 * 否则去重会失效、已读状态也会丢。
 */
function normalize(url) {
  try {
    const u = new URL(String(url));
    // 统一 scheme 为 https
    u.protocol = 'https:';
    // 去掉 www 前缀
    if (u.hostname.startsWith('www.')) {
      u.hostname = u.hostname.slice(4);
    }
    u.hostname = u.hostname.toLowerCase();
    u.hash = '';
    // 删除 utm_* 和 ref 参数
    for (const key of [...u.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || key.toLowerCase() === 'ref') {
        u.searchParams.delete(key);
      }
    }
    // 对剩余查询参数按 key 排序
    const params = [...u.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    u.search = new URLSearchParams(params).toString();
    // 删除路径末尾的斜杠（保留根路径 /）
    if (u.pathname.endsWith('/') && u.pathname !== '/') {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return String(url);
  }
}

export function itemId(url) {
  return createHash('sha256').update(normalize(url)).digest('hex').slice(0, 16);
}
