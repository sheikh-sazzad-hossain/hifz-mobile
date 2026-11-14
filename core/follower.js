// The hifz follower: a port of the laptop app's live.py. It follows a recitation, reveals each word once it is
// said, marks mistakes and added words, finds the surah by itself, goes back / strays / relocks, and runs the
// silence prompt (Alafasy recites on). All logic is plain JS with no DOM; audio comes in with addAudio(), model
// passes go through `asr.hear(samples16k, { priority })`, everything else the follower needs is injected (`deps`).
//
// Differences from live.py (details in PORT.md section 8): one model serves live and check passes (live
// passes have priority); word times come from the CTC frames (live passes need no rough "spread" times);
// the follower is async (two loops sharing one thread: no locks, state is changed synchronously between awaits);
// view() returns data for the UI instead of HTML.
import * as quran from './quran.js';
import { SequenceMatcher } from './difflib.js';
import { detect, stripOpeners, round2 } from './detect.js';
import { pair, percentile, quietPieces } from './pair.js';

export const SAMPLE_RATE = 16000;
export const C = {
  WINDOW_S: 6.0, MAX_WINDOW_S: 20.0, UPDATE_EVERY_S: 0.25, LOOKAHEAD: 12, SHORT_SKIP: 3, LONG_SKIP_RUN: 3,
  FINAL_SKIP: 8, SILENCE: 0.01, DETECT_EVERY_S: 1.2, DETECT_MIN_WORDS: 4, DETECT_MARGIN: 1.4, DETECT_SURE_WORDS: 20,
  AUTO_AYAHS: 10, AUTO_EXTEND_AT: 15, LOST_S: 8, LOST_REDS: 5, LOST_OF: 8, RELOCK_EVERY_S: 4, NEW_SURAH_VOICED_S: 2,
  SWITCH_CONFIDENCE: 0.5, CONFIRMED_WORDS: 15, REWIND_RUN: 3, REWIND_MIN: 3, BACK_WORDS: 80, VERIFY_WINDOW_S: 7,
  VERIFY_MAX_S: 20, STUCK_S: 2.0, PLAY_LAG: 0.6, BACK_GRACE_S: 0.8, BACK_FRAMES: 8, BACK_LOUD: 6, LEAK_BLOCK: 15,
  BACK_VOICE: 0.35, BACK_LEAK: 1.6, QUIET: 0.12, QUIET_FLOOR: 0.004, AUDIT_AFTER: 2, AUDIT_BACK: 120, AUDIT_PAD_S: 0.4,
  AUDIT_ANCHOR: 4, AUDIT_TAIL_S: 3.0, AUDIT_MAX_S: 150.0, AUDIT_VOICE: 0.3, AUDIT_VOICED: 0.5, ADDED_WORD_MAX_S: 2.5,
  AUDIT_AGAIN_S: 1.5, ADDED_TRIES: 3, ADDED_NEAR: 3, ADDED_GAP: 3, REPEAT_AHEAD: 12, REPEAT_FAR_BACK: 400,
  ADDED_CLIP_S: 12.0, CHECK_EVERY_S: 4.0, MIN_WINDOW_S: 3.0, TARGET_PASS_S: 0.5, FINAL_AUDITS: 2, MAX_CLIP_S: 6.0, CLIP_CONTEXT_WORDS: 2,
};
export const DEFAULT_C = Object.freeze({ ...C });
export const DEFAULT_OPTS = Object.freeze({ slow: true, changed: true, skipped: true, added: true, stray: true, noAdvance: false, silenceHelp: 'surah', promptOnLook: false, teach: true,
  ctxBefore: 2, ctxAfter: 1, myCtx: 2, fixed: false });
// Engine values from the settings (spec C3 §2.5): back to the defaults, then the overrides. Called only while nothing runs.
export function applyTuning(over = {}) {
  Object.assign(C, DEFAULT_C, over);
  LIKE_CACHE.clear();
  quran.setSimilarRatio(over.SIMILAR_RATIO ?? quran.SIMILAR_RATIO);
}
const FRAME = SAMPLE_RATE / 20; // 50 ms
const JOINED_PARTICLES = new Set(['يا', 'ويا', 'فيا', 'ها']); // vocative/"ha" the model joins to the next word
const OPENER_WORDS = new Set([...quran.words(quran.ISTIADHA), ...quran.words(quran.BASMALA)].map(quran.normalize));
const INVENTED = new Set(['والمومنين']);
const UNIT_ORDER = ['missed', 'pending', 'hint', 'given']; // a joined word shows the worst of its parts

const LIKE_CACHE = new Map();
// a, b normalized: the same word as the model hears it (quran.alike alone takes short words of the same letter
// groups for each other)
function like(a, b) {
  if (a === b) return true;
  const key = `${a}|${b}`;
  let v = LIKE_CACHE.get(key);
  if (v === undefined) {
    v = quran.alike(a, b) && new SequenceMatcher(a, b).ratio() >= 0.5;
    if (LIKE_CACHE.size > 1 << 17) LIKE_CACHE.clear();
    LIKE_CACHE.set(key, v);
  }
  return v;
}
const similar = quran.similar;

// heard[run[j]] is text[k]: how far the run of heard words goes on along the text from there. Returns
// [heard words taken, last text index, words matched].
function runOn(text, heard, run, j, k) {
  let a = j + 1;
  let last = k;
  let matched = 1;
  let taken = j + 1;
  const step = (h, steps) => steps.find((d) => last + d < text.length && like(text[last + d], h)) ?? null;
  while (a < run.length) {
    let d = step(heard[run[a]], matched === 1 ? [1] : [1, 2]);
    if (d !== null) { last += d; matched++; a++; taken = a; continue; }
    if (matched > 1 && a + 1 < run.length) {
      d = step(heard[run[a + 1]], [1, 2]);
      if (d !== null) { last += d; matched++; a += 2; taken = a; continue; }
    }
    break;
  }
  return [taken - j, last, matched];
}

// The run's heard words from j on are the text again, not added: [heard words taken, index of the last text word]
// of the longest such stretch, or null.
function textAgain(text, surahs, heard, run, j, path, resume) {
  const surah = surahs[Math.min(path, text.length - 1)];
  const near = Math.max(0, path - C.BACK_WORDS);
  let best = null; // [matched, -dist, n, last]
  for (let k = Math.max(0, path - C.REPEAT_FAR_BACK); k < Math.min(text.length, path + C.REPEAT_AHEAD + 1); k++) {
    if ((k < near && surahs[k] !== surah) || !like(text[k], heard[run[j]])) continue;
    const [n, last, matched] = runOn(text, heard, run, j, k);
    const into = resume !== null && j + n === run.length && Math.abs(last + 1 - resume) <= 2;
    let ok;
    if (k >= path) ok = k === path || matched >= 3 || (into && last + 1 === resume);
    else ok = matched >= 4 || (k >= near && ((matched >= 2 && (last >= path - 1 || into)) || (into && last + 1 === resume)));
    const d = -Math.abs(path - k);
    if (ok && (best === null || matched > best[0] || (matched === best[0] && d > best[1]))) best = [matched, d, n, last];
  }
  return best && [best[2], best[3]];
}

