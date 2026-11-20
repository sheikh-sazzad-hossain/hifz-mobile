// C20 Home page: what the home cards show, as pure functions of the stored data (no DOM, runs in Node).
//   memorizedProgress(ranges)            -> { ayahs, total, pct, juzDone, juzTotal }   (Progress > মুখস্থ list)
//   dayActivity(recs, dayOf, today)       -> { when: 'today' | 'yesterday', minutes, ayahs }
//   nextAyah(s, a)                        -> [s, a] of the ayah after s:a (114:6 -> 1:1)
//   ayahOfDay({ lastRecite, sessions })   -> [s, a]   the next ayah of the last recited place; 67:1 with no history
//   resumePlace({ lastRecite, sessions }) -> { s, a1, a2 } | null   today's sabaq: the stretch after the last one, same length
//   pickSabqi / pickManzil                -> { s, a1, a2 } | null   recent / older memorised stretch to review
//   homeState({ ... })                    -> 'empty' | 'success' | 'normal'
//   hijriText(date, code) / gregText(date, code)   dates in the UI language (digits are written by the caller)
import * as quran from './quran.js';
import { toAbs, TOTAL, divisions, mergeIntervals } from './ranges.js';

const count = (s) => quran.surahInfo(s).ayahs;

export function memorizedProgress(ranges = []) {
  const iv = mergeIntervals(ranges.map((r) => [toAbs(r.s, r.from), toAbs(r.s, r.to)]));
  const ayahs = iv.reduce((n, [a, b]) => n + b - a + 1, 0);
  const total = TOTAL();
  const starts = (divisions()?.juz ?? []).map(([s, a]) => toAbs(s, a));
  let juzDone = 0;
  starts.forEach((st, i) => {
    const end = (i + 1 < starts.length ? starts[i + 1] : total) - 1;
    if (iv.some(([a, b]) => a <= st && b >= end)) juzDone++;
  });
  let pct = Math.round((100 * ayahs) / total); // a little memorised never shows 0 %, almost all never shows 100 %
  if (ayahs && pct === 0) pct = 1;
  if (ayahs < total && pct === 100) pct = 99;
  return { ayahs, total, pct, juzDone, juzTotal: starts.length || 30 };
}

// minutes and distinct ayahs of one day (records of Progress: sessions, tests, manual entries, listening when counted)
export function dayActivity(recs = [], dayOf, today, yesterday) {
  const of = (day) => {
    let sec = 0;
    const seen = new Set();
    for (const r of recs) {
      if (dayOf(r.start) !== day) continue;
      sec += r.seconds ?? 0;
      if (r.kind !== 'listen') for (const a of r.ayahs ?? []) seen.add(`${r.surah}:${a}`);
    }
    return { minutes: Math.round(sec / 60), ayahs: seen.size };
  };
  const t = of(today);
  if (t.minutes || t.ayahs) return { when: 'today', ...t };
  const y = of(yesterday);
  if (y.minutes || y.ayahs) return { when: 'yesterday', ...y };
  return { when: 'today', minutes: 0, ayahs: 0 };
}

export function nextAyah(s, a) {
  if (a < count(s)) return [s, a + 1];
  return s < 114 ? [s + 1, 1] : [1, 1];
}

const recitedSessions = (sessions) => (sessions ?? []).filter((x) => x.kind !== 'test' && x.kind !== 'manual' && x.surah && x.ayahs?.length);
function lastPlace({ lastRecite, sessions }) {
  if (lastRecite?.s) return { s: lastRecite.s, a1: lastRecite.a1, a2: lastRecite.a2, last: lastRecite.lastAyah ?? lastRecite.a2 };
  const l = recitedSessions(sessions).at(-1);
  if (!l) return null;
  return { s: l.surah, a1: Math.min(...l.ayahs), a2: Math.max(...l.ayahs), last: Math.max(...l.ayahs) };
}

export function ayahOfDay(o = {}) {
  const p = lastPlace(o);
  return p ? nextAyah(p.s, p.last) : [67, 1];
}

export function resumePlace(o = {}) {
  const p = lastPlace(o);
  if (!p) return null;
  const len = Math.max(1, Math.min(20, p.a2 - p.a1 + 1));
  const [s, a1] = nextAyah(p.s, p.last);
  return { s, a1, a2: Math.min(count(s), a1 + len - 1) };
}

// last day (ISO date-time string) a stretch was recited; '' when never
function lastRecited(r, sessions) {
  let at = '';
  for (const x of recitedSessions(sessions)) if (x.surah === r.s && x.ayahs.some((a) => a >= r.from && a <= r.to) && x.start > at) at = x.start;
  return at;
}

// সাবকি: the most recently memorised stretch (newest `added`; ties: the later one in the list); without a memorised list,
// the stretch of the last recitation.
export function pickSabqi({ ranges = [], sessions = [], lastRecite = null } = {}) {
  if (ranges.length) {
    let best = null;
    ranges.forEach((r, i) => { if (!best || (r.added ?? '') >= (best.r.added ?? '')) best = { r, i }; });
    return { s: best.r.s, a1: best.r.from, a2: best.r.to };
  }
  const p = lastPlace({ lastRecite, sessions });
  return p ? { s: p.s, a1: p.a1, a2: p.a2 } : null;
}

// মানজিল: of the other (older) memorised stretches, the one recited longest ago (never recited comes first; ties: the oldest added)
export function pickManzil({ ranges = [], sessions = [] } = {}) {
  const sab = pickSabqi({ ranges, sessions });
  const rest = ranges.filter((r) => !(sab && r.s === sab.s && r.from === sab.a1 && r.to === sab.a2));
  if (!rest.length) return null;
  const keyed = rest.map((r) => ({ r, at: lastRecited(r, sessions), added: r.added ?? '' }));
  keyed.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : x.added < y.added ? -1 : x.added > y.added ? 1 : 0));
  const r = keyed[0].r;
  return { s: r.s, a1: r.from, a2: r.to };
}

// empty: nothing recorded and nothing marked memorised. success: today's goals all met (with goals), or today counts
// for the streak (without goals). Otherwise normal.
export function homeState({ sessions = 0, ranges = 0, others = 0, goals = 0, goalsDoneToday = false, todayCounted = false } = {}) {
  if (!sessions && !ranges && !others) return 'empty';
  if (goals ? goalsDoneToday : todayCounted) return 'success';
  return 'normal';
}

// ---- dates ---------------------------------------------------------------------------------------------------------
const TAG = { zh: 'zh-Hans' };
const loc = (code, cal) => `${TAG[code] ?? code}-u-ca-${cal}-nu-latn`;
export function hijriText(d, code = 'bn') {
  try {
    const f = new Intl.DateTimeFormat(loc(code, 'islamic-umalqura'), { day: 'numeric', month: 'long', year: 'numeric' });
    if (code !== 'bn') return f.format(d);
    const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value])); // ICU's Bengali era word is not the usual one
    return `${p.day} ${p.month} ${p.year} হি.`;
  } catch { return ''; }
}
export function gregText(d, code = 'bn') {
  try {
    const f = new Intl.DateTimeFormat(loc(code, 'gregory'), { day: 'numeric', month: 'long', year: 'numeric' });
    if (code !== 'bn') return f.format(d);
    const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.day} ${p.month} ${p.year}`;
  } catch { return d.toDateString(); }
}
