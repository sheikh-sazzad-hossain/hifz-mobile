// Indo-Pak script for showing the text (recognition still works on the simple text): a port of indopak.py.
// data/indopak_words.json (Quran.com's text_indopak_nastaleeq, word by word) is given by setData().
import * as quran from './quran.js';

let data = {};
const cache = new Map();
export function setData(json) { data = json; cache.clear(); }

// Indo-Pak text for each of our words of the ayah (quran.ayahs order). A word our text writes apart but Quran.com
// joins to the next (يا أيها) gets "" and the joined word goes on the next one. null where the texts can't be lined up.
export function ayahWords(surah, ayah) {
  const key = `${surah}:${ayah}`;
  if (cache.has(key)) return cache.get(key);
  const a = (data[String(surah)] ?? {})[String(ayah)];
  let out = null;
  if (a) {
    const position = quran.qdcPositions(surah, ayah, a.words.length);
    if (position !== null) out = position.map((p, k) => (k + 1 < position.length && position[k + 1] === p ? '' : a.words[p]));
  }
  cache.set(key, out);
  return out;
}

// Waqf marks over the ayah's end, as the Indo-Pak mushaf prints them.
export const ayahEnd = (surah, ayah) => ((data[String(surah)] ?? {})[String(ayah)] ?? {}).end ?? '';

// The ayah-end sign: the Indo-Pak font draws the numbered circle from a glyph in the text, else ﴿n﴾
export function endMark(surah, ayah) {
  return ayahEnd(surah, ayah) || `﴿${String(ayah).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)])}﴾`;
}

export const follower = { ayahWords };