// Words said in between the text's words that are neither the text nor going back over it, by passage:
// [[place, [heard indices]]], kind (Map heard index → "good" | "bad" | "ins").
function addedPassages(text, surahs, segLo, segHi, heard) {
  const pairs = pair(text.slice(segLo, segHi), heard);
  const kind = new Map();
  for (const [ri, hj] of pairs) {
    if (hj !== null) kind.set(hj, ri === null ? 'ins' : (like(text[segLo + ri], heard[hj]) ? 'good' : 'bad'));
  }
  const passages = [];

  function explain(run, path0, resume) {
    let path = path0;
    let j = 0;
    const mine = []; // [place, heard indices, j of the last]
    while (j < run.length) {
      const again = textAgain(text, surahs, heard, run, j, path, resume);
      if (again) { const [n, last] = again; path = last + 1; j += n; continue; }
      const m = mine.at(-1);
      if (m && m[0] === path && m[2] === j - 1) { m[1].push(run[j]); m[2] = j; } else mine.push([path, [run[j]], j]);
      j++;
    }
    if (resume === null) return; // not (yet) in between: the reciter is still on it, or went on elsewhere
    // a passage right before the text is heard again: if text words in between were not heard, it came after them
    const m = mine.at(-1);
    if (m && m[2] === run.length - 1 && resume > m[0]) m[0] = resume;
    for (const [place, idx] of mine) passages.push([place, idx]);
  }

  let run = [];
  let cur = segLo;
  for (const [ri, hj] of pairs) {
    if (hj === null) continue;
    if (kind.get(hj) !== 'good') { run.push(hj); continue; }
    if (run.some((x) => kind.get(x) === 'ins')) explain(run, cur, segLo + ri);
    run = [];
    cur = segLo + ri + 1;
  }
  if (run.some((x) => kind.get(x) === 'ins')) explain(run, cur, null);
  const merged = []; // one passage, though a word or two of it were aligned with the text
  for (const [place, idx] of passages) {
    const last = merged.at(-1);
    if (last && idx[0] - last[1].at(-1) <= C.ADDED_GAP + 1) last[1].push(...idx);
    else merged.push([place, [...idx]]);
  }
  return [merged, kind];
}

function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

// word (heard) looks like a piece of `other` (a text word) that the model heard as two words
function splitPart(word, other) {
  const rev = (s) => [...s].reverse().join('');
  const common = Math.max(commonPrefix(word, other), commonPrefix(rev(word), rev(other)));
  return common >= 4 && common >= 0.6 * Math.min(word.length, other.length);
}

// A heard word (normalized) that can be added before text[place]: a word of the Quran, not one of the
// ta'awwudh/basmala or the model's usual invention, and not like the text right there.
function mayBeAddedAt(word, text, place) {
  if (!quran.mayBeAdded(word) || INVENTED.has(word)) return false;
  for (const o of OPENER_WORDS) if (quran.sameWord(o, word) && new SequenceMatcher(o, word).ratio() >= 0.5) return false;
  for (let k = Math.max(0, place - C.ADDED_NEAR); k < Math.min(text.length, place + C.ADDED_NEAR + 1); k++) if (quran.alike(text[k], word)) return false;
  for (let k = Math.max(0, place - 1); k < Math.min(text.length, place + 2); k++) if (splitPart(word, text[k])) return false;
  return true;
}

const defaultDeps = () => ({
  history: { levels: () => [], weakAttrs: () => [] },
  feedback: { sameAsAccepted: () => false, add: () => {} },
  alafasy: { spanAudio: () => null, wordStart: () => 0, contextAudio: () => null },
  indopak: { ayahWords: () => null },
});

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

export class Follower {
  // deps: { history: { levels(surah) → [[ayah, wi, level]], weakAttrs(surah) → [[ayah, wi, info]] },
  //         feedback: { sameAsAccepted(surah, ayah, wi, heard, clipSamples) → bool, add(...) },
  //         alafasy: { spanAudio(surah, ayah, wi, toEnd) → [src, from, to] | null, wordStart(surah, ayah, wi) → s,
  //                    contextAudio(surah, ayah, wi, before, after) → [src, from, to] | null },
  //         indopak: { ayahWords(surah, ayah) → [shown words] | null }, sleep(ms), newId() }
  constructor(surah = null, first = 1, last = null, deps = {}) {
    this.deps = { ...defaultDeps(), ...deps };
    this.opts = { ...DEFAULT_OPTS, ...(deps.opts ?? {}) };
    this.sleep = deps.sleep ?? sleepReal;
    this._newId = deps.newId ?? (() => Math.random().toString(16).slice(2, 14).padEnd(12, '0'));
    this._running = false;
    this._loops = [];
    this._id = null;
    this._leakSeen = null; // Alafasy's lowest level in the mic so far (kept across recordings)
    this.waitS = C.STUCK_S;
    this.pieceS = deps.pieceS ?? 20; // longest model pass of the check work (a slow phone sets less, so live passes wait less)
    this.look = false; // text shown (reading, not from memory); the app sets it
    this.reset(surah, first, last);
  }

  reset(surah = null, first = 1, last = null) {
    this._running = false;
    this._id = this._newId();
    this.auto = surah === null;
    this.words = [];
    this.weak = new Map(); // "surah:ayah:wi" → level (1..3)
    this.weakInfo = new Map();
    this._rangeEnd = 0; // a range chosen by hand is shown as chosen until recited this far
    this._buf = new Float32Array(SAMPLE_RATE * 60);
    this.len = 0; // samples of audio so far
    this._shown = new Set();
    this._levels = [];
    this._levelsVersion = 0;
    this._p90 = null;
    if (surah !== null) { this._load(surah, first, last); this._rangeEnd = this.words.length; }
    this.pos = 0; // index of the next word expected
    this.updatedAt = 0; // audio length (samples) at the last update
    this.advancedAt = 0; // audio length when the reciter last moved forward
    this.prompt = null; // {id, src, from, to}: the last Alafasy prompt; the page plays it
    this._prompts = 0;
    this.playing = null; // while Alafasy recites: {t0, f0, surah, from, end, voice}
    this._nextPromptAt = 0;
    this._relockAt = 0;
    this._lastCheckAt = 0;
    this._passRate = 0; // measured model seconds per audio second of live passes (0: not measured yet)
    this.paused = false;
    this._block = null; // detect.noAdvance: index of the red word the reciter must fix before going on
    this.stray = null; // {id, surah, ayah}: reciting another surah's ayah right now
    this._strays = 0;
    this._audited = new Set(); // "surah:ayah" re-heard for added words
    this._addedAt = []; // recording times (s) of the added words the audit found
    this.started = null;
    this.version = 0; // bumped on every change the view would show
  }

  get audio() { return this._buf.subarray(0, this.len); }

  get surah() { return this.words.length ? this.words[Math.min(this.pos, this.words.length - 1)].surah : null; }

  _wordsOf(surah, first, last) {
    // "t": [start, end] s in the recording once heard; "wi": index in its ayah (for Alafasy); "show": the Indo-Pak
    // text shown for it ("" if joined to the next word, see units()); later "looked" (text was on screen when the
    // word was reached) and "slip" (wrong or prompted before the reciter went back and recited it again)
    const out = [];
    for (const [n, ws] of quran.ayahs(surah, first, last)) {
      const shown = this.deps.indopak.ayahWords(surah, n) || ws;
      ws.forEach((w, k) => out.push({ surah, ayah: n, wi: k, word: w, norm: quran.normalize(w), status: null, show: shown[k] }));
    }
    return out;
  }

  _load(surah, first, last) {
    this.words = [];
    this.weak = new Map();
    this.weakInfo = new Map();
    this._shown = new Set();
    this._append(surah, first, last);
  }

  _append(surah, first, last) {
    if (!this.words.some((w) => w.surah === surah)) { // where earlier sessions went wrong
      for (const [a, k, lvl] of this.deps.history.levels(surah)) this.weak.set(`${surah}:${a}:${k}`, lvl);
      for (const [a, k, d] of this.deps.history.weakAttrs(surah)) this.weakInfo.set(`${surah}:${a}:${k}`, d);
    }
    this.words.push(...this._wordsOf(surah, first, last));
    this.version++;
  }

  forgetMark(surah, ayah, wi) { // a mark the reciter cleared
    this.weak.delete(`${surah}:${ayah}:${wi}`);
    this.weakInfo.delete(`${surah}:${ayah}:${wi}`);
    this.version++;
  }

  // Keep text ahead of the reciter on screen: the next ayahs and, after a surah's last ayah, the next surah.
  _extend() {
    if (this.opts.fixed) return; // a test card is exactly its words
    const margin = this.auto || this.pos >= this._rangeEnd ? C.AUTO_EXTEND_AT : 1;
    while (this.words.length && this.words.length - this.pos < margin) {
      const last = this.words.at(-1);
      const count = quran.surahInfo(last.surah).ayahs;
      if (last.ayah < count) this._append(last.surah, last.ayah + 1, Math.min(count, last.ayah + C.AUTO_AYAHS));
      else if (last.surah < 114) {
        const nxt = last.surah + 1;
        this._append(nxt, 1, Math.min(quran.surahInfo(nxt).ayahs, C.AUTO_AYAHS));
      } else break;
    }
  }

