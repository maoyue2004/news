#!/usr/bin/env node
/**
 * 「已收录作者的个人站」这条扩源通道的脚本化。
 *
 * 它问的问题和名录、友链、报名表、写作平台都不同：
 * **已经被我们判为好文的那个人，是不是还在别处写。**
 * 原料每天免费送上门——收录条目里本来就带作者名和平台。
 *
 * 08-19（V2EX）和 08-20（掘金）两轮都是手工跑的：手动查 profile 接口、
 * 手动比对已有源、手动往 candidates.txt 里贴。代价是每天重查同一批作者，
 * 而且「这个作者查过了、没有站」这件事只写在 REVIEW 里——
 * 按 LESSONS 那条「写在 REVIEW 里不算数」，它下次一定会被重查一遍。
 * 所以这里带一份账本 tinker/author-sites.json（要提交），
 * 记下每个作者查过没有、查到了什么，只有新作者才会真的发请求。
 *
 * 两个平台的 profile 接口都是公开可调的：
 *   掘金   api.juejin.cn/user_api/v1/user/get?user_id=<id>   → blog_address / github_nickname
 *          user_id 要先用搜索接口按标题反查（author_user_info.user_id）
 *          **注意 aid=2608 是搜索接口的必需参数，用户接口带上它会返回 data: null**
 *   V2EX   www.v2ex.com/api/members/show.json?username=<name> → website / github / bio
 *
 * 用法：
 *   node scripts/tinker-authorsites.mjs            # 只看结果，不写盘
 *   node scripts/tinker-authorsites.mjs --write    # 更新账本，并把新域名追加进 candidates.txt
 *   node scripts/tinker-authorsites.mjs --recheck  # 忽略账本，全部重查
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const DATA_DIR = 'tinker/data';
const LEDGER = 'tinker/author-sites.json';
const CANDIDATES = 'tinker/candidates.txt';
const SOURCES = 'tinker/sources.json';
const DENYLIST = 'tinker/denylist.json';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const write = process.argv.includes('--write');
const recheck = process.argv.includes('--recheck');

/** 平台域名不算「个人站」——那是这条通道要绕开的东西。 */
const PLATFORM = /(^|\.)(juejin\.cn|v2ex\.com|csdn\.net|zhihu\.com|cnblogs\.com|segmentfault\.com|jianshu\.com|weibo\.com|bilibili\.com|xiaohongshu\.com|douban\.com|gitee\.com|github\.com|github\.io\/?$|gitbook\.io|notion\.site|yuque\.com|feishu\.cn|wolai\.com|zsxq\.com|sspai\.com|infoq\.cn|51cto\.com|oschina\.net|toutiao\.com|qq\.com|163\.com|aliyun\.com|tencent\.com|huaweicloud\.com|baidu\.com|npmjs\.com|linkedin\.com|twitter\.com|x\.com|t\.me)$/i;

function host(u) {
  try { return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, ''); }
  catch { return null; }
}

