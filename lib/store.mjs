import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const SEEN_KEEP_DAYS = 45;

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    // 静默降级会在这里制造一个隐形陷阱：seen.json 解析失败时如果悄悄当作 {}
    // 继续跑，去重记录全丢，次日重复几百条却没有任何日志痕迹可查。
    console.error(`[store] 解析 ${path} 失败，按空值继续：${err.message}`);
    return fallback;
  }
}

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true });
  // 先写临时文件再 rename 到目标路径：rename 在同一文件系统内是原子操作，
  // 避免进程中途被杀导致目标文件被截断成半份 JSON（下次读取会直接判定为
  // 损坏，触发上面的静默降级 -> 数据全丢）。
  const tmpPath = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmpPath, path);
}

function daysBetween(fromDate, toDate) {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export function loadSeen(dataDir) {
  return readJson(join(dataDir, 'seen.json'), {});
}

export function saveSeen(dataDir, seen, today) {
  const kept = {};
  for (const [id, firstDate] of Object.entries(seen)) {
    if (daysBetween(firstDate, today) <= SEEN_KEEP_DAYS) kept[id] = firstDate;
  }
  writeJson(join(dataDir, 'seen.json'), kept);
}

export function loadStatus(dataDir) {
  return readJson(join(dataDir, 'status.json'), {});
}

export function saveStatus(dataDir, status) {
  writeJson(join(dataDir, 'status.json'), status);
}

function ensureEntry(status, name) {
  if (!status[name]) {
    status[name] = { lastSuccess: null, lastError: null, lastErrorMessage: null, consecutiveFailures: 0 };
  }
  return status[name];
}

export function recordSuccess(status, sourceName, nowIso) {
  const e = ensureEntry(status, sourceName);
  e.lastSuccess = nowIso;
  e.consecutiveFailures = 0;
}

export function recordFailure(status, sourceName, nowIso, message) {
  const e = ensureEntry(status, sourceName);
  e.lastError = nowIso;
  e.lastErrorMessage = message;
  e.consecutiveFailures += 1;
}

/**
 * 查询词的累计产出。
 *
 * 词表的维护手册里写着「发现某个词长期零产出就换掉」，但 2026-08-03 的周更体检
 * 想执行这条时发现**根本没有数据能支撑它**：每天跑哪 30 个词、各自捞到什么，
 * 只存在于当天的 `_pending.json` 里，而那个文件每天被整个覆盖。
 * 轮转池有 200+ 条、每天只跑 30 条，一个词大约一周才轮到一次——
 * 也就是说光靠单日快照，永远判断不出「长期」零产出。
 *
 * 所以单独攒一份小账：每个词跑过几次、一共捞回多少条、其中多少条进了入围名单、
 * 最后一次有入围是哪天。体积很小（一个词一行，池子 200 多条），可以进 git。
 */
export function loadQueryYield(dataDir) {
  return readJson(join(dataDir, 'query-yield.json'), {});
}

export function saveQueryYield(dataDir, yields) {
  writeJson(join(dataDir, 'query-yield.json'), yields);
}

/**
 * @param {Record<string, any>} yields
 * @param {string[]} queries 当天实际跑了的查询词
 * @param {{query?: string, shortlisted: boolean}[]} results 当天所有搜索源条目
 * @param {string} today
 */
export function recordQueryYield(yields, queries, results, today) {
  for (const q of queries) {
    if (!yields[q]) yields[q] = { runs: 0, items: 0, shortlisted: 0, lastRun: null, lastShortlist: null };
    yields[q].runs += 1;
    yields[q].lastRun = today;
  }
  for (const r of results) {
    const e = yields[r.query];
    // 只统计当天真的跑了的词。轮转切片换了之后，旧词的历史留着不动。
    if (!e) continue;
    e.items += 1;
    if (r.shortlisted) {
      e.shortlisted += 1;
      e.lastShortlist = today;
    }
  }
  return yields;
}

export function saveDay(dataDir, date, payload) {
  writeJson(join(dataDir, `${date}.json`), payload);
}

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

export function loadRecentDays(dataDir, today, n) {
  if (!existsSync(dataDir)) return [];
  return readdirSync(dataDir)
    .map((f) => DAY_FILE.exec(f))
    .filter(Boolean)
    .map((m) => m[1])
    .filter((date) => {
      const diff = daysBetween(date, today);
      return diff >= 0 && diff < n;
    })
    .sort()
    .reverse()
    .map((date) => readJson(join(dataDir, `${date}.json`), null))
    .filter(Boolean);
}

export function pruneDayFiles(dataDir, today, keepDays) {
  if (!existsSync(dataDir)) return [];
  const removed = [];
  for (const f of readdirSync(dataDir)) {
    const m = DAY_FILE.exec(f);
    if (!m) continue;
    if (daysBetween(m[1], today) >= keepDays) {
      unlinkSync(join(dataDir, f));
      removed.push(f);
    }
  }
  return removed.sort();
}