  // Make sure the surah being recited is shown up to `ayah` and AUTO_AYAHS beyond.
  _showThrough(surah, ayah) {
    const last = this.words.at(-1);
    if (last.surah === surah) {
      const newLast = Math.min(quran.surahInfo(surah).ayahs, ayah + C.AUTO_AYAHS - 1);
      if (newLast > last.ayah) this._append(surah, last.ayah + 1, newLast);
    }
  }

  _partStart(i0) { // index of the first shown word of the surah that word i belongs to
    let i = i0;
    while (i > 0 && this.words[i - 1].surah === this.words[i].surah) i--;
    return i;
  }

  trim(a1, wi1, a2, wi2) { // test card: keep the words from (a1, wi1) to (a2, wi2) of what is loaded
    const i = this.words.findIndex((w) => w.ayah === a1 && w.wi === wi1);
    let j = -1;
    this.words.forEach((w, k) => { if (w.ayah === a2 && w.wi === wi2) j = k; });
    if (i < 0 || j < i) return false;
    this.words = this.words.slice(i, j + 1);
    this._rangeEnd = this.words.length;
    this.pos = 0;
    this._shown = new Set();
    this.version++;
    return true;
  }

  give(n) { // the first n words are given as the card's hint
    for (let k = 0; k < Math.min(n, this.words.length); k++) { this.words[k].status = 'given'; this.words[k].looked = true; }
    this.pos = Math.min(n, this.words.length);
    this.version++;
  }

  _atNewSurah() {
    if (this.opts.fixed) return false; // a surah was recited to its end and the next one has not been begun
    return this.pos > 0 && this.pos < this.words.length && this.pos === this._partStart(this.pos);
  }

  // --- background following ---

  // Follow in two loops (live and check) until halt()/finish(). One model serves both; live passes go first.
  start(asr) {
    this._running = true;
    this._loops = [this._liveLoop(asr), this._checkLoop(asr)];
  }

  async _liveLoop(asr) {
    while (this._running) {
      this.maybePrompt();
      if (this.playing) await this.sleep(50); // the mic hears Alafasy now, not the reciter
      else if (this.surah === null) {
        if (this.len - this.updatedAt >= C.DETECT_EVERY_S * SAMPLE_RATE) await this.findSurah(asr);
        else await this.sleep(100);
      } else if (this.due()) await this.update(asr);
      else await this.sleep(50);
    }
  }

  async _checkLoop(asr) {
    while (this._running) {
      if (this.playing) await this.sleep(100);
      else if (this.newSurahDue() || this.lost()) {
        this._relockAt = this.len;
        await this.findSurah(asr, { relock: true });
      } else if (this.pending().length || this.auditDue()) {
        // check work waits while the live loop has new audio to hear (a slow phone: live passes first), but at
        // most CHECK_EVERY_S of audio, so words never stay pending for long
        if (this.due() && this.len - this._lastCheckAt < C.CHECK_EVERY_S * SAMPLE_RATE) { await this.sleep(100); continue; }
        this._lastCheckAt = this.len;
        if (this.pending().length) await this.verify(asr); else await this.audit(asr);
      } else await this.sleep(100);
    }
  }

  async halt() {
    this._running = false;
    const loops = this._loops;
    this._loops = [];
    await Promise.all(loops);
  }

  // Stop listening but keep everything, so the reciter can look at (and listen to) the red words.
  async pause(asr) {
    await this.halt();
    this.paused = true;
    this._stopAlafasy(this.len);
    if (this.surah !== null) await this.verify(asr);
    this.version++;
  }

  // Listen again after pause(). Audio from the pause was never added, so the recording just goes on; a short
  // silence keeps the last word before the pause and the first after it apart.
  resume(asr) {
    this.paused = false;
    this.addAudio(new Float32Array(SAMPLE_RATE / 2));
    const now = this.len;
    this.updatedAt = this.advancedAt = this._relockAt = now; // quiet from before the pause is not stuck or lost
    this._nextPromptAt = now + Math.floor(this.waitS * SAMPLE_RATE);
    this.version++;
    this.start(asr);
  }

  // Recording stopped: stop the loops and take one last, longer look.
  async finish(asr) {
    await this.halt();
    this.paused = false;
    this._stopAlafasy(this.len);
    if (this.surah === null) await this.findSurah(asr, { final: true });
    if (this.surah !== null) {
      await this.verify(asr);
      await this.update(asr, { final: true });
      for (let n = 0; n < C.FINAL_AUDITS; n++) { // the last ayahs recited were not re-heard for added words yet
        if (this.auditDue(true) === null) break;
        await this.audit(asr, { final: true });
      }
    }
    this.version++;
  }

  // --- recognition ---

  addAudio(chunk) { // 16 kHz mono float32
    const n = Math.floor(chunk.length / FRAME) * FRAME;
    for (let f = 0; f < n; f += FRAME) {
      let s = 0;
      for (let i = f; i < f + FRAME; i++) s += chunk[i] * chunk[i];
      this._levels.push(Math.sqrt(s / FRAME));
    }
    this._levelsVersion++;
    if (this.len + chunk.length > this._buf.length) {
      const bigger = new Float32Array(Math.max(this._buf.length * 2, this.len + chunk.length));
      bigger.set(this._buf.subarray(0, this.len));
      this._buf = bigger;
    }
    this._buf.set(chunk, this.len);
    this.len += chunk.length;
  }

  _voice() { // the reciter's voice level: 90th percentile of all frame levels
    if (this._p90 === null || this._p90[0] !== this._levelsVersion) this._p90 = [this._levelsVersion, percentile(this._levels, 90)];
    return this._p90[1];
  }

  quietFor(seconds) { // the last `seconds` of the recording are silence
    const n = Math.floor(seconds * 20);
    if (this._levels.length < n) return false;
    let mx = -Infinity;
    for (let i = this._levels.length - n; i < this._levels.length; i++) mx = Math.max(mx, this._levels[i]);
    return mx < Math.max(C.QUIET_FLOOR, C.QUIET * this._voice());
  }

  // The reciter has been silent for waitS after starting: Alafasy (played by the page) recites on from the next
  // word, and goes on into the next surah, until the reciter's own voice is heard again (or pause/stop).
  maybePrompt() {
    if (this.playing) { this._followAlafasy(); return; }
    if (!this.waitS || this.surah === null || this.done() || (this.look && !this.opts.promptOnLook) || this.len < this._nextPromptAt || this._atNewSurah()
      || !this.words.slice(0, this.pos).some((w) => w.status === 'correct' || w.status === 'given') || !this.quietFor(this.waitS)) return;
    if (this.opts.silenceHelp === 'show') { // no audio: the next word is shown once, then waiting starts again
      this.hint();
      this._nextPromptAt = this.len + Math.floor(this.waitS * SAMPLE_RATE);
      return;
    }
    this._playFrom(this.pos, this._voice());
  }

  _playFrom(k, voice) { // Alafasy recites from word k to the end of its surah. voice: the reciter's own level
    const w = this.words[k];
    const kind = this.opts.silenceHelp;
    const left = this.words.filter((x) => x.surah === w.surah && x.ayah === w.ayah).length;
    const last = kind === 'word' ? w.wi : kind === 'words3' ? Math.min(w.wi + 2, left - 1) : null;
    const found = this.deps.alafasy.spanAudio(w.surah, w.ayah, w.wi, kind === 'surah', last);
    if (!found) { this._nextPromptAt = this.len + Math.floor(this.waitS * SAMPLE_RATE); return; }
    this._prompts++;
    this.prompt = { id: `${this._id}-${this._prompts}`, src: found[0], from: found[1].toFixed(2), to: found[2].toFixed(2) };
    this.playing = { t0: this.len, f0: this._levels.length, surah: w.surah, from: found[1], end: found[2], voice };
    this.version++;
  }

