// Practice history: a port of the laptop app's history.py, as data (the page draws it). Sessions, weak words with their
// events, and where each word was in a saved recording. State lives in plain objects; `persist(kind)` is called after
// every change so the page can write it to IndexedDB (store.js).
//   data = { sessions: [], weak: { "surah:ayah:wi": record }, index: { "<recording stem>": {...} } }
import * as quran from './quran.js';
import { bn, isoLocal, parseLocal, pyRound } from './bn.js';

export const CLEAR_STREAK = 3; // right this many sessions in a row (without looking): the red mark goes
export const MIN_WORDS = 3; // shorter sessions aren't kept
export const MAX_EVENTS = 5; // mistakes kept per word for reviewing
export const GOOD = 95;
export const FAIR = 85; // accuracy (%) of the recent sessions for "well memorized" / "fair"
export const CELL_LEVELS = [3, 6]; // an ayah's weak words, levels added up: from 3 medium red, from 6 dark
export const STRIP_CELLS = 40; // a surah's strip in the overview has at most this many cells
export const HOT_ZONES = 3; // the weak view names this many of a surah's weakest stretches

export const KINDS = { missed: 'ভুল/বাদ', hint: 'আটকে গিয়েছিলে (ইঙ্গিত)', slip: 'ভুল, পরে আবার পড়ে ঠিক করেছিলে' };

// 'error' (red, or had to be prompted/hinted, or red before the reciter went back and fixed it), 'right', or null
function outcome(w) {
  if (w.status === 'missed' || w.status === 'hint' || w.slip) return 'error';
  if (w.status === 'correct') return 'right';
  return null;
}

export function level(r) {
  // How red a word is: 0 none .. 3 dark. More mistakes → darker; each right session in a row lightens it a step.
  if (!r || !r.err) return 0;
  return Math.max(1, Math.min(3, r.err) - r.streak);
}

// How many more right-from-memory sessions (in a row, each one a separate session) clear this word's red mark: the rule in
// record() clears it when streak reaches CLEAR_STREAK; a mistake resets streak to 0. 0 = not red now.
export function remainingToClear(r) {
  if (!r || !r.err) return 0;
  return Math.max(1, CLEAR_STREAK - (r.streak || 0));
}

const cellLevel = (score) => (!score ? 0 : score < CELL_LEVELS[0] ? 1 : score < CELL_LEVELS[1] ? 2 : 3);

