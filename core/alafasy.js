// Mishary Rashid Alafasy's recitation of single words / spans, for "how it should sound" and the silence prompt:
// a port of alafasy.py. data/alafasy_words.json (Quran.com's word timings, one mp3 per surah) is given by setData().
// All times in seconds in the surah mp3. Playing the audio is engine/audio-out.js + app/media.js.
import * as quran from './quran.js';

let data = {};
export function setData(json) { data = json; }

const ourCount = (surah, ayah) => quran.ayahs(surah, ayah, ayah)[0][1].length;

// [start, end] ms of our index-th word of the ayah; the whole ayah where Quran.com's words can't be lined up with ours
function wordSpan(surah, ayah, index) {
  const a = data[String(surah)].ayahs[String(ayah)];
  const position = quran.qdcPositions(surah, ayah, a.words.length);
  return position === null ? [a.from, a.to] : a.words[position[index]];
}

// [mp3 url, start s, end s] from the first-th word to the last-th (null: the end of the ayah; toSurahEnd: the end of the surah)
export function spanAudio(surah, ayah, first, last = null, toSurahEnd = false) {
  const s = data[String(surah)];
  if (!s || !s.ayahs[String(ayah)]) return null;
  const a = s.ayahs[String(ayah)];
  const position = quran.qdcPositions(surah, ayah, a.words.length);
  let start;
  let end;
  if (position === null) { start = a.from; end = a.to; } else {
    start = a.words[position[first]][0];
    end = last === null ? a.to : a.words[position[last]][1];
  }
  if (toSurahEnd) end = Math.max(...Object.values(s.ayahs).map((t) => t.to));
  return [s.url, start / 1000, end / 1000];
}

export const wordAudio = (surah, ayah, index) => spanAudio(surah, ayah, index, index);

// Like wordAudio, but from `before` words earlier to `after` words later (across ayah ends, within the surah).
export function contextAudio(surah, ayah, index, before = 2, after = 1) {
  const s = data[String(surah)];
  if (!s || !s.ayahs[String(ayah)]) return null;
  let a = ayah;
  let k = index - before;
  while (k < 0 && a > 1) { a--; k += ourCount(surah, a); }
  let a2 = ayah;
  let k2 = index + after;
  const count = quran.surahInfo(surah).ayahs;
  while (k2 >= ourCount(surah, a2) && a2 < count) { k2 -= ourCount(surah, a2); a2++; }
  if (!s.ayahs[String(a)] || !s.ayahs[String(a2)]) return wordAudio(surah, ayah, index);
  const start = wordSpan(surah, a, Math.max(k, 0))[0];
  const end = wordSpan(surah, a2, Math.min(k2, ourCount(surah, a2) - 1))[1];
  return [s.url, start / 1000, end / 1000];
}

// When (s, in the surah mp3) Alafasy begins our index-th word of the ayah; 0 if no timings.
export function wordStart(surah, ayah, index) {
  const s = data[String(surah)];
  if (!s || !s.ayahs[String(ayah)]) return 0.0;
  return wordSpan(surah, ayah, index)[0] / 1000;
}

// The follower's `deps.alafasy`
// (the follower asks for "from this word to the end of the surah": spanAudio(surah, ayah, wi, toEnd))
export const follower = { spanAudio: (surah, ayah, wi, toEnd = false) => spanAudio(surah, ayah, wi, null, toEnd), wordStart, contextAudio };