  // While Alafasy recites: show each word as he reaches it (as a hint), go on into the next surah at a surah's
  // end, and stop once the reciter recites again.
  _followAlafasy() {
    const p = this.playing;
    const t = p.from + (this.len - p.t0) / SAMPLE_RATE - C.PLAY_LAG;
    while (this.pos < this.words.length && this.words[this.pos].surah === p.surah) {
      const w = this.words[this.pos];
      if (this.deps.alafasy.wordStart(w.surah, w.ayah, w.wi) > t) break;
      if (w.status === null) { // after going back, words recited before stay
        w.status = 'hint';
        if (w.looked === undefined) w.looked = this.look;
      }
      this.pos++;
      this._extend();
      this.version++;
    }
    if (this._reciterBack()) this._stopAlafasy(this.len - C.BACK_FRAMES * FRAME);
    else if (t >= p.end) {
      this.playing = null;
      if (this.opts.silenceHelp !== 'surah') { this._stopAlafasy(this.len, p); return; } // ayah / 3 words / 1 word: back to waiting
      if (this.pos < this.words.length) this._playFrom(this.pos, p.voice);
      if (this.playing === null) this._stopAlafasy(this.len, p); // the Quran's end, or no audio for the next surah
    }
  }

  _reciterBack() { // the mic has been loud for the last 0.4 s, well above Alafasy's own level in it
    const p = this.playing;
    const levels = this._levels;
    const start = p.f0 + Math.floor(C.BACK_GRACE_S * 20); // he is heard in the mic from about here
    const past = levels.slice(start, levels.length - C.BACK_FRAMES);
    if (past.length < C.BACK_FRAMES) return false;
    // Alafasy's level in the mic, from his first LEAK_BLOCK only, or less if an earlier prompt measured less
    let leak = percentile(past.slice(0, C.LEAK_BLOCK), 90);
    if (this._leakSeen !== null) leak = Math.min(leak, this._leakSeen);
    if (past.length >= C.LEAK_BLOCK) this._leakSeen = leak;
    const loud = Math.max(C.QUIET_FLOOR, C.BACK_VOICE * p.voice, C.BACK_LEAK * leak);
    return levels.slice(-C.BACK_FRAMES).filter((x) => x >= loud).length >= C.BACK_LOUD;
  }

  // Alafasy stops. What the mic heard of him is silenced, up to just before `onset` (sample where the reciter's
  // voice began), so following never takes his words for the reciter's.
  _stopAlafasy(onset, p = null) {
    p = p ?? this.playing;
    this.playing = null;
    if (!p) return;
    this.version++;
    const cut = Math.max(p.t0, onset - Math.floor(0.2 * SAMPLE_RATE));
    this._buf.fill(0, p.t0, cut);
    const f1 = p.f0 + Math.floor((cut - p.t0) / FRAME);
    this._levels.splice(p.f0, f1 - p.f0); // nor does it count as the reciter's voice level
    this._levelsVersion++;
    const now = this.len;
    this.updatedAt = Math.max(p.t0, cut - SAMPLE_RATE); // following picks up from here
    this.advancedAt = this._relockAt = now;
    this._nextPromptAt = now + Math.floor(this.waitS * SAMPLE_RATE);
  }

  // The live window: WINDOW_S, or shorter when the phone is slow (a pass then takes about TARGET_PASS_S), never under MIN_WINDOW_S.
  _windowS() {
    if (!this._passRate || !this.opts.slow) return C.WINDOW_S; // device.slowPhone off: always the full window
    return Math.max(C.MIN_WINDOW_S, Math.min(C.WINDOW_S, C.TARGET_PASS_S / this._passRate));
  }

  due() { return this.len - this.updatedAt >= C.UPDATE_EVERY_S * SAMPLE_RATE; }

  // One model pass over audio (from sample `offset` of the recording), in pieces cut at quiet moments:
  // [[word, start s, end s]] with times in the whole recording.
  async _hear(asr, audio, offset, priority = 0) {
    const out = [];
    let ms = 0;
    for (const [off, piece] of quietPieces(audio, priority >= 1 ? 20 : this.pieceS)) {
      const r = await asr.hear(piece, { priority });
      ms += r.ms ?? 0;
      const t0 = (offset + off) / SAMPLE_RATE;
      for (const w of r.words) out.push([w.w, t0 + w.t0, t0 + w.t1]);
    }
    this._lastMs = ms;
    return out;
  }

  // Transcribe the recent audio (max 30 s) and lock onto the surah once sure. relock: following seems lost;
  // move only if the recent audio clearly is elsewhere.
  async findSurah(asr, { final = false, relock = false } = {}) {
    const audio = this.audio;
    if (!relock) this.updatedAt = audio.length;
    const stamp = this.advancedAt;
    let offset = Math.max(0, audio.length - 30 * SAMPLE_RATE);
    if (relock) { // only what came since the following stopped (at least 12 s)
      offset = Math.max(offset, Math.min(this.advancedAt - SAMPLE_RATE, audio.length - 12 * SAMPLE_RATE));
    }
    const window = audio.subarray(offset);
    if (window.length === 0 || peak(window) < C.SILENCE) return;
    const heardT = await this._hear(asr, window, offset, relock ? 0 : 1);
    const heard = heardT.map((h) => h[0]);
    // the model tends to invent a word for a word cut off at the end
    const found = detect((final ? heard : heard.slice(0, -1)).join(' '));
    if (!found || found.words < C.DETECT_MIN_WORDS) return;
    if (found.margin < C.DETECT_MARGIN && found.words < C.DETECT_SURE_WORDS && !final) return;
    // moving away while following needs more than finding the surah at the start, except where a surah has just ended
    if (relock && !this._atNewSurah() && (found.words < 2 * C.DETECT_MIN_WORDS || found.margin < C.DETECT_MARGIN)) return;
    let start;
    if (relock) {
      if (this.advancedAt !== stamp) return; // following moved on meanwhile: not lost after all
      start = this._relockTo(found, heardT, audio.length);
      if (start === null) return;
    } else {
      if (this.words.length) return; // found meanwhile (or a new recording began)
      // from an ayah earlier: detect() may leave out the first ayah heard when its words are in the next one too
      const count = quran.surahInfo(found.surah).ayahs;
      this._load(found.surah, Math.max(1, found.first - 1), Math.min(count, found.first + C.AUTO_AYAHS - 1));
      start = 0;
    }
    // A (garbled) ta'awwudh/basmala is left out: aligned with the text, its words pushed the real ones out of place.
    let ht = heardT;
    if (start === this._partStart(start)) {
      const w0 = this.words[start];
      const [rest] = stripOpeners(ht.map((h) => quran.normalize(h[0])), !(w0.surah === 1 && w0.ayah === 1));
      ht = ht.slice(ht.length - rest.length);
    }
    this.advancedAt = this._relockAt = audio.length;
    // catch up over what was already recited while listening; words it skips get the same second look as in live following
    this.pos = this._catchUpStart(start, ht.map((h) => quran.normalize(h[0])));
    this.follow(ht, { final: true, audioLen: audio.length, lookahead: ht.length + 4 });
    for (const w of this.words.slice(start)) if (w.status === 'missed') w.status = 'pending';
    this.version++;
  }

  // Where in the text from `start` on the heard words (normalized) begin: the first of 3 words in a row found in them.
  _catchUpStart(start, heard) {
    const seg = this.words.slice(start).map((w) => w.norm);
    const found = new Set();
    for (const [ri, hj] of pair(seg, heard)) if (ri !== null && hj !== null && similar(seg[ri], heard[hj])) found.add(start + ri);
    const sorted = [...found].sort((a, b) => a - b);
    const first = sorted.find((k) => found.has(k + 1) && found.has(k + 2));
    const k = first !== undefined ? first : (sorted.length ? sorted[0] : start);
    // a misheard first word or two: still from the start of the ayah, so they get checked
    let ayahStart = k;
    while (ayahStart > start && this.words[ayahStart - 1].surah === this.words[k].surah && this.words[ayahStart - 1].ayah === this.words[k].ayah) ayahStart--;
    return k - ayahStart <= C.SHORT_SKIP ? ayahStart : k;
  }

