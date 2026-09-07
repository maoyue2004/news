#!/usr/bin/env node
/**
 * 「同一个平台里更窄的那个入口」这条通道的脚本化——博客园作者子 feed。
 *
 * 它和 `tinker-authorsites.mjs` 问的**不是**同一个问题。那条问的是站外：
 * 「已经被我们判为好文的那个人，是不是还在**别处**写」，所以它的 `PLATFORM`
 * 正则里带着 `cnblogs.com`——把平台主页当个人站是它要挡的东西，这一条没错。
 * 这条问的是站内：**「这个作者在同一个平台上有没有一个更窄的入口」**，
 * 原料同样免费送上门（收录条目的 url 里就带着 `/<user>/`）。
 *
 * 为什么这个通道非有不可（2026-09-02 量的）：`博客园首页` 那份全站 feed 固定 20 条，
 * 而这 20 条只跨 **12.8 小时**——它是创刊以来收录量第二高的源，也就是说这些人
 * 每天有一半的产出**结构上**进不来，而它和「今天他们没发文」长得一模一样。
 * 窄入口是现成的：`www.cnblogs.com/<user>/rss`。
 *
 * 09-02 手工接了三个（rossiXYZ 16/20、grey-wolf 6/20、borui-coding-diary 4/13），
 * 09-07 又手工评了两个（狂师 12/20、老纪 4/20，两个都被人扫掉、当场落 denylist）。
 * 两次都是靠人想起来，而 09-07 的建议 #2 就是「把它脚本化」——这里执行那条。
 *
 * 判据不另立：直接用 harvest 的 `evaluate()`（LESSONS「选源判据要用系统自己的评分器」）。
 * **不提供 `--merge`**，理由和 harvest / ironman 一样：够格的里面仍有一多半要靠人扫标题
 * 剔掉，而 09-07 那次挡下的恰恰是**当轮最高分**（12/20 的清单体内容农场）——
 * LESSONS：「人工扫命中列表时不要从下往上扫」。
 *
 * 用法：
 *   node scripts/tinker-cnblogs.mjs              # 评估全部已收录的博客园作者
 *   node scripts/tinker-cnblogs.mjs --days 30    # 只看最近 N 天日文件里出现过的作者
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { evaluate, deniedHostsFrom } from './tinker-harvest.mjs';
import { fetchText } from '../lib/tinker/probe.mjs';

const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*';

const DATA_DIR = 'tinker/data';
const SOURCES = 'tinker/sources.json';
const DENYLIST = 'tinker/denylist.json';

const flag = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

/**
 * 收录条目的 url → 博客园用户名。
 *
 * 形状是 `https://www.cnblogs.com/<user>/p/<id>.html`，而**不是**每一条
 * `cnblogs.com` 下的路径都有用户名：`/news/`、`/cmt/`、`/aggsite/` 这些是站务路径。
 * 所以要求第二段是 `p`（随笔）或 `archive`（旧版归档），不认光有一段的。
 */
export function cnblogsUser(url) {
  let u;
  try { u = new URL(String(url ?? '')); } catch { return null; }
  if (!/(^|\.)cnblogs\.com$/i.test(u.hostname)) return null;
  const seg = u.pathname.split('/').filter(Boolean);
  if (seg.length < 2) return null;
  if (!['p', 'archive'].includes(seg[1])) return null;
  const user = seg[0];
  if (!/^[A-Za-z0-9_\-.]+$/.test(user)) return null;
  // 平台自己的板块，不是人。
  if (['news', 'cmt', 'aggsite', 'blog', 'home', 'sitehome'].includes(user.toLowerCase())) return null;
  return user;
}

