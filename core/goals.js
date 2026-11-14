// Goals, streak, heatmap and badges (spec C3 §9.3-9.5) as pure functions of the stored data and an injected clock.
//   cfg = { dayStart, weekStart, streakMin, countLook, countListen, countTests, countManual }
import * as quran from './quran.js';
import { resolve, toAbs, fromAbs, TOTAL, divisions, fromRuns } from './ranges.js';
import { parseLocal } from './bn.js';

const pad = (n) => String(n).padStart(2, '0');
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// the "day" of a moment: the local date after taking dayStart hours off (night reading counts for the day before)
export const dayKey = (iso, dayStart = 0) => dateKey(new Date(parseLocal(iso).getTime() - dayStart * 3600000));
export const addDays = (key, n) => { const d = new Date(`${key}T12:00:00`); d.setDate(d.getDate() + n); return dateKey(d); };
export const weekday = (key) => new Date(`${key}T12:00:00`).getDay();

// ---- unit helpers
let PAGE_STARTS = null;
const pageStarts = () => PAGE_STARTS ??= divisions().page.map(([s, a]) => toAbs(s, a));
const juzStarts = () => divisions().juz.map(([s, a]) => toAbs(s, a));
function unitOf(abs, starts, total) { let i = 0; while (i + 1 < starts.length && starts[i + 1] <= abs) i++; const end = i + 1 < starts.length ? starts[i + 1] : total; return end - starts[i]; }
export const fraction = (unit, s, a) => { // part of a page / juz that one ayah is
  const abs = toAbs(s, a);
  if (unit === 'page') return 1 / unitOf(abs, pageStarts(), TOTAL());
  if (unit === 'juz') return 1 / unitOf(abs, juzStarts(), TOTAL());
  return 1;
};

// ---- records: everything that can count, in time order
// data: { sessions, manual, listens, tests }
export function buildRecords(data, cfg) {
  const out = [];
  for (const x of data.sessions ?? []) {
    const test = x.kind === 'test';
    if (test && !cfg.countTests) continue;
    if (x.mode === 'look' && !cfg.countLook && !test) { out.push({ ...base(x), kind: 'recite', mode: 'look', countsHifz: false, surah: x.surah, ayahs: x.ayahs, words: x.words, seconds: x.seconds }); continue; }
    out.push({ ...base(x), kind: test ? 'test' : 'recite', mode: x.mode, countsHifz: x.mode !== 'look' || cfg.countLook, surah: x.surah, ayahs: x.ayahs, words: x.words, seconds: x.seconds });
  }
  if (cfg.countManual) for (const m of data.manual ?? []) out.push({ start: `${m.date}T12:00:00`, kind: 'manual', intent: m.intent, spec: m.spec, seconds: m.minutes * 60, countsHifz: true, id: m.id });
  if (cfg.countListen) for (const l of data.listens ?? []) out.push({ start: l.start, kind: 'listen', spec: l.parts, seconds: l.seconds, countsHifz: false });
  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}
const base = (x) => ({ start: x.start });

// ayahs of a record as [[s, a]] (manual / listen: from their spec)
function recAyahs(r, memorized) {
  if (r.ayahs) return r.ayahs.map((a) => [r.surah, a]);
  if (r.spec) return resolve(r.spec, memorized).flatMap(([s, a, b]) => Array.from({ length: b - a + 1 }, (_, i) => [s, a + i]));
  return [];
}

function qualifies(r, g) {
  if (r.kind === 'listen') return g.type === 'recite';
  if (g.type === 'test') return r.kind === 'test';
  if (g.type === 'recite') return true;
  if (r.kind === 'manual') return r.intent === g.type;
  return r.countsHifz && r.mode !== 'look' ? true : r.countsHifz;
}

export function goalOrder(g, memorized) {
  let list = resolve(g.spec, memorized).flatMap(([s, a, b]) => Array.from({ length: b - a + 1 }, (_, i) => [s, a + i]));
  if (g.reverse) list = list.sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  return list;
}