/** 收录条目里的 (平台, 作者, 一篇标题)。作者名为空的条目没法查，跳过。 */
export function publishedAuthors(dir = DATA_DIR) {
  const out = new Map();
  for (const f of readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()) {
    let day;
    try { day = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')); } catch { continue; }
    for (const it of day.items ?? []) {
      const h = host(it.url ?? '');
      const platform = h === 'juejin.cn' ? 'juejin' : h === 'v2ex.com' ? 'v2ex' : null;
      if (!platform || !it.author) continue;
      const key = `${platform}:${it.author}`;
      if (!out.has(key)) out.set(key, { platform, author: it.author, titles: [], firstSeen: day.date });
      out.get(key).titles.push(it.titleOriginal ?? it.titleZh ?? '');
    }
  }
  return [...out.values()];
}

/**
 * 失败要能和「查过了，没有站」区分开——本环境的出口代理会随机吐
 * `HTTP 503 DNS resolution failed (transient resolver error)`（LESSONS「站点失败 vs 出口失败」），
 * 而这条通道的产物是要写进账本、以后不再重查的。把一次出口抖动记成
 * 「这个作者没有个人站」，等于让错误永久留在账本里、再也无法自我纠正。
 * 所以网络类失败重试两轮，仍然失败就抛，由上层跳过写账本。
 *
 * 反过来也要防：**永久性的 404 不是失败，是答案。** 2026-08-22 查出来的——
 * sutree900 / xdlkc 两个 V2EX 作者连着两天记成「请求失败，下轮重查」，
 * 手动 curl 才看见是 `HTTP 404 {"status":"error","message":"Object Not Found"}`
 * （同一轮 timeance 返回 200，响应里的 rate_limit 是 used 1 / quota 600，
 * 所以既不是限流也不是 1.5 秒间隔太密，是这两个用户名查不到人）。
 * 把它当成瞬时失败的后果和把瞬时失败当成结论恰好相反：账本永远收敛不了，
 * 每天白发两个必然 404 的请求，而且「失败 2 个」这行会一直挂在汇报里。
 * 所以 404 / 410 直接判为结论（definitive），不重试、照常落账。
 */
async function getJson(url) {
  let last;
  for (let i = 0; i < 3; i += 1) {
    if (i) await new Promise((r) => setTimeout(r, 2000 * i));
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
      if (res.status === 404 || res.status === 410) {
        const e = new Error(`HTTP ${res.status}`); e.definitive = true; throw e;
      }
      if (!res.ok) { last = new Error(`HTTP ${res.status}`); continue; }
      return await res.json();
    } catch (e) { if (e.definitive) throw e; last = e; }
  }
  throw last;
}

/** 账本里这一条还要不要再查：没查过要查，pending 的没攒够轮次要查，已成结论的不查。 */
export const MAX_LOOKUP_ATTEMPTS = 3;
export function needsQuery(entry, maxAttempts = MAX_LOOKUP_ATTEMPTS) {
  if (!entry) return true;
  if (!entry.pending) return false;
  return (entry.attempts ?? 1) < maxAttempts;
}

/**
 * 一次查询结果该怎么记账。返回 null 表示「这次是失败」——一个字都不写，下轮重查。
 *
 * pending 这一档是 2026-08-22 加的第三态，管的是掘金那条
 * 「搜索接口反查不到 user_id」：文章当天发出来、搜索还没建索引时它必然反查不到，
 * 而旧版把这个直接写成结论，等于永久判定这个作者没有个人站。
 * 但也不能永远重查（那就成了每天白发请求的僵尸条目），
 * 所以攒够 MAX_LOOKUP_ATTEMPTS 轮仍然反查不到才落成结论。
 */
export function ledgerEntry(author, result, prev, maxAttempts = MAX_LOOKUP_ATTEMPTS) {
  if (result.failed) return null;
  const base = {
    platform: author.platform, author: author.author, site: result.site ?? null,
    github: result.github ?? null, note: result.note ?? null, checkedFrom: author.firstSeen,
  };
  if (!result.pending) return base;
  const attempts = (prev?.attempts ?? 0) + 1;
  if (attempts >= maxAttempts) return { ...base, attempts, note: `${result.note}（连续 ${attempts} 轮，按结论落账）` };
  return { ...base, pending: true, attempts };
}

/** 掘金：标题 → user_id（搜索接口带 aid），user_id → profile（用户接口不带 aid）。 */
async function juejinSite(author, titles) {
  let userId = null;
  let errored = 0;
  const tried = titles.slice(0, 3).filter(Boolean);
  for (const title of tried) {
    const url = 'https://api.juejin.cn/search_api/v1/search'
      + `?aid=2608&spider=0&query=${encodeURIComponent(title)}`
      + '&id_type=2&cursor=0&limit=10&search_type=0&sort_type=1&version=1';
    let data;
    try { data = await getJson(url); } catch (e) { errored += 1; continue; }
    for (const row of data?.data ?? []) {
      const info = row.result_model?.author_user_info;
      if (info?.user_name === author && info.user_id) { userId = info.user_id; break; }
    }
    if (userId) break;
  }
  if (!userId) {
    if (errored === tried.length) return { failed: '搜索接口全部请求失败' };
    // 当天刚发的文章可能还没进搜索索引，这不是「这个人没有站」的结论，先挂 pending。
    return { site: null, pending: true, note: '搜索接口反查不到 user_id' };
  }
  // aid=2608 在这里必须去掉，带上会返回 data: null。
  let prof;
  try { prof = await getJson(`https://api.juejin.cn/user_api/v1/user/get?user_id=${userId}`); }
  catch { return { failed: 'profile 接口请求失败' }; }
  const u = prof?.data;
  if (!u) return { site: null, note: 'profile 接口无数据', userId };
  return { site: u.blog_address || null, github: u.github_nickname || null, userId };
}