  // Following seemed lost and the recent audio is `found`: where to follow on from (an index; the words from there
  // may have been replaced), or null to stay.
  _relockTo(found, heardT, audioLen) {
    const here = this.words[Math.min(this.pos, this.words.length - 1)];
    const { surah: s, first, last } = found;
    if (s === here.surah && first - 1 <= here.ayah && here.ayah <= last + 1) return null; // right place; the reciter is struggling
    const part = this._partStart(Math.min(this.pos, this.words.length - 1));
    const heard = heardT.map((h) => quran.normalize(h[0]));
    if (this.opts.fixed) { // test card: never moves to another surah; only rewinds inside the card, or warns
      if (s !== here.surah) {
        if (this.stray === null || this.stray.surah !== s) { this._strays++; this.stray = { id: `${this._id}-s${this._strays}`, surah: s, ayah: first }; this.version++; }
      } else { const back = this._wentBack(heard, this.pos); if (back !== null) this._rewind(back, audioLen); }
      return null;
    }
    if (s === here.surah && last < here.ayah) {
      // went back further than follow() looks; even before what is shown: show those too
      const shownFrom = this.words[part].ayah;
      if (first < shownFrom) {
        const added = this._wordsOf(s, first, shownFrom - 1);
        this.words.splice(part, 0, ...added);
        this.pos += added.length;
        this._shown = new Set([...this._shown].map((k) => (k >= part ? k + added.length : k)));
        this.version++;
      }
      const back = this._wentBack(heard, this.pos);
      if (back !== null) this._rewind(back, audioLen);
      return null;
    }
    if (s !== here.surah && this.words.slice(0, part).some((w) => w.surah === s && w.ayah === last)) {
      const back = this._wentBack(heard, this.pos); // back into the surah recited before this one
      if (back !== null) this._rewind(back, audioLen);
      return null;
    }
    if (s === here.surah) {
      // jumped ahead in the surah, or following fell far behind: go on from there, keeping everything recited on screen
      this._showThrough(s, last);
      for (let k = this.pos; k < this.words.length; k++) if (this.words[k].surah === s && this.words[k].ayah === first) return k;
      return null;
    }
    if (found.confidence < C.SWITCH_CONFIDENCE) return null;
    const nxt = this.words.slice(part, part + 15).filter((w) => w.surah === here.surah).map((w) => w.norm);
    if (this.pos === part && pair(nxt, heard).filter(([ri, hj]) => ri !== null && hj !== null && similar(nxt[ri], heard[hj])).length >= 3) {
      return null; // it is the surah shown next after all; following will catch up
    }
    if (this.pos > part && this._confirmed()) {
      // recited on into another surah by mistake: show that, don't follow it there
      if (!this.opts.stray) return null;
      if (this.stray === null || this.stray.surah !== s) {
        this._strays++;
        this.stray = { id: `${this._id}-s${this._strays}`, surah: s, ayah: first };
        this.version++;
      }
      return null;
    }
    // another surah begun after one ended (or the surah was found wrong at first): it replaces what was shown from there
    this.words.splice(part);
    const count = quran.surahInfo(s).ayahs;
    const firstShown = Math.max(1, first - 1); // as at the start (findSurah)
    if (part === 0) this._load(s, firstShown, Math.min(count, first + C.AUTO_AYAHS - 1));
    else this._append(s, firstShown, Math.min(count, first + C.AUTO_AYAHS - 1));
    this.stray = null;
    return part;
  }

  // A surah ended and the reciter is reciting, but not on into the next surah: look for which surah it is.
  newSurahDue() {
    if (!this._atNewSurah() || this.len - this._relockAt < C.DETECT_EVERY_S * SAMPLE_RATE) return false;
    const since = (this.len - this.advancedAt) / SAMPLE_RATE;
    return this._voicedS(since) >= C.NEW_SURAH_VOICED_S;
  }

  // Surah found, but the reciter keeps reciting without the text moving on, or most recent words are red.
  lost() {
    if (this.surah === null || this.done() || this.len - this._relockAt < C.RELOCK_EVERY_S * SAMPLE_RATE) return false;
    const settled = this.words.slice(0, this.pos).map((w) => w.status).filter((s) => s !== 'hint' && s !== 'given').slice(-C.LOST_OF);
    if (settled.filter((s) => s === 'missed').length >= C.LOST_REDS) return true;
    const stalled = this.len - Math.max(this.advancedAt, this._nextPromptAt - Math.floor(this.waitS * SAMPLE_RATE));
    return stalled >= C.LOST_S * SAMPLE_RATE && !this.quietFor(C.STUCK_S) && this._voicedS(stalled / SAMPLE_RATE) >= C.LOST_S / 2;
  }

  // Enough of the surah being recited was recited right that it can't be a wrong detection.
  _confirmed() {
    if (this.opts.fixed) return true;
    const part = this._partStart(Math.min(this.pos, this.words.length - 1));
    const s = this.words[part].surah;
    return this.words.slice(part).filter((w) => w.surah === s && w.status === 'correct').length >= C.CONFIRMED_WORDS;
  }

  _voicedS(seconds) { // seconds of recitation (not silence) in the last `seconds`
    const n = Math.floor(seconds * 20);
    const recent = n > 0 ? this._levels.slice(-n) : [];
    if (!recent.length) return 0.0;
    const floor = Math.max(C.QUIET_FLOOR, C.QUIET * this._voice());
    return recent.filter((x) => x >= floor).length / 20;
  }

  pending() { const out = []; this.words.forEach((w, i) => { if (w.status === 'pending') out.push(i); }); return out; }

  // Word i was heard next to its neighbour in the text, wherever in `heard` (normalized).
  _said(i, heard) {
    const pairs = heard.slice(0, -1).map((a, k) => [a, heard[k + 1]]);
    for (const j of [i - 1, i]) { // the pair before the word, then the pair after it
      if (j >= 0 && j + 1 < this.words.length && pairs.some(([a, b]) => similar(this.words[j].norm, a) && similar(this.words[j + 1].norm, b))) return true;
    }
    return false;
  }

  // Re-hear skipped words with the model (or check them against heardT); only those it can't find become mistakes.
  async verify(asr, heardT = null) {
    let pending = this.pending();
    if (!pending.length) return;
    if (heardT !== null) { this._settle(heardT); return; }
    // from a little before the first of them (it may have waited), or the last 7 s
    let t = null;
    for (let k = pending[0]; k >= 0; k--) if (this.words[k].t) { t = this.words[k].t[0]; break; }
    const audio = this.audio;
    let offset = audio.length - Math.floor(C.VERIFY_WINDOW_S * SAMPLE_RATE);
    if (t !== null) offset = Math.min(offset, Math.floor((t - 1.5) * SAMPLE_RATE));
    offset = Math.max(0, offset, audio.length - Math.floor(C.VERIFY_MAX_S * SAMPLE_RATE));
    const heardWords = await this._hear(asr, audio.subarray(offset), offset, 0);
    const heard = heardWords.map((h) => quran.normalize(h[0]));
    const unsure = [];
    for (const i of this.pending()) {
      if (this._said(i, heard)) this.words[i].status = 'correct'; else unsure.push(i);
    }
    this.version++;
    if (!unsure.length) return;
    this._retime(heardWords, unsure);
    this._settle(heardWords);
  }

  _settle(heardT) { // pending words heard in heardT become said; the others mistakes
    const heard = heardT.map((h) => quran.normalize(h[0]));
    for (const i of this.pending()) {
      if (this._said(i, heard)) this.words[i].status = 'correct'; else this._markMissed(i, heardT);
    }
    this.version++;
  }

  _ayahWords(i) { // indices [lo, hi) of the shown words of word i's ayah
    const { surah, ayah } = this.words[i];
    const same = (k) => this.words[k].surah === surah && this.words[k].ayah === ayah;
    let lo = i;
    let hi = i;
    while (lo > 0 && same(lo - 1)) lo--;
    while (hi < this.words.length && same(hi)) hi++;
    return [lo, hi];
  }

