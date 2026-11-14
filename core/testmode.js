// Test mode logic without any DOM (spec C3 §7.3, §7.4, §7.8): seeded question generation over a range, card spans,
// scoring, streaks, suggestions. The page (app/test-ui.js) and the Follower (fixed mode) do the rest.
import * as quran from './quran.js';

export function makeRng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const newSeed = () => Math.floor(Math.random() * 2 ** 31);
const wordCount = (s, a) => quran.ayahs(s, a, a)[0][1].length;

// every ayah of the runs as { s, a, run }
export function candidates(runs) {
  const out = [];
  runs.forEach((r, i) => { for (let a = r[1]; a <= r[2]; a++) out.push({ s: r[0], a, run: i }); });
  return out;
}
function shuffled(list, rng) { const l = [...list]; for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return l; }

// The card for a start place (spec 7.3 step 4-5): { s, a1, wi1, a2, wi2, hint }. runs[run] = [surah, firstAyah, lastAyah]
export function cardSpan(runs, run, a, wi, o) {
  const [s, r1, r2] = runs[run];
  const seq = [];
  for (let x = r1; x <= r2; x++) for (let k = 0; k < wordCount(s, x); k++) seq.push([x, k]);
  const at = (x, k) => seq.findIndex((p) => p[0] === x && p[1] === k);
  const build = (start, hint) => {
    let end;
    if (o.lengthUnit === 'ayahs') {
      const lastAyah = Math.min(r2, seq[start][0] + o.lengthAyahs - 1);
      end = at(lastAyah, wordCount(s, lastAyah) - 1);
    } else {
      end = Math.min(seq.length - 1, start + hint + o.lengthWords - 1);
      if (o.extendToAyahEnd) end = at(seq[end][0], wordCount(s, seq[end][0]) - 1);
    }
    return end;
  };
  let start = at(a, wi);
  let hint = o.hintWords;
  let end = build(start, hint);
  while (end - start + 1 < hint + 2 && seq[start][0] > r1) { // too short: begin at an earlier ayah start of the same run
    const prev = seq[start][0] - 1;
    start = at(prev, 0);
    end = build(start, hint);
  }
  if (end - start + 1 < hint + 2) hint = Math.max(0, end - start + 1 - 2);
  return { s, a1: seq[start][0], wi1: seq[start][1], a2: seq[end][0], wi2: seq[end][1], hint };
}

// A question generator: next() -> card. weakScore(s, a) is used by order 'weak'.
export function createGenerator(runs, o, seed, weakScore = () => 0) {
  const rng = makeRng(seed);
  const cands = candidates(runs);
  let queue = [];
  const order = () => {
    if (o.order === 'seq') return [...cands];
    if (o.order === 'weak') return [...cands].sort((x, y) => weakScore(y.s, y.a) - weakScore(x.s, x.a)); // ties keep range order (stable sort)
    return shuffled(cands, rng);
  };
  let cursor = 0;
  return {
    seed, count: cands.length,
    next() {
      if (!cands.length) return null;
      let c;
      if (o.noRepeat) { if (!queue.length) queue = order(); c = queue.shift(); } else if (o.order === 'seq') { c = cands[cursor++ % cands.length]; } else c = cands[Math.floor(rng() * cands.length)];
      const n = wordCount(c.s, c.a);
      const wi = o.start === 'random' ? Math.floor(rng() * (Math.max(0, n - 3) + 1)) : 0;
      return cardSpan(runs, c.run, c.a, wi, o);
    },
  };
}

// ---- scoring (spec 7.8)
export function tally(cards, skipCounts = true) {
  let pass = 0; let fail = 0; let skipped = 0; let streak = 0; let best = 0;
  for (const c of cards) {
    if (c.result === 'pass') { pass++; streak++; best = Math.max(best, streak); } else { streak = 0; if (c.result === 'fail') fail++; else if (c.result === 'skipped') skipped++; }
  }
  const answered = pass + fail + (skipCounts ? skipped : 0);
  return { pass, fail, skipped, answered, score: answered ? Math.round((100 * pass) / answered) : null, streak, bestStreak: best };
}
export const cardMistakes = (c) => (c.mistakes ?? []).filter((m) => !m.removed).length + (c.peekMistakes ?? 0) + (c.stray ? 1 : 0);
// the result of a finished card from its mistakes (removing all mistakes flips a failed card to pass)
export const resultOf = (c) => (c.result === 'skipped' ? 'skipped' : cardMistakes(c) === 0 ? 'pass' : 'fail');