export function createHistory({ data = {}, persist = () => {}, now = () => new Date(), hasRecording = () => false, alafasy = null } = {}) {
  data.sessions ??= [];
  data.weak ??= {};
  data.index ??= {};

  const weakRecords = (surah) => { // [[ayah, wi, record]] of the surah's words that are marked now
    const out = [];
    for (const [key, r] of Object.entries(data.weak)) {
      const [s, a, k] = key.split(':').map(Number);
      if (s === surah && level(r)) out.push([a, k, r]);
    }
    return out;
  };

  const recited = (ss = data.sessions) => { // {surah: Set of ayahs recited from memory in some session}
    const out = new Map();
    for (const s of ss) {
      if (s.mode !== 'look') { if (!out.has(s.surah)) out.set(s.surah, new Set()); for (const a of s.ayahs) out.get(s.surah).add(a); }
    }
    return out;
  };

  const marked = () => { // Map surah → Map "a:k" → record
    const out = new Map();
    for (const [key, r] of Object.entries(data.weak)) {
      if (level(r)) {
        const [s, a, k] = key.split(':').map(Number);
        if (!out.has(s)) out.set(s, new Map());
        out.get(s).set(`${a}:${k}`, r);
      }
    }
    return out;
  };

  const h = {
    data,

    // Store a finished session: one entry per surah recited in it. Returns the entries; none if too little was recited.
    record(follower, started, seconds, recording = null) {
      const done = follower.words.map((w) => [w, outcome(w)]).filter(([, o]) => o);
      const bySurah = new Map();
      for (const [w, o] of done) { if (!bySurah.has(w.surah)) bySurah.set(w.surah, []); bySurah.get(w.surah).push([w, o]); }
      const entries = [];
      const end = isoLocal(now());
      for (const [surah, part] of bySurah) {
        if (part.length < MIN_WORDS) continue;
        const errors = part.filter(([, o]) => o === 'error').length;
        const looked = part.filter(([w]) => w.looked).length;
        const timed = part.filter(([w]) => w.t).map(([w]) => w.t);
        entries.push({
          start: isoLocal(started), end,
          seconds: pyRound(bySurah.size === 1 || !timed.length ? seconds : timed.at(-1)[1] - timed[0][0]),
          surah, ayahs: [...new Set(part.map(([w]) => w.ayah))].sort((a, b) => a - b),
          words: part.length, correct: part.length - errors,
          missed: part.filter(([w]) => w.status === 'missed' || w.slip).length,
          stuck: part.filter(([w]) => w.status === 'hint').length,
          strays: follower._strays,
          accuracy: pyRound((100 * (part.length - errors)) / part.length, 1),
          mode: looked === part.length ? 'look' : !looked ? 'hifz' : 'mixed',
          recording: recording ?? null,
        });
      }
      if (!entries.length) return [];
      data.sessions.push(...entries);
      for (const [w, o] of done) {
        if (!entries.some((e) => e.surah === w.surah)) continue;
        const key = `${w.surah}:${w.ayah}:${w.wi}`;
        const r = data.weak[key] ?? { err: 0, streak: 0, total: 0, times: 0 };
        r.times++;
        if (o === 'error') {
          r.err++; r.total++; r.streak = 0;
          r.last_err = entries[0].start;
          const kind = w.status === 'missed' || w.status === 'hint' ? w.status : 'slip';
          const event = { time: entries[0].start, kind, heard: w.heard ?? '' };
          if (recording && w.span) Object.assign(event, { rec: recording, span: w.span, ctx: w.ctxSpan ?? w.span });
          r.events = [...(r.events ?? []), event].slice(-MAX_EVENTS);
        } else if (!w.looked) { // reading it off the screen proves nothing
          r.streak++;
          if (r.streak >= CLEAR_STREAK) r.err = 0;
        }
        if (r.total) data.weak[key] = r; // words never wrong aren't stored
      }
      persist('sessions');
      persist('weak');
      return entries;
    },

    level,
    levels: (surah) => weakRecords(surah).map(([a, k, r]) => [a, k, level(r)]),
    sessions: () => data.sessions,
    weakRecords,

    forget(surah, ayah, wi) { // clear a word's mark; returns its record or null
      const key = `${surah}:${ayah}:${wi}`;
      const r = data.weak[key] ?? null;
      if (r) { delete data.weak[key]; persist('weak'); }
      return r;
    },

    // everything cleared at once ("সব দাগ মুছে দাও"); returns the removed [surah, ayah, wi, record]
    forgetAll(surah = null) {
      const out = [];
      for (const [key, r] of Object.entries(data.weak)) {
        const [s, a, k] = key.split(':').map(Number);
        if (surah === null || s === surah) { out.push([s, a, k, r]); delete data.weak[key]; }
      }
      if (out.length) persist('weak');
      return out;
    },

    recordingOf(r, surah) { // [recording, ayahs] of the session in which the word last went wrong
      const s = data.sessions.find((x) => x.start === r.last_err && x.surah === surah && x.recording);
      return s ? [s.recording, s.ayahs] : null;
    },

    // Where the word's latest mistake is in a saved recording: { rec, span, ctx, heard, kind } or null.
    placeOf(surah, ayah, wi, r) {
      for (const e of [...(r.events ?? [])].reverse()) if (e.rec && e.span && hasRecording(e.rec)) return e;
      const found = h.recordingOf(r, surah);
      if (found && hasRecording(found[0])) {
        const p = (data.index[found[0]] ?? {})[`${surah}:${ayah}:${wi}`];
        if (p) return { ...p, rec: found[0], kind: 'missed' };
      }
      return null;
    },

    // For the popup of each marked word: [[ayah, wi, info]]
    weakAttrs(surah) {
      return weakRecords(surah).map(([a, k, r]) => {
        const events = r.events ?? [];
        const d = { wk: `${surah}:${a}:${k}`, count: r.total, last: r.last_err ?? '', kind: KINDS[events.length ? events.at(-1).kind : 'missed'], left: remainingToClear(r), streak: r.streak || 0 };
        const place = h.placeOf(surah, a, k, r);
        if (place) {
          const span = place.ctx || place.span;
          Object.assign(d, { heard: place.heard ?? '', rfrom: span[0].toFixed(2), rto: span[1].toFixed(2), rec: place.rec });
        }
        const found = alafasy?.contextAudio(surah, a, k, 2, 1);
        if (found) Object.assign(d, { src: found[0], from: found[1].toFixed(2), to: found[2].toFixed(2) });
        return [a, k, d];
      });
    },

    // How weak each ayah of the surah is now.
    ayahCells(surah, records = null, recitedSet = null) {
      const recs = records ?? new Map(weakRecords(surah).map(([a, k, r]) => [`${a}:${k}`, r]));
      const rec = recitedSet ?? recited().get(surah) ?? new Set();
      const score = new Map();
      const words = new Map();
      for (const [key, r] of recs) {
        const a = Number(key.split(':')[0]);
        score.set(a, (score.get(a) ?? 0) + level(r));
        words.set(a, (words.get(a) ?? 0) + 1);
      }
      const cells = [];
      for (let a = 1; a <= quran.surahInfo(surah).ayahs; a++) {
        cells.push({ ayah: a, words: words.get(a) ?? 0, score: score.get(a) ?? 0, level: cellLevel(score.get(a) ?? 0), recited: rec.has(a) });
      }
      return cells;
    },

    hotZones,

    // Per practised surah: sessions, last time, recent accuracy (from memory only), coverage and weakness.
    surahStats() {
      const by = new Map();
      for (const s of data.sessions) { if (!by.has(s.surah)) by.set(s.surah, []); by.get(s.surah).push(s); }
      const mk = marked();
      const rc = recited();
      const out = [];
      for (const [surah, ss] of by) {
        const memory = ss.filter((s) => s.mode !== 'look');
        const recent = memory.slice(-3);
        const acc = recent.length ? pyRound(recent.reduce((a, s) => a + s.accuracy, 0) / recent.length) : null;
        out.push({ surah, sessions: ss.length, last: ss.at(-1).start, accuracy: acc,
          best: memory.length ? Math.max(...memory.map((s) => s.accuracy)) : null,
          covered: (rc.get(surah) ?? new Set()).size, ayahs: quran.surahInfo(surah).ayahs, weak: (mk.get(surah) ?? new Map()).size,
          cells: h.ayahCells(surah, mk.get(surah) ?? new Map(), rc.get(surah) ?? new Set()) });
      }
      return out.sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
    },

    // The progress overview as data: cards, one row per surah, the latest 30 sessions.
    overview() {
      const ss = data.sessions;
      if (!ss.length) return { empty: true };
      const stats = h.surahStats();
      const starts = new Set(ss.map((s) => s.start)); // a session that went from surah to surah has one entry per surah
      const t = now().getTime();
      const week = [...starts].filter((s) => Math.floor((t - parseLocal(s).getTime()) / 86400000) < 7).length;
      return {
        empty: false,
        cards: { sessions: starts.size, surahs: stats.length, minutes: pyRound(ss.reduce((a, s) => a + s.seconds, 0) / 60), week },
        rows: stats.map((st) => ({ ...st, grade: grade(st.accuracy), pct: pyRound((100 * st.covered) / st.ayahs), strip: strip(st.cells) })),
        recent: [...ss.slice(-30)].reverse(),
      };
    },

    // The weak view of one surah: ayah map, hot zones, and the text as units with their marks.
    weakView(surah, indopakWords = () => null) {
      const marks = new Map(h.levels(surah).map(([a, k, l]) => [`${a}:${k}`, l]));
      const attrs = new Map(h.weakAttrs(surah).map(([a, k, d]) => [`${a}:${k}`, d]));
      const units = []; // { ayah, group, text, end }
      for (const [a, words] of quran.ayahs(surah)) {
        const shown = indopakWords(surah, a) || words;
        let group = [];
        for (let k = 0; k < words.length; k++) {
          group.push(k);
          if (shown[k] || k + 1 === words.length) {
            units.push({ ayah: a, group, text: shown[k] || group.map((i) => words[i]).join(' '), end: k + 1 === words.length });
            group = [];
          }
        }
      }
      units.forEach((u, i) => {
        u.level = Math.max(0, ...u.group.map((k) => marks.get(`${u.ayah}:${k}`) ?? 0));
        if (u.level) {
          const k = u.group.find((x) => attrs.has(`${u.ayah}:${x}`));
          u.pre = units.slice(Math.max(0, i - 2), i).map((x) => x.text).join(' ');
          u.post = units.slice(i + 1, i + 2).map((x) => x.text).join(' ');
          u.info = attrs.get(`${u.ayah}:${k}`) ?? null;
          u.wi = k;
        }
      });
      const cells = h.ayahCells(surah);
      return { surah, cells, zones: hotZones(cells), units, count: marks.size };
    },
  };
  return h;
}

