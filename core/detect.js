// Find which surah and ayahs a transcription is from: a port of the laptop app's detect.py.
import { SequenceMatcher } from './difflib.js';
import * as quran from './quran.js';

const MIN_COVERAGE = 0.35; // share of an ayah (or of the recitation, if shorter) heard to count the ayah
const MAX_GAP = 3; // ayahs further apart than this start a separate cluster
const MIN_EXTEND_IDF = 3.0; // a neighbouring ayah joins if it explains this much more of what was heard

// Words and word pairs. Pairs make phrase order count, words survive single-word errors.
function features(norm) {
  const f = new Set(norm);
  for (let i = 0; i + 1 < norm.length; i++) f.add(`${norm[i]} ${norm[i + 1]}`);
  return f;
}

let index = null;
const keyOf = (s, n) => s * 1000 + n;

function buildIndex() {
  const ayahFeats = new Map();
  const df = new Map();
  for (let s = 1; s <= 114; s++) {
    for (const [n, w] of quran.ayahs(s)) {
      const f = features(w.map(quran.normalize));
      ayahFeats.set(keyOf(s, n), f);
      for (const x of f) df.set(x, (df.get(x) ?? 0) + 1);
    }
  }
  const idf = new Map();
  for (const [x, d] of df) idf.set(x, Math.log(ayahFeats.size / d));
  const inverted = new Map();
  const totals = new Map();
  for (const [key, f] of ayahFeats) {
    let t = 0;
    for (const x of f) {
      if (!inverted.has(x)) inverted.set(x, []);
      inverted.get(x).push(key);
      t += idf.get(x);
    }
    totals.set(key, t);
  }
  return { inverted, idf, totals };
}

// Drop a leading ta'awwudh/basmala if most of its words were heard. A phrase still being recited counts too.
function stripPrefix(normWords, phrase) {
  const p = quran.words(phrase).map(quran.normalize);
  const head = normWords.slice(0, p.length);
  let hits = 0;
  head.forEach((a, i) => { if (i < p.length && new SequenceMatcher(a, p[i]).ratio() > 0.6) hits++; });
  return head.length && hits >= Math.max(1, head.length - 1) ? [normWords.slice(p.length), true] : [normWords, false];
}

// A ta'awwudh heard too badly for stripPrefix is cut through its last word if that comes early.
function stripGarbledIstiadha(w) {
  let k = w.slice(0, 6).findIndex((x) => x.startsWith('الرجي'));
  if (k < 0) k = w.slice(0, 5).findIndex((x) => x.endsWith('يطان')); // still being recited: cut through الشيطان
  return k < 0 ? w : w.slice(k + 1);
}

function stripGarbledBasmala(w) {
  const k = w.slice(0, 6).findIndex((x, i) => x === 'الرحيم' && w.slice(Math.max(0, i - 3), i).includes('الله'));
  return k >= 0 ? [w.slice(k + 1), true] : [w, false];
}

// The words after a leading ta'awwudh and (basmala = true) basmala, and whether a basmala was there.
export function stripOpeners(normWords, basmala = true) {
  let [hyp] = stripPrefix(normWords, quran.ISTIADHA);
  hyp = stripGarbledIstiadha(hyp);
  if (!basmala) return [hyp, false];
  let had;
  [hyp, had] = stripPrefix(hyp, quran.BASMALA);
  const [rest, garbled] = stripGarbledBasmala(hyp);
  return [rest, had || garbled];
}

// Python's round(x, 2): exact ties go to the even digit.
export function round2(x) {
  const t = x * 8;
  if (Number.isFinite(x) && Number.isInteger(t) && t % 2 !== 0) {
    const lo = Math.floor(x * 100);
    return (lo % 2 === 0 ? lo : lo + 1) / 100;
  }
  return Number(x.toFixed(2));
}

const sumIdf = (set, idf) => { let t = 0; for (const x of set) t += idf.get(x); return t; };