  // The first recently finished ayah not yet re-heard for added words, as [lo, hi]: all its words judged and the
  // reciter AUDIT_AFTER words past it. final: the recording has stopped; one of the last FINAL_AUDITS ayahs.
  auditDue(final = false) {
    if (!this.opts.added) return null; // detect.added off: no added-word audit (saves the phone's time too)
    const due = (lo, hi) => {
      const w = this.words[lo];
      if (this._audited.has(`${w.surah}:${w.ayah}`)) return false;
      for (let k = lo; k < hi; k++) if (!['correct', 'missed', 'hint', 'given'].includes(this.words[k].status)) return false;
      return true;
    };
    if (final) {
      let i = this.pos;
      for (let n = 0; n < C.FINAL_AUDITS; n++) {
        if (i <= 0) break;
        const [lo, hi] = this._ayahWords(i - 1);
        if (due(lo, hi)) return [lo, hi];
        i = lo;
      }
      return null;
    }
    let i = Math.max(0, this.pos - C.AUDIT_BACK);
    while (i < this.pos) {
      const [lo, hi] = this._ayahWords(i);
      if (hi + C.AUDIT_AFTER > this.pos) return null;
      if (due(lo, hi)) return [lo, hi];
      i = hi;
    }
    return null;
  }

  // Re-hear a finished ayah for words the reciter added: said in between the text's words, and neither the text
  // nor going back over it. Each such passage turns the word it was said before red, with what was said.
  async audit(asr, { final = false } = {}) {
    const due = this.auditDue(final);
    if (due === null) return;
    const w0 = this.words[due[0]];
    this._audited.add(`${w0.surah}:${w0.ayah}`);
    const job = this._auditJob(due);
    if (job === null) return;
    const heardT = await this._hear(asr, this.audio.subarray(job.start, job.end), job.start, 0);
    const found = await this._addedFound(asr, job, heardT);
    if (found.length) this._markAdded(heardT, found);
  }

  _auditJob([lo, hi]) {
    const pLo = lo > 0 ? this._ayahWords(lo - 1)[0] : lo;
    // the anchor: the last words heard before the ayah (further back if those of the ayah before were never heard)
    const before = [];
    for (let k = lo - 1; k > Math.max(-1, lo - 1 - C.BACK_WORDS) && before.length < C.AUDIT_ANCHOR; k--) if (this.words[k].t) before.push(k);
    const aLo = before.length ? Math.min(...before) : pLo;
    const firsts = [];
    for (const k of [...before, ...range(lo, Math.min(hi, lo + C.AUDIT_ANCHOR))]) {
      if (this.words[k].t) firsts.push(this.words[k].tFirst ?? this.words[k].t[0]);
    }
    if (!firsts.length) return null;
    if (!before.length) firsts.push(C.AUDIT_PAD_S); // from the start of the recording (at most AUDIT_MAX_S)
    // up to when the words right after it were last heard, not to now
    let end = this.len;
    const past = [];
    for (let k = hi; k < Math.min(hi + C.AUDIT_AFTER + 1, this.words.length); k++) if (this.words[k].t) past.push(this.words[k].t[1]);
    if (past.length) end = Math.min(end, Math.floor((Math.max(...past) + C.AUDIT_TAIL_S) * SAMPLE_RATE));
    const start = Math.max(0, Math.floor((Math.min(...firsts) - C.AUDIT_PAD_S) * SAMPLE_RATE), end - Math.floor(C.AUDIT_MAX_S * SAMPLE_RATE));
    if (end - start < SAMPLE_RATE) return null;
    const view = [...this.words]; // the dicts: the list may change meanwhile
    return { start, end, view, own: view.slice(lo, Math.min(hi + 1, view.length)),
      seg: [aLo, Math.min(this.pos + C.AUDIT_AFTER, view.length)],
      voice: this._levels.length ? this._voice() : 0.0, addedAt: [...this._addedAt] };
  }

  // The added passages to mark (addedPassages), as [[the word it was said before, first and last heard index]].
  async _addedFound(asr, job, heardT) {
    const { view } = job;
    const text = view.map((w) => w.norm);
    const heard = heardT.map((h) => quran.normalize(h[0]));
    const [passages, kind] = addedPassages(text, view.map((w) => w.surah), job.seg[0], job.seg[1], heard);
    const found = [];
    for (const [place, idx] of passages) {
      if (place >= view.length || !job.own.some((w) => w === view[place])) continue; // left to the audit of its own ayah
      if (idx.some((j) => job.addedAt.some((t) => Math.abs(heardT[j][1] - t) < 0.5))
        || job.addedAt.some((t) => { const d = heardT[idx[0]][1] - t; return d > 0 && d <= 2.0; })) continue; // found before
      // Only over the reciter's voice, and with a word aligned with no text word
      const maybe = idx.filter((j) => mayBeAddedAt(heard[j], text, place) && this._voiced(heardT[j][1], heardT[j][2], job.voice));
      if (!maybe.some((j) => kind.get(j) === 'ins')) continue;
      // heard again in a short window of its own: the model's mishearings and inventions change with the window
      let again = false;
      for (const j of maybe.slice(0, C.ADDED_TRIES)) if (await this._heardAgain(asr, heard[j], heardT[j][1], heardT[j][2])) { again = true; break; }
      if (again) found.push([view[place], idx[0], idx.at(-1)]);
    }
    return found;
  }

  // Turn the words added passages were said before red, each with what was said (and its clip), unless the reciter
  // marked the same reading there as right before.
  _markAdded(heardT, found) {
    for (const [w, first, last] of found) {
      for (let j = first; j <= last; j++) this._addedAt.push(heardT[j][1]);
      const k = this.words.indexOf(w);
      if (k < 0) continue; // gone from the view (another surah was found)
      const context = heardT[Math.max(0, first - C.CLIP_CONTEXT_WORDS)][1];
      this._explain(k, heardT, [context, heardT[first][1], heardT[last][2]]);
      if (!this.deps.feedback.sameAsAccepted(w.surah, w.ayah, w.wi, w.heard, w.clip)) {
        w.status = 'missed';
        w.added = true;
        this._maybeBlock(k);
      }
    }
    this.version++;
  }

  async _heardAgain(asr, norm, startS, endS) { // the word (normalized) is heard again from AUDIT_AGAIN_S around its time
    const a = Math.max(0, Math.floor((startS - C.AUDIT_AGAIN_S) * SAMPLE_RATE));
    const r = await asr.hear(this.audio.subarray(a, Math.floor((endS + C.AUDIT_AGAIN_S) * SAMPLE_RATE)), { priority: 0 });
    return r.words.some((h) => quran.sameWord(norm, quran.normalize(h.w)));
  }

  // A word was really said between these times: loud somewhere, and not silent most of the time.
  _voiced(startS, endS, voice) {
    if (endS - startS > C.ADDED_WORD_MAX_S) return false;
    const part0 = this.audio.subarray(Math.floor(startS * SAMPLE_RATE), Math.floor(endS * SAMPLE_RATE) + FRAME);
    const n = Math.floor(part0.length / FRAME);
    if (!n) return false;
    let mx = 0;
    let voiced = 0;
    const floor = Math.max(C.QUIET_FLOOR, C.QUIET * voice);
    for (let f = 0; f < n; f++) {
      let s = 0;
      for (let i = f * FRAME; i < (f + 1) * FRAME; i++) s += part0[i] * part0[i];
      const lvl = Math.sqrt(s / FRAME);
      if (lvl > mx) mx = lvl;
      if (lvl >= floor) voiced++;
    }
    return mx >= Math.max(C.QUIET_FLOOR, C.AUDIT_VOICE * voice) && voiced / n >= C.AUDIT_VOICED;
  }

  // Exact times (from heardT) for the words near `around`.
  _retime(heardT, around) {
    const lo = Math.max(0, Math.min(...around) - 12);
    const hi = Math.min(this.words.length, Math.max(...around) + 12);
    const seg = this.words.slice(lo, hi).map((w) => w.norm);
    const heard = heardT.map((h) => quran.normalize(h[0]));
    for (const [ri, hj] of pair(seg, heard)) {
      if (ri !== null && hj !== null && similar(seg[ri], heard[hj])) this.words[lo + ri].t = [heardT[hj][1], heardT[hj][2]];
    }
  }