// The surah's weakest stretches, weakest first: [[first ayah, last ayah, marked words]].
export function hotZones(cells, count = HOT_ZONES) {
  const top = cells.reduce((m, c) => Math.max(m, c.score), 0);
  if (!top) return [];
  const bar = Math.min(top, Math.max(2, top / 4));
  const zones = [];
  let run = [];
  for (const c of [...cells, null]) {
    if (c !== null && c.score >= bar) run.push(c);
    else if (run.length) {
      zones.push([run.reduce((a, x) => a + x.score, 0), run[0].ayah, run.at(-1).ayah, run.reduce((a, x) => a + x.words, 0)]);
      run = [];
    }
  }
  zones.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  return zones.slice(0, count).map(([, first, last, words]) => [first, last, words]);
}

// A surah's row of cells in the overview, one per ayah (a long surah's ayahs grouped).
export function strip(cells) {
  const size = Math.ceil(cells.length / STRIP_CELLS);
  const out = [];
  for (let i = 0; i < cells.length; i += size) {
    const g = cells.slice(i, i + size);
    out.push({ first: g[0].ayah, last: g.at(-1).ayah, words: g.reduce((a, c) => a + c.words, 0), recited: g.some((c) => c.recited), level: Math.max(...g.map((c) => c.level)) });
  }
  return out;
}

export function grade(acc) {
  if (acc === null) return { cls: 'hp-none', label: 'শুধু দেখে পড়া' };
  if (acc >= GOOD) return { cls: 'hp-good', label: 'ভালো মুখস্থ' };
  if (acc >= FAIR) return { cls: 'hp-fair', label: 'মোটামুটি' };
  return { cls: 'hp-weak', label: 'আরও অনুশীলন দরকার' };
}

export { bn };
