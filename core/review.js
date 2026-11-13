// Clearing a red mark the reciter says was wrong, and teaching that reading as right: a port of review.py.
// A mark remembers where in the session's saved recording the word went wrong and what the model heard there.
// Clearing hands that clip and mishearing to feedback (as the popup's "I recited it right" button does).
// Recordings are Float32Arrays at 16 kHz given by getRecording(name); marks kept before places were stored are found
// in their recording first (indexRecording: the model on the whole recording, lined up with the text).
import * as quran from './quran.js';
import { pair, quietPieces } from './pair.js';
import { pyRound } from './bn.js';

const SR = 16000;

export function createReview({ history, feedback, getRecording, persist = () => {}, pieceS = 20 }) {
  // Where each word of the surah's ayahs (min..max of `ayahs`) was recited in recording `rec`, and what was heard
  // there: "surah:ayah:index" → { heard, span, ctx } (times in s), kept in history.data.index.
  async function indexRecording(asr, rec, surah, ayahs) {
    const data = (history.data.index[rec] ??= {});
    if ((data._surahs ?? []).includes(surah)) return data;
    const audio = getRecording(rec);
    if (!audio) return data;
    const heardT = [];
    for (const [off, piece] of quietPieces(audio, pieceS)) {
      const r = await asr.hear(piece, { priority: 0 });
      for (const w of r.words) heardT.push([w.w, off / SR + w.t0, off / SR + w.t1]);
    }
    const lo = Math.min(...ayahs);
    const hi = Math.max(...ayahs);
    const words = [];
    const norms = [];
    for (const [a, ws] of quran.ayahs(surah, lo, hi)) ws.forEach((w, k) => { words.push([a, k]); norms.push(quran.normalize(w)); });
    const heard = heardT.map((h) => quran.normalize(h[0]));
    const times = new Map();
    for (const [ri, hj] of pair(norms, heard)) if (ri !== null && hj !== null && quran.similar(norms[ri], heard[hj])) times.set(ri, [heardT[hj][1], heardT[hj][2]]);
    const end = audio.length / SR;
    words.forEach(([a, k], i) => {
      const prev = [];
      for (let j = i - 1; j >= 0 && prev.length < 2; j--) if (times.has(j)) prev.push(j);
      let before = prev.length ? times.get(prev[0])[1] : null;
      let after = null;
      for (let j = i + 1; j < words.length; j++) if (times.has(j)) { after = times.get(j)[0]; break; }
      if (times.has(i)) [before, after] = times.get(i); // heard: its own time
      if (before === null) before = Math.max(0.0, (after !== null ? after : end) - 2.0);
      if (after === null || after <= before) after = Math.min(end, before + 2.0);
      const context = prev.length ? times.get(prev.at(-1))[0] : before;
      data[`${surah}:${a}:${k}`] = {
        heard: heardT.filter(([, s, e]) => before - 0.15 <= (s + e) / 2 && (s + e) / 2 <= after + 0.15).map((h) => h[0]).join(' '),
        span: [pyRound(Math.max(0.0, before - 0.25), 2), pyRound(after + 0.25, 2)],
        ctx: [pyRound(Math.max(0.0, Math.min(context, before) - 0.2), 2), pyRound(after + 0.25, 2)],
      };
    });
    data._surahs = [...(data._surahs ?? []), surah];
    persist('index');
    return data;
  }

  const clip = (rec, [a, b]) => getRecording(rec)?.slice(Math.floor(a * SR), Math.floor(b * SR));

  // history.placeOf, finding the word in its recording first if it is an older mark.
  async function place(asr, surah, ayah, wi, r) {
    let found = history.placeOf(surah, ayah, wi, r);
    if (found === null && asr) {
      const session = history.recordingOf(r, surah);
      if (session && getRecording(session[0])) {
        await indexRecording(asr, session[0], surah, session[1]);
        found = history.placeOf(surah, ayah, wi, r);
      }
    }
    return found;
  }

  // The reciter says this word's mark is wrong: clear it, and teach feedback each recorded mistake there (not a time
  // they got stuck: nothing was misheard then). Returns how many readings were taught, or null if the word had no mark.
  async function clear(asr, surah, ayah, wi) {
    const rec = history.weakRecords(surah).find(([a, k]) => a === ayah && k === wi);
    if (!rec) return null;
    const r = rec[2];
    let events = (r.events ?? []).filter((e) => e.rec && e.span);
    if (!events.length) { const p = await place(asr, surah, ayah, wi, r); events = p ? [p] : []; }
    const word = quran.ayahs(surah, ayah, ayah)[0][1][wi];
    let taught = 0;
    for (const e of events) {
      if (e.kind === 'hint' || !getRecording(e.rec)) continue;
      feedback.add(surah, ayah, wi, word, e.heard ?? '', clip(e.rec, e.span));
      taught++;
    }
    history.forget(surah, ayah, wi);
    return taught;
  }

  return { indexRecording, place, clear };
}