  // Word i wasn't heard next to its neighbours: red, unless what was heard in its place is that word after all, or it
  // was recited the same way as a time the reciter marked as right.
  _markMissed(i, heardT) {
    this._explain(i, heardT); // before turning red, so the view has its details
    const w = this.words[i];
    const heard = w.heard.split(/\s+/).filter(Boolean).map(quran.normalize);
    const ok = heard.some((h) => similar(w.norm, h)) || quran.within(w.norm, heard) // one word heard split in two
      || JOINED_PARTICLES.has(w.norm) // يَا أَيُّهَا is usually written as one word by the model
      || (heard.length ? !this.opts.changed : !this.opts.skipped) // detect.changed / detect.skipped off: not red
      || this.deps.feedback.sameAsAccepted(w.surah, w.ayah, w.wi, w.heard, w.clip);
    w.status = ok ? 'correct' : 'missed';
    if (!ok) this._maybeBlock(i);
  }

  // detect.noAdvance (spec C3 §6.5): a word before the reciter's place turned red: the words after it go back to hidden and
  // following waits for that word to be recited again.
  _maybeBlock(k) {
    if (!this.opts.noAdvance || this._block !== null || !this._running || k >= this.pos) return;
    this._block = k;
    for (let i = k + 1; i < this.pos; i++) { const st = this.words[i].status; if (st === 'correct' || st === 'pending') this.words[i].status = null; }
    this.pos = k;
    this.version++;
  }

  // For a word that turned red: what the model heard in its place, and clips of that part of the recording.
  _explain(i, heardT, gap = null) {
    const w = this.words[i];
    let before;
    let after;
    let context;
    if (gap !== null) {
      [context, before, after] = gap;
      after = Math.min(after, before + C.ADDED_CLIP_S);
    } else {
      const timedBefore = [];
      for (let k = i - 1; k >= 0 && timedBefore.length < C.CLIP_CONTEXT_WORDS; k--) if (this.words[k].t) timedBefore.push(k);
      before = timedBefore.length ? this.words[timedBefore[0]].t[1] : null;
      after = null;
      for (let k = i + 1; k < this.words.length; k++) if (this.words[k].t) { after = this.words[k].t[0]; break; }
      const endOfAudio = this.len / SAMPLE_RATE;
      if (before === null) before = Math.max(0.0, (after !== null ? after : endOfAudio) - 2.0);
      if (after === null || after <= before) after = Math.min(endOfAudio, before + 2.0);
      after = Math.min(after, before + C.MAX_CLIP_S);
      context = timedBefore.length ? this.words[timedBefore.at(-1)].t[0] : before;
    }
    context = Math.min(Math.max(context, before - 4.0), before); // after going back, words before may carry later times
    w.heard = heardT.filter(([, s, e]) => before - 0.15 <= (s + e) / 2 && (s + e) / 2 <= after + 0.15).map((h) => h[0]).join(' ');
    w.heardPre = heardT.filter(([, s, e]) => context - 0.15 <= (s + e) / 2 && (s + e) / 2 < before - 0.15).map((h) => h[0]).join(' ');
    // the spans (s in the recording) let a mark be reviewed later
    w.span = [round2(Math.max(0.0, before - 0.25)), round2(after + 0.25)];
    w.ctxSpan = [round2(Math.max(0.0, context - 0.2)), w.span[1]];
    const cut = ([a, b]) => this.audio.slice(Math.floor(a * SAMPLE_RATE), Math.floor(b * SAMPLE_RATE));
    w.clip = cut(w.span);
    w.clipCtx = cut(w.ctxSpan);
  }

  // Hear the latest WINDOW_S (back to where the last pass ended, if a pass was slow). final: recording stopped; hear
  // everything since the last progress (max 30 s).
  async update(asr, { final = false } = {}) {
    const audio = this.audio;
    const last = this.updatedAt;
    this.updatedAt = audio.length;
    let start = Math.min(audio.length - Math.floor(this._windowS() * SAMPLE_RATE), last - SAMPLE_RATE);
    start = Math.max(start, audio.length - Math.floor(C.MAX_WINDOW_S * SAMPLE_RATE));
    if (final) start = Math.max(audio.length - 30 * SAMPLE_RATE, Math.min(start, this.advancedAt - 2 * SAMPLE_RATE));
    start = Math.max(0, start);
    const window = audio.subarray(start);
    if (window.length === 0 || peak(window) < C.SILENCE) return;
    const heardT = await this._hear(asr, window, start, final ? 0 : 1);
    if (!final && this._lastMs > 0) this._passRate = this._lastMs / 1000 / (window.length / SAMPLE_RATE); // s of model time per s of audio
    this.follow(heardT, { final, audioLen: audio.length });
  }

  // Move forward over the expected words found in what was just heard. heardT: [[word, start s, end s]], times in
  // the whole recording.
  follow(heardT, { final = false, audioLen = null, lookahead = C.LOOKAHEAD } = {}) {
    if (!heardT.length || this.done()) return;
    const heard = heardT.map((h) => quran.normalize(h[0]));
    // the window still holds some words confirmed earlier, so look a bit back too
    const lo = Math.max(0, this.pos - heard.length);
    // ahead: `lookahead` words not yet recited (after going back, the ones recited before don't count)
    let hi = this.pos;
    let ahead = 0;
    while (hi < this.words.length && ahead < lookahead) {
      const st = this.words[hi].status;
      ahead += st === null || st === 'pending' ? 1 : 0;
      hi++;
    }
    const seg = this.words.slice(lo, hi).map((w) => w.norm);
    const matched = new Set();
    for (const [ri, hj] of pair(seg, heard)) {
      if (ri !== null && hj !== null && similar(seg[ri], heard[hj])) {
        matched.add(lo + ri);
        const w = this.words[lo + ri];
        w.t = [heardT[hj][1], heardT[hj][2]]; // where in the recording it was said
        if (w.tFirst === undefined) w.tFirst = heardT[hj][1]; // ...first (audit)
      }
    }
    if (this._block !== null) { // blocked on a red word: it must be recited again before anything else moves
      if (!matched.has(this._block)) return;
      const b = this.words[this._block];
      b.slip = true; b.added = false; b.status = 'pending';
      this._block = null;
    }
    // Runs of matched words: one starting at the next word is always taken. One further on (skipping words) needs 2-3
    // in a row, so a stray common word or a ta'awwudh/basmala echo can't jump ahead.
    let newPos = this.pos;
    let i = this.pos;
    while (i < hi) {
      if (!matched.has(i)) { i++; continue; }
      let end = i;
      while (matched.has(end + 1)) end++;
      // after going back, skipping words that were already recited costs nothing
      const run = end - i + 1;
      const gap = i - newPos;
      let skip = 0;
      for (let k = newPos; k < i; k++) { const st = this.words[k].status; skip += st === null || st === 'pending' ? 1 : 0; }
      if (gap === 0 || run >= C.LONG_SKIP_RUN || (run >= 2 && (skip <= C.SHORT_SKIP || (final && skip <= C.FINAL_SKIP)))) newPos = end + 1;
      i = end + 1;
    }
    if (newPos === this.pos && lookahead === C.LOOKAHEAD) {
      const back = this._wentBack(heard);
      if (back !== null) { this._rewind(back, audioLen ?? this.len); this.version++; return; }
    }
    // Skipped words wait as "pending" until verify() has the model re-hear them; a live pass often just misses a word.
    for (let k = this.pos; k < newPos; k++) {
      const w = this.words[k];
      if (w.looked === undefined) w.looked = this.look;
      if (matched.has(k) && !w.added) w.status = 'correct'; // audit's marks stay red
      else if (w.status === 'correct' || w.status === 'hint' || w.status === 'missed') { /* recited before the reciter went back */ }
      else if (final) this._markMissed(k, heardT);
      else w.status = 'pending';
    }
    // a skipped word may be heard clearly in a later, overlapping window
    for (const k of matched) {
      const w = this.words[k];
      if (k < this.pos && (w.status === 'pending' || w.status === 'missed') && !w.added) w.status = 'correct';
    }
    if (newPos > this.pos) {
      this.advancedAt = audioLen ?? this.len;
      this.stray = null; // back in this surah
    }
    this.pos = newPos;
    this._extend();
    this.version++;
  }

