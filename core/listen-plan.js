// The listening plan (spec C3 §8.3): a generator of steps for a range of ayahs, repeats, gaps, basmala and next surah.
// Steps: { type: 'play', s, a, from, to, k, n, round, basmala? } and { type: 'wait', seconds }. Times are seconds in the surah mp3.
//   plan(ayahs, o, api)   ayahs: [[surah, ayah]] in play order; o: { repeatAyah, repeatRange (0 = forever), gapRepeatS, gapAyahS, gapAuto, basmala, nextSurah, speed }
//   api: { span(s, a) -> [from, to] | null, basmala(s) -> [from, to] | null, count(s) -> ayahs in the surah }
export function* plan(ayahs, o, api) {
  const rounds = o.repeatRange === 0 ? Infinity : o.repeatRange;
  const seen = new Set();
  for (let r = 1; r <= rounds; r++) {
    seen.clear();
    for (const [s, a] of ayahs) {
      yield* ayahSteps(s, a, r, o, api, seen);
    }
    if (r < rounds && o.gapRepeatS > 0) yield { type: 'wait', seconds: o.gapRepeatS };
    if (r === rounds) break;
  }
  if (o.nextSurah && ayahs.length) { // after the last round: the next surahs, whole, one after another
    let s = ayahs.at(-1)[0] + 1;
    for (; s <= 114; s++) for (let a = 1; a <= api.count(s); a++) yield* ayahSteps(s, a, 1, { ...o, repeatAyah: 1 }, api, new Set());
  }
}

function* ayahSteps(s, a, round, o, api, seen) {
  const sp = api.span(s, a);
  if (!sp) return;
  if (a === 1 && s !== 1 && s !== 9 && o.basmala && !seen.has(s)) {
    seen.add(s);
    const b = api.basmala(s);
    if (b) yield { type: 'play', s, a: 0, from: b[0], to: b[1], k: 1, n: 1, round, basmala: true, src: b[2] ?? s };
  }
  for (let k = 1; k <= o.repeatAyah; k++) {
    yield { type: 'play', s, a, from: sp[0], to: sp[1], k, n: o.repeatAyah, round };
    if (k < o.repeatAyah && o.gapRepeatS > 0) yield { type: 'wait', seconds: o.gapRepeatS };
  }
  const gap = o.gapAuto ? (sp[1] - sp[0]) / o.speed : o.gapAyahS;
  if (gap > 0) yield { type: 'wait', seconds: gap };
}

// the unit index (word) being recited at time t: units = [[start, end]] seconds, ascending; -1 before the first
export function unitAt(units, t) {
  let lo = 0;
  let hi = units.length - 1;
  let found = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (units[m][0] <= t) { found = m; lo = m + 1; } else hi = m - 1; }
  return found;
}
