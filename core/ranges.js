// Range specs (spec C3 §9.1): { parts: [ {k:'surah', s} | {k:'ayahs', s, from, to} | {k:'juz', n} | {k:'hizb', n} | {k:'rub', n} | {k:'page', n}
// | {k:'pages', from, to} | {k:'memorized'} ] } -> merged runs [[surah, firstAyah, lastAyah]] in Quran order.
// Also the saved ranges list (kv `ranges`, max 50) and the memorisation tracker (kv `memorized`, §9.2).
import * as quran from './quran.js';

let DIV = null;
export const setDivisions = (d) => { DIV = d; };
export const divisions = () => DIV;

const counts = () => Array.from({ length: 114 }, (_, i) => quran.surahInfo(i + 1).ayahs);
let OFF = null;
const offsets = () => { if (!OFF) { OFF = [0]; counts().forEach((c, i) => OFF.push(OFF[i] + c)); } return OFF; }; // OFF[s-1] = ayahs before surah s
export const TOTAL = () => offsets()[114];
export const toAbs = (s, a) => offsets()[s - 1] + a - 1; // 0-based index of an ayah in the Quran
export function fromAbs(i) {
  const o = offsets();
  let s = 1;
  while (s < 114 && o[s] <= i) s++;
  return [s, i - o[s - 1] + 1];
}

// [firstAbs, lastAbs] of a division unit
function unit(kind, n) {
  const list = kind === 'rub' ? DIV.rub : kind === 'page' ? DIV.page : DIV.juz;
  if (n < 1 || n > list.length) return null;
  const [s, a] = list[n - 1];
  const first = toAbs(s, a);
  const last = n < list.length ? toAbs(...list[n]) - 1 : TOTAL() - 1;
  return [first, last];
}

function partInterval(p) {
  if (p.k === 'surah') return [toAbs(p.s, 1), toAbs(p.s, quran.surahInfo(p.s).ayahs)];
  if (p.k === 'ayahs') return p.from <= p.to ? [toAbs(p.s, p.from), toAbs(p.s, Math.min(p.to, quran.surahInfo(p.s).ayahs))] : null;
  if (p.k === 'juz' || p.k === 'rub' || p.k === 'page') return unit(p.k, p.n);
  if (p.k === 'hizb') { const a = unit('rub', 4 * p.n - 3); const b = unit('rub', 4 * p.n); return a && b ? [a[0], b[1]] : null; }
  if (p.k === 'pages') { const a = unit('page', p.from); const b = unit('page', p.to); return a && b ? [a[0], b[1]] : null; }
  return null;
}

export function mergeIntervals(list) {
  const sorted = list.filter(Boolean).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of sorted) { const l = out.at(-1); if (l && a <= l[1] + 1) l[1] = Math.max(l[1], b); else out.push([a, b]); }
  return out;
}
// abs intervals -> runs per surah
export function toRuns(intervals) {
  const runs = [];
  for (const [a, b] of intervals) {
    let i = a;
    while (i <= b) {
      const [s, ay] = fromAbs(i);
      const last = Math.min(b, toAbs(s, quran.surahInfo(s).ayahs));
      runs.push([s, ay, fromAbs(last)[1]]);
      i = last + 1;
    }
  }
  return runs;
}
export const fromRuns = (runs) => runs.map(([s, a, b]) => [toAbs(s, a), toAbs(s, b)]);

export function resolve(spec, memorized = null) {
  const iv = [];
  for (const p of spec?.parts ?? []) {
    if (p.k === 'memorized') for (const r of memorized?.ranges ?? []) iv.push([toAbs(r.s, r.from), toAbs(r.s, r.to)]);
    else iv.push(partInterval(p));
  }
  return toRuns(mergeIntervals(iv));
}
export const countAyahs = (runs) => runs.reduce((n, [, a, b]) => n + (b - a + 1), 0);

// ---- saved ranges (array order = display order, max 50)
export const MAX_RANGES = 50;
export function addRange(list, { name, icon, spec }, now = new Date()) {
  if (list.length >= MAX_RANGES) return null;
  const id = `r${now.getTime().toString(36)}${list.length}`;
  return [...list, { id, name, icon, spec, created: now.toISOString().slice(0, 10) }];
}
export const removeRange = (list, id) => list.filter((r) => r.id !== id);
export function moveRange(list, id, d) {
  const i = list.findIndex((r) => r.id === id);
  const j = i + d;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
export const renameRange = (list, id, name) => list.map((r) => (r.id === id ? { ...r, name } : r));

// ---- memorisation tracker: { ranges: [{s, from, to, added}] }, no overlaps; merging keeps the latest `added`
export function normalizeMemorized(ranges) {
  const iv = ranges.map((r) => ({ a: toAbs(r.s, r.from), b: toAbs(r.s, r.to), added: r.added ?? '' })).sort((x, y) => x.a - y.a);
  const out = [];
  for (const r of iv) {
    const l = out.at(-1);
    if (l && r.a <= l.b + 1) { l.b = Math.max(l.b, r.b); if (r.added > l.added) l.added = r.added; } else out.push({ ...r });
  }
  const res = [];
  for (const r of out) for (const [s, a, b] of toRuns([[r.a, r.b]])) res.push({ s, from: a, to: b, added: r.added });
  return res;
}
export function addMemorized(ranges, runs, date) { return normalizeMemorized([...ranges, ...runs.map(([s, from, to]) => ({ s, from, to, added: date }))]); }
export function removeSurahMemorized(ranges, s) { return ranges.filter((r) => r.s !== s); }
export function memorizedSummary(ranges) {
  const per = new Map();
  for (const r of ranges) per.set(r.s, (per.get(r.s) ?? 0) + r.to - r.from + 1);
  return { ayahs: [...per.values()].reduce((a, b) => a + b, 0), surahs: per.size, per };
}
// Suggestions (§9.2): ayahs recited from memory in at least `min` sessions with accuracy >= good, not yet in the list -> runs
export function suggestMemorized(sessions, ranges, good = 95, min = 2) {
  const have = new Set();
  for (const r of ranges) for (let a = r.from; a <= r.to; a++) have.add(`${r.s}:${a}`);
  const n = new Map();
  for (const x of sessions) {
    if (x.kind === 'manual' || x.mode === 'look' || x.accuracy < good) continue;
    for (const a of x.ayahs) n.set(`${x.surah}:${a}`, (n.get(`${x.surah}:${a}`) ?? 0) + 1);
  }
  const iv = [];
  for (const [k, c] of n) if (c >= min && !have.has(k)) { const [s, a] = k.split(':').map(Number); iv.push([toAbs(s, a), toAbs(s, a)]); }
  return toRuns(mergeIntervals(iv));
}

// Press-and-drag over picker chips: `chips` are the chip parts in screen order, `base` the parts when the press began.
// mode 'select' adds every chip from i0 to i1 (either direction); 'clear' removes them. Pure, so it can be tested.
export function dragSelect(base, chips, i0, i1, mode) {
  const run = chips.slice(Math.min(i0, i1), Math.max(i0, i1) + 1);
  const has = (list, p) => list.some((x) => JSON.stringify(x) === JSON.stringify(p));
  return mode === 'clear' ? base.filter((x) => !has(run, x)) : [...base, ...run.filter((p) => !has(base, p))];
}