  // The last REWIND_RUN heard words (normalized) are a passage at least REWIND_MIN words before the current place: the
  // reciter went back to recite it again. Returns the index of that passage's first word, or null.
  _wentBack(heard, back = C.BACK_WORDS) {
    const n = C.REWIND_RUN;
    for (const drop of [0, 1]) { // the model may invent a last word for one cut off at the window's end
      const tail = heard.slice(Math.max(0, heard.length - drop - n), heard.length - drop);
      if (tail.length < n) continue;
      // from a little past the current place: the reciter may be a word or two ahead of the view
      for (let k = Math.min(this.pos + n, this.words.length - n); k >= Math.max(0, this.pos - back); k--) {
        let all = true;
        for (let m = 0; m < n; m++) if (!similar(this.words[k + m].norm, tail[m])) { all = false; break; }
        if (all) {
          if (k + n > this.pos - C.REWIND_MIN) return null;
          const a = this.words[k + n - 1];
          const b = this.words[k + n];
          return a.surah !== b.surah || a.ayah !== b.ayah ? null : k; // a passage that ends its ayah doesn't count
        }
      }
    }
    return null;
  }

  // Follow on from the passage at word k that the reciter went back to.
  _rewind(k, audioLen) {
    for (const w of this.words.slice(k, this.pos)) if (w.status === 'missed' || w.status === 'hint') w.slip = true;
    for (let i = k; i < k + C.REWIND_RUN; i++) if (!this.words[i].added && this.words[i].status !== 'given') this.words[i].status = 'correct';
    this.pos = k + C.REWIND_RUN;
    this.advancedAt = audioLen;
    this.stray = null;
    this.version++;
  }

  // The reciter says red word i was recited right: show it as said, and remember the mishearing. false if i isn't red.
  accept(i) { return this.remove(i); }

  // Spec C3 §6.1: the reciter removes a red word (restorable). detect.teachOnRemove: the reading is remembered too.
  remove(i) {
    if (!(i >= 0 && i < this.words.length) || this.words[i].status !== 'missed') return false;
    const w = this.words[i];
    const taught = this.opts.teach;
    if (taught) this.deps.feedback.add(w.surah, w.ayah, w.wi, w.word, w.heard ?? '', w.clip ?? null);
    w.removed = { added: !!w.added, slip: !!w.slip, taught, heard: w.heard ?? '' };
    w.status = 'correct';
    w.slip = false;
    w.added = false;
    if (this._block === i) { this._block = null; this.pos = i + 1; }
    this.version++;
    return true;
  }

  restore(i) { // puts a removed mistake back (and takes back what was taught)
    const w = this.words[i];
    if (!w?.removed) return false;
    if (w.removed.taught) this.deps.feedback.undo?.(w.surah, w.ayah, w.wi, w.removed.heard);
    w.status = 'missed';
    w.added = w.removed.added;
    w.slip = w.removed.slip;
    delete w.removed;
    this.version++;
    return true;
  }

  peekRest() { // the rest of the ayah (from the next word) as hints
    if (this.surah === null || this.done()) return;
    const w0 = this.words[this._block ?? this.pos];
    while (!this.done() && this.words[this._block ?? this.pos].surah === w0.surah && this.words[this._block ?? this.pos].ayah === w0.ayah) this.hint();
  }

  hint() { // reveal the next word without reciting it
    if (this._block !== null) { // at a block the hint shows the red word itself and ends the block
      const w = this.words[this._block];
      w.status = 'hint'; w.added = false;
      this.pos = this._block + 1;
      this._block = null;
      this.version++;
      return;
    }
    if (this.surah !== null && !this.done()) {
      if (this.words[this.pos].status === null) {
        this.words[this.pos].status = 'hint';
        if (this.words[this.pos].looked === undefined) this.words[this.pos].looked = this.look;
      }
      this.pos++;
      this._extend();
      this.version++;
    }
  }

  done() { return this.words.length > 0 && this.pos >= this.words.length; }

  // --- the view ---

  // Word indices shown as one word: a word our text writes apart but the Indo-Pak text joins to the next goes with it.
  units() {
    const units = [];
    let cur = [];
    this.words.forEach((w, k) => {
      cur.push(k);
      const nxt = this.words[k + 1];
      if (w.show || !nxt || nxt.surah !== w.surah || nxt.ayah !== w.ayah) { units.push(cur); cur = []; }
    });
    return units;
  }

  _unitText(u) { return this.words[u.at(-1)].show || u.map((k) => this.words[k].word).join(' '); }

  _neighbours(unitK, units, before, after) { // shown text of up to `before` words before and `after` after, in its surah
    const s = this.words[units[unitK][0]].surah;
    const pre = units.slice(Math.max(0, unitK - before), unitK).filter((u) => this.words[u[0]].surah === s).map((u) => this._unitText(u));
    const post = units.slice(unitK + 1, unitK + 1 + after).filter((u) => this.words[u[0]].surah === s).map((u) => this._unitText(u));
    return [pre.join(' '), post.join(' ')];
  }

  // Everything the page draws, as plain data. `fresh` marks words that became visible since the last view() call.
  view() {
    if (this.surah === null) return { waiting: true, paused: this.paused, running: this._running, version: this.version };
    const units = this.units();
    const out = [];
    const shown = new Set();
    let fresh = 0;
    units.forEach((unit, u) => {
      const first = this.words[unit[0]];
      const last = this.words[unit.at(-1)];
      const title = unit[0] === 0 || this.words[unit[0] - 1].surah !== first.surah ? { surah: first.surah, ayah: first.ayah } : null;
      const statuses = unit.map((k) => this.words[k].status);
      const status = statuses.includes(null) ? null : (UNIT_ORDER.find((s) => statuses.includes(s)) ?? 'correct');
      const keys = unit.map((k) => `${this.words[k].surah}:${this.words[k].ayah}:${this.words[k].wi}`);
      const weak = Math.max(0, ...keys.map((key) => this.weak.get(key) ?? 0));
      const item = { unit, text: this._unitText(unit), status, weak, title, ayahEnd: null, here: unit.includes(this.pos), marked: false };
      if (weak && status !== 'missed') {
        const [pre, post] = this._neighbours(u, units, 2, 1);
        item.mark = { surah: first.surah, ayah: first.ayah, wi: first.wi, word: item.text, pre, post, info: keys.map((key) => this.weakInfo.get(key)).find((x) => x !== undefined) ?? null };
      }
      if (status !== null) {
        shown.add(unit.at(-1));
        if (!this._shown.has(unit.at(-1))) item.fresh = fresh++;
        if (status === 'missed') {
          const k = unit.find((x) => this.words[x].status === 'missed');
          const w = this.words[k];
          const [pre, post] = this._neighbours(u, units, 2, 1);
          item.error = { k, word: item.text, pre, post, heard: w.heard ?? '', heardPre: w.heardPre ?? '', clip: w.clipCtx ?? w.clip ?? null,
            added: !!w.added, alafasy: this.deps.alafasy.contextAudio(w.surah, w.ayah, w.wi, this.opts.ctxBefore, this.opts.ctxAfter) };
        }
      }
      const nxt = this.words[unit.at(-1) + 1];
      if (!nxt || nxt.surah !== last.surah || nxt.ayah !== last.ayah) item.ayahEnd = { surah: last.surah, ayah: last.ayah };
      out.push(item);
    });
    this._shown = shown;
    const now = this.words[Math.min(this.pos, this.words.length - 1)];
    const info = quran.surahInfo(now.surah);
    if (this._block !== null) out.forEach((it) => { if (it.unit.includes(this._block)) it.block = true; });
    const count = (st) => this.words.filter((w) => w.status === st).length;
    return {
      waiting: false, items: out, pos: this.pos, running: this._running, paused: this.paused, auto: this.auto, version: this.version,
      head: { surah: now.surah, english: info.english, arabic: info.name, ayah: now.ayah, ayahs: info.ayahs, said: count('correct'), missed: count('missed'), hints: count('hint') },
      errors: count('missed'), block: this._block !== null, prompt: this.prompt, playing: !!this.playing,
      stray: this.stray ? { id: this.stray.id, surah: this.stray.surah, english: quran.surahInfo(this.stray.surah).english, ayah: this.stray.ayah, current: info.english } : null,
    };
  }
}

function peak(a) { let m = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; }
function range(a, b) { const r = []; for (let i = a; i < b; i++) r.push(i); return r; }