// Per day: amount done for the goal, plus the whole-range total and completions. goal: see spec 9.3.
export function goalProgress(g, recs, cfg, memorized) {
  const order = goalOrder(g, memorized);
  const inRange = new Set(order.map(([s, a]) => `${s}:${a}`));
  const total = g.unit === 'page' || g.unit === 'juz' ? order.reduce((n, [s, a]) => n + fraction(g.unit, s, a), 0) : g.unit === 'ayah' ? order.length : null;
  const byDay = {};
  let counted = new Set();
  let ptr = 0;
  let completions = 0;
  let cycleStart = g.cycleStart ?? '0000-00-00';
  for (const r of recs) {
    const day = dayKey(r.start, cfg.dayStart);
    if (day < cycleStart || !qualifies(r, g)) continue;
    let amt = 0;
    if (g.unit === 'minute') amt = r.seconds / 60;
    else if (g.unit === 'question') amt = r.questions ?? 0;
    else if (g.unit === 'word') amt = r.words ?? 0;
    else {
      let ay = recAyahs(r, memorized).filter(([s, a]) => inRange.has(`${s}:${a}`));
      if (g.strict) { const mine = new Set(ay.map(([s, a]) => `${s}:${a}`)); ay = []; while (ptr < order.length && mine.has(`${order[ptr][0]}:${order[ptr][1]}`)) { ay.push(order[ptr]); ptr++; } }
      if (g.type === 'memorize') ay = ay.filter(([s, a]) => !counted.has(`${s}:${a}`));
      for (const [s, a] of ay) { counted.add(`${s}:${a}`); amt += fraction(g.unit, s, a); }
    }
    if (amt) byDay[day] = (byDay[day] ?? 0) + amt;
    if (total && ['memorize', 'recite'].includes(g.type) && counted.size >= order.length && order.length) {
      completions++;
      if (g.cycle === 'auto') { counted = new Set(); ptr = 0; } else if (g.cycle === 'off') break;
    }
  }
  const done = Object.values(byDay).reduce((a, b) => a + b, 0);
  return { byDay, order, total, done, completions, complete: !!total && done >= total && g.cycle === 'off' };
}

const roundBy = (x, mode) => (mode === 'up' ? Math.ceil(x) : mode === 'down' ? Math.floor(x) : mode === 'nearest' ? Math.round(x) : x);

// days of the week (weekday numbers) on which the goal is scheduled
export function scheduledDays(g, cfg) {
  if (g.days?.length) return g.days;
  if (g.perWeek) return Array.from({ length: g.perWeek }, (_, i) => (cfg.weekStart + i) % 7); // the first n days of the week
  return [0, 1, 2, 3, 4, 5, 6];
}
const startOfWeek = (key, weekStart) => addDays(key, -((weekday(key) - weekStart + 7) % 7));

// the target of a day (spec 9.3 table)
export function targetOf(g, day, prog, cfg) {
  const sch = scheduledDays(g, cfg);
  if (!sch.includes(weekday(day))) return 0;
  if (g.plan === 'manzil') {
    const i = (weekday(day) - cfg.weekStart + 7) % 7;
    const [s, a] = divisions().manzil[Math.min(i, 6)];
    const start = toAbs(s, a);
    const end = i < 6 ? toAbs(...divisions().manzil[i + 1]) - 1 : TOTAL() - 1;
    return end - start + 1;
  }
  if (g.plan === 'bydate') {
    const before = Object.entries(prog.byDay).filter(([d]) => d < day).reduce((n, [, v]) => n + v, 0);
    let left = 0;
    for (let d = day; d <= g.deadline; d = addDays(d, 1)) if (sch.includes(weekday(d))) left++;
    const rest = Math.max(0, (prog.total ?? g.amount) - before);
    return Math.max(left ? roundBy(rest / left, g.rounding) : rest, rest > 0 ? 1 : 0);
  }
  if (g.plan === 'flexible') {
    const ws = startOfWeek(day, cfg.weekStart);
    let carry = 0;
    for (let d = ws; d < day; d = addDays(d, 1)) if (sch.includes(weekday(d))) carry += Math.max(0, g.amount - (prog.byDay[d] ?? 0));
    return Math.min(g.amount + carry, 2 * g.amount);
  }
  return g.amount;
}
export function dayStatus(g, day, prog, cfg, today) {
  const target = targetOf(g, day, prog, cfg);
  const done = prog.byDay[day] ?? 0;
  if (!target) return 'off';
  if (done >= target) return 'done';
  if (done > 0) return 'partial';
  return day < today ? 'missed' : 'open';
}

