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
