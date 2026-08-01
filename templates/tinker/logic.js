/* 纯逻辑：过滤、统计、状态存取。不碰 DOM，好写测试。
 * 构建时会和 ui.js 一起内联进页面；test/tinker-logic.test.mjs 直接读这个文件求值来测。 */

const STORE_KEY = 'tinker.state.v1';

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return { read: raw.read || {}, starred: raw.starred || {} };
  } catch {
    return { read: {}, starred: {} };
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // 隐私模式下 localStorage 会抛。读写失败只损失「已读」记录，页面本身照常可用。
  }
}

/** 把日文件摊平成一维条目流，附上所属日期。 */
function flatten(days) {
  const out = [];
  for (const day of days) {
    for (const item of day.items || []) out.push({ ...item, date: day.date });
  }
  return out;
}

/** 统计每个工具标签下有多少条目，用来在侧栏显示数量并隐藏空标签。 */
function toolCounts(items) {
  const counts = new Map();
  for (const item of items) {
    for (const tool of item.tools || []) counts.set(tool, (counts.get(tool) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

function matchesQuery(item, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return [item.titleZh, item.titleOriginal, item.summaryZh, item.whyRead, item.source, item.author]
    .some((v) => v && String(v).toLowerCase().includes(q));
}

/**
 * @param {object} opts view: all|unread|starred, tool: 工具 id 或 null, date: 日期或 null
 */
function filterItems(items, opts, state) {
  const { view = 'all', tool = null, query = '', date = null } = opts || {};
  return items.filter((item) => {
    if (date && item.date !== date) return false;
    if (tool && !(item.tools || []).includes(tool)) return false;
    if (view === 'unread' && state.read[item.id]) return false;
    if (view === 'starred' && !state.starred[item.id]) return false;
    return !query || matchesQuery(item, query);
  });
}

/** 源的健康度。连续失败 3 次以内算抖动，7 次以上要人工处理。 */
function sourceState(status) {
  const n = (status && status.consecutiveFailures) || 0;
  if (n === 0) return { s: 'ok', label: '正常' };
  if (n < 7) return { s: 'warn', label: `失败 ${n} 次` };
  return { s: 'bad', label: `连续失败 ${n} 次` };
}

function lastNDates(latest, n) {
  const out = [];
  const base = Date.parse(latest + 'T00:00:00Z');
  for (let i = n - 1; i >= 0; i -= 1) out.push(new Date(base - i * 86400000).toISOString().slice(0, 10));
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { flatten, toolCounts, filterItems, matchesQuery, sourceState, lastNDates };
}
