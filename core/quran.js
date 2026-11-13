// Quran text and the word-comparison rules: a line-by-line port of the laptop app's quran.py.
// The text (data/quran.json) is given by setData(json) so the same module runs in the page and in Node.
import { SequenceMatcher } from './difflib.js';

export const ISTIADHA = '\u0623\u064e\u0639\u064f\u0648\u0630\u064f \u0628\u0650\u0627\u0644\u0644\u064e\u0651\u0647\u0650 \u0645\u0650\u0646\u064e \u0627\u0644\u0634\u064e\u0651\u064a\u0652\u0637\u064e\u0627\u0646\u0650 \u0627\u0644\u0631\u064e\u0651\u062c\u0650\u064a\u0645\u0650';
export const BASMALA = '\u0628\u0650\u0633\u0652\u0645\u0650 \u0627\u0644\u0644\u064e\u0651\u0647\u0650 \u0627\u0644\u0631\u064e\u0651\u062d\u0652\u0645\u064e\u0670\u0646\u0650 \u0627\u0644\u0631\u064e\u0651\u062d\u0650\u064a\u0645\u0650';

// harakat, tanween, shadda, sukun, dagger alif, Quranic marks, tatweel, BOM
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ﻿]/g;
const LETTER_MAP = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ؤ': 'و', 'ئ': 'ي', 'ة': 'ه' };

const translate = (s, map) => {
  let out = '';
  for (const c of s) {
    const m = map[c];
    out += m === undefined ? c : m; // '' deletes
  }
  return out;
};

export function normalize(word) {
  return translate(word.replace(DIACRITICS, ''), LETTER_MAP);
}

// Letter groups for judging mistakes (see quran.py): a letter swapped within its group is a slight
// pronunciation difference; a dropped alif/hamza likewise.
const GROUPS = { 'ص': 'س', 'ش': 'س', 'ز': 'س', 'ذ': 'س', 'ث': 'س', 'ظ': 'س', 'ط': 'ت', 'د': 'ت', 'ض': 'ت', 'ق': 'ك',
  'ح': 'ه', 'خ': 'ه', 'غ': 'ه', 'ع': 'ه', 'ا': '', 'ء': '' };
const NEAR = new Set(['تث', 'ثت', 'بم', 'مب', 'ضز', 'زض']);
const DROP = { 'ا': '', 'ء': '' };

export const PARTICLES = new Set(['من', 'ما', 'لا', 'في', 'لم', 'لن', 'ان', 'عن', 'او', 'ثم', 'قد', 'بل', 'هل', 'يا', 'لي',
  'له', 'لك', 'هو', 'هي', 'هم', 'كل', 'الا', 'اذا', 'اذ', 'الي', 'علي', 'ولا', 'وما', 'فلا',
  'لها', 'لهم', 'به', 'بها', 'منه', 'انا', 'ذلك', 'كان', 'قال']);

// Letters that matter when comparing words: no article ال (nor a و/ف/ب/ك before it), no alif/hamza.
function letters(w0) {
  let w = w0;
  if (['وال', 'فال', 'بال', 'كال'].includes(w.slice(0, 3)) && w.length > 4) w = w.slice(3);
  else if (w.startsWith('ال') && w.length > 3) w = w.slice(2);
  return translate(w, DROP) || w0;
}

export function skeleton(w) {
  return translate(letters(w), GROUPS);
}

export function sameWord(a, b) {
  const la = letters(a);
  const lb = letters(b);
  const x = translate(la, GROUPS);
  const y = translate(lb, GROUPS);
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 3 && long.startsWith(short)) return true;
  let indels = 0;
  for (const [op, i1, i2, j1, j2] of new SequenceMatcher(x, y).opcodes()) {
    if (op === 'replace') {
      if (i2 - i1 !== j2 - j1) return false;
      for (let k = 0; k < i2 - i1; k++) if (!NEAR.has(la[i1 + k] + lb[j1 + k])) return false;
    } else if (op !== 'equal') indels += (i2 - i1) + (j2 - j1);
  }
  return indels === 0 || (indels === 1 && Math.min(x.length, y.length) >= 2);
}

export const SIMILAR_RATIO = 0.7;

// Without a leading و/ف/ل/ب/ك and the article.
function stem(w0) {
  let w = w0;
  if (w.length > 3 && 'وفلبك'.includes(w[0])) w = w.slice(1);
  if (w.startsWith('ال') && w.length > 3) w = w.slice(2);
  else if (w.startsWith('ل') && w.length > 3) w = w.slice(1);
  return w;
}

export function alike(a, b) {
  return sameWord(a, b) || new SequenceMatcher(skeleton(a), skeleton(b)).ratio() >= SIMILAR_RATIO;
}

export function similar(expected, heard) {
  if (sameWord(expected, heard) || sameWord(stem(expected), stem(heard))) return true;
  return !vocabulary().has(heard) && alike(expected, heard);
}

export function mayBeAdded(heard) {
  return vocabulary().has(heard) && (heard.length >= 4 || skeleton(heard).length >= 3) && !PARTICLES.has(heard);
}

export function within(normWord, heardNorms) {
  const target = translate(letters(normWord), GROUPS);
  const joined = heardNorms.map((h) => translate(translate(h, DROP), GROUPS)).join('');
  return target.length >= 3 && joined.includes(target);
}

// waqf marks stand alone in the source text; they are not words to recite
export function words(text) {
  return text.replaceAll('﻿', '').split(/[\s\u001c-\u001f\u0085]+/).filter((w) => w && normalize(w));
}

let data = null;
let vocab = null;

export function setData(json) {
  data = json.surahs;
  vocab = null;
}

function surahs() {
  if (!data) throw new Error('Quran data not loaded: call setData() first');
  return data;
}

export function vocabulary() {
  if (!vocab) {
    vocab = new Set();
    for (const s of surahs()) for (const t of s.a) for (const w of words(t)) vocab.add(normalize(w));
  }
  return vocab;
}

export function surahInfo(surah) {
  const s = surahs()[surah - 1];
  return { number: surah, name: s.name, english: s.en, ayahs: s.a.length };
}

const JOINED = new Set(['يا', 'ويا', 'فيا', 'ها']);

// Index of each of our words of the ayah in Quran.com's word list (qdcCount words), or null.
export function qdcPositions(surah, ayah, qdcCount) {
  const norms = ayahs(surah, ayah, ayah)[0][1].map(normalize);
  let extra = norms.length - qdcCount;
  const position = [];
  let pos = 0;
  norms.forEach((w, k) => {
    position.push(pos);
    if (extra > 0 && JOINED.has(w) && k + 1 < norms.length) extra -= 1;
    else pos += 1;
  });
  return extra === 0 && pos === qdcCount ? position : null;
}

// [[ayahNumber, [words]]] for the range. The basmala the source prepends to ayah 1 of every surah but 1 and 9 is removed.
export function ayahs(surah, first = 1, last = null) {
  const s = surahs()[surah - 1].a;
  last = last || s.length;
  const out = [];
  const bas = words(BASMALA).map(normalize);
  for (let k = first - 1; k < Math.min(last, s.length); k++) {
    let w = words(s[k]);
    if (surah !== 1 && surah !== 9 && k === 0) {
      const head = w.slice(0, bas.length).map(normalize);
      if (head.length === bas.length && head.every((x, i) => x === bas[i])) w = w.slice(bas.length);
    }
    out.push([k + 1, w]);
  }
  return out;
}