// → { surah, first, last, confidence, words, margin } or null
export function detect(heardText) {
  const [hyp, hadBasmala] = stripOpeners(heardText.split(/[\s\u001c-\u001f\u0085]+/).filter(Boolean).map(quran.normalize));
  if (!hyp.length) return null;
  index ??= buildIndex();
  const { inverted, idf, totals } = index;
  const heard = features(hyp);
  let heardTotal = 0;
  for (const x of heard) heardTotal += idf.get(x) ?? 0;
  const matched = new Map(); // key → Set of features
  for (const x of heard) for (const key of inverted.get(x) ?? []) {
    if (!matched.has(key)) matched.set(key, new Set());
    matched.get(key).add(x);
  }
  const empty = new Set();
  const m = (s, n) => matched.get(keyOf(s, n)) ?? empty;
  const weight = (set) => sumIdf(set, idf);

  const bySurah = new Map();
  for (const [key, set] of matched) {
    if (weight(set) / Math.min(totals.get(key), heardTotal) >= MIN_COVERAGE) {
      const s = Math.floor(key / 1000);
      if (!bySurah.has(s)) bySurah.set(s, []);
      bySurah.get(s).push(key % 1000);
    }
  }
  if (!bySurah.size) return null;

  // Best cluster of nearby ayahs; each heard feature counts once, so extra ayahs only win if they explain more.
  let best = null;
  const surahBest = new Map();
  for (const [s, ns] of bySurah) {
    ns.sort((a, b) => a - b);
    let cluster = [ns[0]];
    for (const n of [...ns.slice(1), null]) {
      if (n !== null && n - cluster.at(-1) <= MAX_GAP) { cluster.push(n); continue; }
      const score = weight(new Set(cluster.flatMap((c) => [...m(s, c)])));
      surahBest.set(s, Math.max(score, surahBest.get(s) ?? 0));
      if (best === null || score > best[0]) best = [score, s, cluster[0], cluster.at(-1)];
      if (n !== null) cluster = [n];
    }
  }

  const [top, surah, firstIn, lastIn] = best;
  let first = firstIn;
  let last = lastIn;
  let runnerUp = 0;
  for (const [s, v] of surahBest) if (s !== surah) runnerUp = Math.max(runnerUp, v);
  const count = quran.surahInfo(surah).ayahs;
  const explainedBy = (a, b) => { const u = new Set(); for (let n = a; n <= b; n++) for (const x of m(surah, n)) u.add(x); return u; };
  const minus = (a, b) => new Set([...a].filter((x) => !b.has(x)));

  // Trim end ayahs that add nothing new (e.g. a refrain repeated through a surah)
  while (last > first && weight(minus(m(surah, last), explainedBy(first, last - 1))) < MIN_EXTEND_IDF) last--;
  while (first < last && weight(minus(m(surah, first), explainedBy(first + 1, last))) < MIN_EXTEND_IDF) first++;
  const explained = explainedBy(first, last);

  // Pull in neighbours whose words were heard but misheard too much to pass MIN_COVERAGE
  for (const step of [-1, 1]) {
    for (;;) {
      const n = step < 0 ? first - 1 : last + 1;
      if (!(n >= 1 && n <= count) || weight(minus(m(surah, n), explained)) < MIN_EXTEND_IDF) break;
      for (const x of m(surah, n)) explained.add(x);
      if (step < 0) first = n; else last = n;
    }
  }

  // Al-Fatiha's basmala is ayah 1, so it was stripped above
  if (surah === 1 && first === 2 && hadBasmala) first = 1;
  const ref = new Set();
  for (const [, ws] of quran.ayahs(surah, first, last)) for (const w of ws) ref.add(quran.normalize(w));
  const confidence = hyp.filter((w) => ref.has(w)).length / hyp.length;
  return { surah, first, last, confidence: round2(confidence), words: hyp.length,
    margin: runnerUp ? round2(top / runnerUp) : Infinity };
}