/** V2EX：用户名直接查 members/show。 */
async function v2exSite(author) {
  let u;
  try { u = await getJson(`https://www.v2ex.com/api/members/show.json?username=${encodeURIComponent(author)}`); }
  catch (e) {
    if (e.definitive) return { site: null, note: 'members/show 404（用户名查不到人）' };
    return { failed: 'members/show 请求失败' };
  }
  if (!u) return { site: null, note: 'members/show 无数据' };
  return { site: u.website || null, github: u.github || null };
}

function knownHosts() {
  const set = new Set();
  const src = JSON.parse(readFileSync(SOURCES, 'utf8'));
  for (const s of Array.isArray(src) ? src : src.sources ?? []) {
    for (const u of [s.url, s.feed]) { const h = host(u ?? ''); if (h) set.add(h); }
  }
  for (const d of JSON.parse(readFileSync(DENYLIST, 'utf8'))) {
    const h = host(d.feed ?? d.url ?? d.domain ?? ''); if (h) set.add(h);
  }
  if (existsSync(CANDIDATES)) {
    for (const line of readFileSync(CANDIDATES, 'utf8').split('\n')) {
      const h = host(line.trim()); if (h) set.add(h);
    }
  }
  return set;
}

if (import.meta.url !== `file://${process.argv[1]}`) {
  // 被 import（测试）时只暴露 publishedAuthors，不发任何请求。
} else {
const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {};
const known = knownHosts();
const authors = publishedAuthors();
const fresh = [];
const failed = [];

for (const a of authors) {
  const key = `${a.platform}:${a.author}`;
  if (!recheck && !needsQuery(ledger[key])) continue;
  const r = a.platform === 'juejin' ? await juejinSite(a.author, a.titles) : await v2exSite(a.author);
  const entry = ledgerEntry(a, r, ledger[key]);
  if (!entry) {
    failed.push(`${a.platform}:${a.author}`);
    console.log(`${a.platform.padEnd(6)} ${a.author.padEnd(22)} ✗ ${r.failed}（不写账本，下轮重查）`);
    await new Promise((r2) => setTimeout(r2, 1500));
    continue;
  }
  const h = r.site ? host(r.site) : null;
  const usable = h && !PLATFORM.test(h) && !known.has(h);
  ledger[key] = entry;
  const state = entry.pending ? `  (${entry.note}，第 ${entry.attempts}/${MAX_LOOKUP_ATTEMPTS} 轮)` : entry.note ? `  (${entry.note})` : '';
  console.log(`${a.platform.padEnd(6)} ${a.author.padEnd(22)} ${r.site || '—'}${state}${usable ? '   ← 新候选' : ''}`);
  if (usable) { fresh.push(r.site); known.add(h); }
  await new Promise((r2) => setTimeout(r2, 1500));
}

console.log(`\n收录作者 ${authors.length} 个，账本共 ${Object.keys(ledger).length} 条，`
  + `请求失败 ${failed.length} 个（未记账）`
  + `，新候选 ${fresh.length} 个：${fresh.join(' ') || '（无）'}`);

if (write) {
  writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
  if (fresh.length) {
    const prev = existsSync(CANDIDATES) ? readFileSync(CANDIDATES, 'utf8').replace(/\n*$/, '\n') : '';
    writeFileSync(CANDIDATES, prev + fresh.join('\n') + '\n');
  }
  console.log(`已写入 ${LEDGER}${fresh.length ? ` 与 ${CANDIDATES}` : ''}`);
}
}
