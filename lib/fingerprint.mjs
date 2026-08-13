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
    // 删除追踪参数。utm_* / ref 从一开始就在；sc / spm 是 2026-08-14 补的：
    // iT 邦幫忙给每条 feed 打自己的来源标记（全站 feed 是 ?sc=rss.qu，
    // 铁人赛系列 feed 是 ?sc=rss.iron），于是同一篇文章从两个 feed 进来算出两个 id，
    // seen.json 认不出是同一条。实测后果不是理论风险：8-13 已经发布的
    // 「全 Markdown 架構」（?sc=rss.qu）8-14 又以 ?sc=rss.iron 进了入围名单，
    // 差一点重复收录。凡是「同一篇文章可能从多个 feed 进来」的平台都会踩这一脚。
    for (const key of [...u.searchParams.keys()]) {
      const k = key.toLowerCase();
      if (k.startsWith('utm_') || k === 'ref' || k === 'sc' || k === 'spm') {
        u.searchParams.delete(key);
      }
    }
    // 对剩余查询参数按 key 排序。用纯码点比较而不是 localeCompare：
    // localeCompare 的结果依赖运行时的 locale/ICU 构建，云端换一次 Node 构建
    // 就可能让多参数 URL 排序结果漂移，同一篇文章算出不同 id，已读/标星丢失。
    const params = [...u.searchParams.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
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