// ---- streak, heatmap
export function minutesByDay(recs, cfg) {
  const m = {};
  for (const r of recs) { const d = dayKey(r.start, cfg.dayStart); m[d] = (m[d] ?? 0) + (r.seconds ?? 0) / 60; }
  return m;
}
export function streakInfo(recs, cfg, today, goalsDone = () => false) {
  const mins = minutesByDay(recs, cfg);
  const need = { any: 0, m5: 5, m10: 10, m20: 20 }[cfg.streakMin];
  const counted = (d) => (cfg.streakMin === 'goals' ? goalsDone(d) : (mins[d] ?? 0) > 0 && (mins[d] ?? 0) >= (need ?? 0));
  const days = Object.keys(mins).sort();
  let best = 0; let run = 0; let prev = null;
  for (const d of days) { if (!counted(d)) { run = 0; prev = null; continue; } run = prev && addDays(prev, 1) === d ? run + 1 : 1; prev = d; best = Math.max(best, run); }
  let cur = 0; let d = counted(today) ? today : addDays(today, -1);
  const todayCounted = counted(today);
  while (counted(d)) { cur++; d = addDays(d, -1); }
  return { current: cur, best, todayCounted, keep: cur > 0 && !todayCounted };
}
export function heatmap(recs, cfg, today) { // 12 weeks, columns = weeks starting at weekStart; level 0..4
  const mins = minutesByDay(recs, cfg);
  const ws = addDays(startOfWeek(today, cfg.weekStart), -77);
  const level = (m) => (m >= 40 ? 4 : m >= 20 ? 3 : m >= 10 ? 2 : m > 0 ? 1 : 0);
  const weeks = [];
  for (let w = 0; w < 12; w++) weeks.push(Array.from({ length: 7 }, (_, i) => { const d = addDays(ws, w * 7 + i); return { day: d, minutes: Math.round(mins[d] ?? 0), level: level(mins[d] ?? 0), future: d > today }; }));
  return weeks;
}

// ---- badges (spec 9.4): returns the ids earned now
export const BADGES = [['first', 'প্রথম পদক্ষেপ', 'প্রথম সেশন জমা করো'], ['streak7', 'এক সপ্তাহ টানা', '৭ দিন টানা পড়ো'], ['streak30', 'এক মাস টানা', '৩০ দিন টানা পড়ো'], ['sessions100', 'শততম সেশন', 'মোট ১০০টা সেশন'],
  ['hours10', 'দশ ঘণ্টা', 'মোট ১০ ঘণ্টা তিলাওয়াত'], ['good1', 'প্রথম মজবুত সূরা', 'একটা সূরা ‘ভালো মুখস্থ’ অবস্থায় আনো'], ['good5', 'পাঁচ মজবুত সূরা', '৫টা সূরা ‘ভালো মুখস্থ’'], ['test100', 'নিখুঁত টেস্ট', 'অন্তত ১০ প্রশ্নের কোনো টেস্টে ১০০%'],
  ['tests10', 'নিয়মিত পরীক্ষা', '১০টা টেস্ট শেষ করো'], ['juz1', 'এক পারা মুখস্থ', 'মুখস্থ তালিকায় পুরো এক পারা'], ['cleared50', 'দাগ মোছার ওস্তাদ', 'না দেখে ঠিক পড়ে ৫০টা দুর্বল দাগ মুছে ফেলো'], ['goal1', 'লক্ষ্য পূরণ', 'প্রথমবার কোনো দিনের লক্ষ্য পূরণ করো']];
export function earnedBadges({ sessions, tests, weak, memorized, streak, goalDayDone, goodSurahs }) {
  const ids = new Set();
  const own = sessions.filter((s) => s.kind !== 'test');
  if (sessions.length) ids.add('first');
  if (streak.best >= 7) ids.add('streak7');
  if (streak.best >= 30) ids.add('streak30');
  if (sessions.length >= 100) ids.add('sessions100');
  if (sessions.reduce((n, s) => n + s.seconds, 0) >= 36000) ids.add('hours10');
  if (goodSurahs >= 1) ids.add('good1');
  if (goodSurahs >= 5) ids.add('good5');
  if (tests.some((t) => t.state !== 'paused' && t.cards.length >= 10 && t.score === 100)) ids.add('test100');
  if (tests.filter((t) => t.state === 'done').length >= 10) ids.add('tests10');
  const sumPerJuz = divisions().juz.map(([s, a], i, l) => { const st = toAbs(s, a); const en = i + 1 < l.length ? toAbs(...l[i + 1]) - 1 : TOTAL() - 1; return [st, en]; });
  const have = new Set(); for (const r of memorized?.ranges ?? []) for (let a = r.from; a <= r.to; a++) have.add(toAbs(r.s, a));
  if (sumPerJuz.some(([a, b]) => { for (let i = a; i <= b; i++) if (!have.has(i)) return false; return true; })) ids.add('juz1');
  if (Object.values(weak ?? {}).filter((r) => r.total > 0 && r.err === 0).length >= 50) ids.add('cleared50');
  if (goalDayDone) ids.add('goal1');
  void own; void quran; void fromAbs; void fromRuns;
  return ids;
}