// ---- suggestions (spec 7.4): up to 4 cards { id, runs } with at least 3 ayahs
export function suggestions({ memorized, sessions, weakScore, good = 95, dayOfYear = 0, today = new Date() }) {
  const mem = new Set();
  for (const r of memorized) for (let a = r.from; a <= r.to; a++) mem.add(`${r.s}:${a}`);
  if (!mem.size) return [];
  const ayahs = [...mem].map((k) => k.split(':').map(Number)).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const last = new Map();
  const goodOnes = new Set();
  for (const x of sessions) {
    if (x.mode === 'look') continue;
    for (const a of x.ayahs) { const k = `${x.surah}:${a}`; if (!last.has(k) || last.get(k) < x.start) last.set(k, x.start); if (x.accuracy >= good) goodOnes.add(k); }
  }
  const toRuns = (list) => { const runs = []; for (const [s, a] of list.sort((x, y) => x[0] - y[0] || x[1] - y[1])) { const l = runs.at(-1); if (l && l[0] === s && l[2] === a - 1) l[2] = a; else runs.push([s, a, a]); } return runs; };
  const cap = (list) => list.slice(0, 20);
  const all = {
    warmup: cap(ayahs.filter(([s, a]) => weakScore(s, a) === 0 && goodOnes.has(`${s}:${a}`)).sort((x, y) => (last.get(`${y[0]}:${y[1]}`) ?? '').localeCompare(last.get(`${x[0]}:${x[1]}`) ?? ''))),
    weak: cap(ayahs.filter(([s, a]) => weakScore(s, a) > 0).sort((x, y) => weakScore(y[0], y[1]) - weakScore(x[0], x[1]))),
    stale: cap([...ayahs].sort((x, y) => (last.get(`${x[0]}:${x[1]}`) ?? '').localeCompare(last.get(`${y[0]}:${y[1]}`) ?? ''))),
    fresh: cap(memorized.filter((r) => r.added && (today - new Date(r.added)) / 86400000 <= 14).flatMap((r) => Array.from({ length: r.to - r.from + 1 }, (_, i) => [r.s, r.from + i]))),
    mixed: cap(ayahs),
  };
  const rot = ['stale', 'fresh', 'mixed'];
  const ids = ['weak', 'warmup', rot[dayOfYear % 3], rot[(dayOfYear + 1) % 3]];
  return ids.map((id) => ({ id, runs: toRuns(all[id]) })).filter((x) => x.runs.reduce((n, r) => n + r[2] - r[1] + 1, 0) >= 3);
}
export const dayOfYear = (d = new Date()) => Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);

// the test options read from the settings (a snapshot taken at test start)
export const optionsFrom = (get) => ({ endBy: get('test.endBy'), questions: get('test.questions'), minutes: get('test.minutes'), lengthUnit: get('test.lengthUnit'), lengthWords: get('test.lengthWords'),
  lengthAyahs: get('test.lengthAyahs'), extendToAyahEnd: get('test.extendToAyahEnd'), hintWords: get('test.hintWords'), start: get('test.start'), order: get('test.order'), noRepeat: get('test.noRepeat') });

// ---- stored tests: read-only card view and remove / restore that only change that test's score (spec 9.6)
// Words of a card with their look: 'given' (hint), 'bad' (open mistake), 'fixed' (removed mistake), 'ok', or 'plain' (skipped card).
export function cardWords(card) {
  const bad = new Map((card.mistakes ?? []).map((m) => [`${m.a}:${m.wi}`, m]));
  const out = [];
  for (const [a, ws] of quran.ayahs(card.s, card.a1, card.a2)) {
    ws.forEach((text, wi) => {
      if ((a === card.a1 && wi < card.wi1) || (a === card.a2 && wi > card.wi2)) return;
      const m = bad.get(`${a}:${wi}`);
      const n = out.length;
      out.push({ a, wi, text, end: wi === ws.length - 1, status: n < card.hint ? 'given' : m ? (m.removed ? 'fixed' : 'bad') : card.result === 'skipped' ? 'plain' : 'ok' });
    });
  }
  return out;
}
// A copy of the stored test with mistake mi of card ci removed (or put back): the card result and the score are recomputed.
export function toggleRemoved(rec, ci, mi, skipCounts = true) {
  const next = { ...rec, cards: rec.cards.map((c, i) => (i === ci ? { ...c, mistakes: c.mistakes.map((m, j) => (j === mi ? { ...m, removed: !m.removed } : m)) } : c)) };
  next.cards[ci].result = resultOf(next.cards[ci]);
  return { ...next, ...tally(next.cards, skipCounts) };
}