/** 已收录的博客园作者：用户名 → { 收录篇数, 最近一次的日期, 标题 }。 */
export function publishedCnblogsAuthors(dir = DATA_DIR, sinceDays = null) {
  const cutoff = sinceDays ? Date.now() - sinceDays * 86400000 : null;
  const out = new Map();
  for (const f of readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()) {
    if (cutoff && Date.parse(`${f.slice(0, 10)}T00:00:00Z`) < cutoff) continue;
    let day;
    try { day = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')); } catch { continue; }
    for (const it of day.items ?? []) {
      const user = cnblogsUser(it.url);
      if (!user) continue;
      if (!out.has(user)) out.set(user, { user, posts: 0, lastDay: null, titles: [], ratings: [] });
      const e = out.get(user);
      e.posts += 1;
      e.lastDay = day.date ?? f.slice(0, 10);
      e.titles.push(it.titleZh ?? it.titleOriginal ?? '');
      if (typeof it.rating === 'number') e.ratings.push(it.rating);
    }
  }
  return [...out.values()].sort((a, b) => b.posts - a.posts);
}

/**
 * 已经处理过的作者：`sources.json` 里订着的，和 denylist 里否掉的。
 *
 * 博客园是**一个域名挂几十万人**的聚合站，所以这里比的是**整条 feed URL**，
 * 不是域名——按域名比会把 `博客园首页` 自己算进去，一个作者都评不出来。
 * denylist 那一侧同理：`deniedHostsFrom()` 刻意**不**把 `scope: "feed"` 的条目
 * 按域名否掉（wechat2rss / 博客园同形），所以那批要单独按 feed URL 读一遍。
 */
export function handledUsers(sources, denylist) {
  const users = new Set();
  const add = (u) => { const n = cnblogsFeedUser(u); if (n) users.add(n.toLowerCase()); };
  for (const s of Array.isArray(sources) ? sources : sources.sources ?? []) { add(s.feed); add(s.url); }
  for (const d of denylist) { add(d.feed); add(d.url); add(d.domain); }
  // 按域名整个否掉过 cnblogs.com 的（不该有，但真有的话要认）。
  if (deniedHostsFrom(denylist).has('cnblogs.com')) users.add('*');
  return users;
}

/** `https://www.cnblogs.com/<user>/rss` → `<user>`；不是这个形状的返回 null。 */
export function cnblogsFeedUser(url) {
  let u;
  try { u = new URL(String(url ?? '')); } catch { return null; }
  if (!/(^|\.)cnblogs\.com$/i.test(u.hostname)) return null;
  const seg = u.pathname.split('/').filter(Boolean);
  if (!seg.length) return null;
  if (['news', 'cmt', 'aggsite', 'blog', 'home', 'sitehome'].includes(seg[0].toLowerCase())) return null;
  return seg[0];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const days = flag('days', null);
  const authors = publishedCnblogsAuthors(DATA_DIR, days ? Number(days) : null);
  const sources = JSON.parse(readFileSync(SOURCES, 'utf8'));
  const denylist = existsSync(DENYLIST) ? JSON.parse(readFileSync(DENYLIST, 'utf8')) : [];
  const handled = handledUsers(sources, denylist);

  const todo = authors.filter((a) => !handled.has('*') && !handled.has(a.user.toLowerCase()));
  console.log(`日文件里 ${authors.length} 个博客园作者，${authors.length - todo.length} 个已订阅或已否决，评估 ${todo.length} 个\n`);

  const hits = [];
  for (const a of todo) {
    const feed = `https://www.cnblogs.com/${a.user}/rss`;
    let xml;
    // `fetchText` 返回的是 `{ text, ua }` 而不是字符串——第一版直接把它交给
    // `evaluate()`，17 个作者报出 17 条一模一样的「无法识别的 feed 格式」。
    // 「一批候选在同一轮里以完全相同的理由失败，先怀疑管道」（LESSONS「同一时间戳
    // 一起挂掉是管道问题」的又一例），而这条错误的措辞正好指向内容。
    try { ({ text: xml } = await fetchText(feed, { accept: FEED_ACCEPT })); } catch (e) {
      console.log(`${a.user.padEnd(24)} ✗ ${e.message}（没查成，下轮重查）`);
      continue;
    }
    // `evaluate()` 里的 `parseFeed` 对认不出格式的响应是**抛异常**的，
    // 而博客园对没开通 RSS / 已注销的用户返回的是一页 HTML。不接住的话整轮当场死掉，
    // 而且症状（脚本崩了）和「这个作者不够格」毫无关系。
    // 照 LESSONS 那条「解析器读不动和真的没货长得一模一样」，把字节数一起报出来。
    let r;
    try { r = evaluate(xml); }
    catch (e) { r = { ok: false, why: `解析不了（${xml.length} 字节）：${e.message}` }; }
    const line = r.ok
      ? `${r.hitPosts}/20 够格，${r.ageDays} 天前更新，跨 ${r.spanDays} 天`
      : r.why;
    console.log(`${a.user.padEnd(24)} 收录 ${String(a.posts).padStart(2)} 篇  ${r.ok ? '★' : ' '} ${line}`);
    if (r.ok) hits.push({ ...a, feed, ...r });
    await new Promise((res) => setTimeout(res, 800));
  }

  console.log(`\n${hits.length} 个够格。**逐个人工扫一遍再并入**——2026-09-07 那轮两个够格的`);
  console.log('全被扫掉了，而分数最高的（12/20）正是该扫掉的那个清单体内容农场。');
  for (const h of hits) {
    console.log(`\n  ${h.feed}`);
    console.log(`    收录 ${h.posts} 篇（评分 ${h.ratings.join('/') || '—'}），最近一次 ${h.lastDay}`);
    console.log(`    ${h.hitPosts}/20 够格 · ${h.count} 条 · 跨 ${h.spanDays} 天 · 工具 ${h.tools.join(',') || '—'}`);
    console.log(`    已收录标题：${h.titles.slice(0, 3).join(' / ')}`);
  }
}
