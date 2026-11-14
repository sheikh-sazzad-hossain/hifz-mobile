// Words the reciter marked "I recited this right; the model misheard": a port of feedback.py. A later word at the
// same place that would turn red counts as said only when it was recited THE SAME WAY as an accepted time: the model
// heard the same thing there, and the audio sounds like the accepted clip (MFCC + DTW distance ≤ SAME_AUDIO).
//   data = { places: { "surah:ayah:wi": [{ heard, clip: name | null }] }, log: [...] }   (accepted.json)
//   clips are Float32Arrays at 16 kHz, kept by name through getClip / putClip (IndexedDB in the page).
import * as quran from './quran.js';
import { SequenceMatcher } from './difflib.js';
import { audioDistance } from './mfcc.js';
import { isoLocal } from './bn.js';

export const SAME_AUDIO = 0.6; // DTW distance of MFCCs: the same place recited again is 0.43-0.63 (median 0.53); other words 0.64+
export const SAME_HEARD = 0.75; // letter-group similarity of what was heard, to count as the same mishearing

const place = (s, a, wi) => `${s}:${a}:${wi}`;
const pad = (n, w) => String(n).padStart(w, '0');

function skeletonOf(text) {
  return text.split(/\s+/).filter((w) => w && quran.normalize(w)).map((w) => quran.skeleton(quran.normalize(w))).join(' ');
}

export function sameHeard(a0, b0, limit = SAME_HEARD) {
  const a = skeletonOf(a0);
  const b = skeletonOf(b0);
  return a === b || !!(a && b && new SequenceMatcher(a, b).ratio() >= limit);
}

export function createFeedback({ data = {}, getClip = () => undefined, putClip = () => {}, persist = () => {}, now = () => new Date(), opts = () => ({}) } = {}) {
  data.places ??= {};
  data.log ??= [];
  return {
    data,
    // Remember that `word` at surah:ayah, word index wi, was recited right although the model heard `heard`.
    add(surah, ayah, wi, word, heard, clip = null) {
      let kept = null;
      const d = now();
      if (clip && clip.length) {
        kept = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}_${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}_${pad(surah, 3)}_${pad(ayah, 3)}_${pad(wi, 2)}.wav`;
        putClip(kept, clip);
      }
      const key = place(surah, ayah, wi);
      (data.places[key] ??= []).push({ heard, clip: kept });
      data.log.push({ time: isoLocal(d).replace('T', ' '), place: key, word, heard });
      persist('accepted');
    },
    // Take back the last accepted reading of this place (the reciter restored a mistake they had removed).
    undo(surah, ayah, wi, heard) {
      const key = place(surah, ayah, wi);
      const list = data.places[key] ?? [];
      const i = list.map((x) => x.heard).lastIndexOf(heard);
      if (i < 0) return false;
      list.splice(i, 1);
      if (!list.length) delete data.places[key];
      for (let j = data.log.length - 1; j >= 0; j--) if (data.log[j].place === key && data.log[j].heard === heard) { data.log.splice(j, 1); break; }
      persist('accepted');
      return true;
    },
    // This word at this place, heard as `heard`, sounding like `clip`, matches a time the reciter said it was right.
    sameAsAccepted(surah, ayah, wi, heard, clip) {
      const accepted = data.places[place(surah, ayah, wi)];
      if (!accepted || !clip || !clip.length) return false;
      for (const a of accepted) {
        if (!a.clip || !sameHeard(heard, a.heard, opts().sameHeard ?? SAME_HEARD)) continue;
        const old = getClip(a.clip);
        if (!old) continue;
        if (Math.min(clip.length, old.length) > 400 && audioDistance(clip, old) <= (opts().sameAudio ?? SAME_AUDIO)) return true;
      }
      return false;
    },
    count: () => data.log.length,
  };
}
