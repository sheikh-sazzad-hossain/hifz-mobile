// Word pairing inside a mismatched block: port of check._pair (small edit-distance DP), plus audio helpers
// the follower shares with the engine. Pairs are [refIndex | null, hypIndex | null].
import { SequenceMatcher } from './difflib.js';

const GAP_COST = 0.7; // inside a mismatch, pairing words below 30% similarity costs more than a gap

export function pair(ref, hyp) {
  const n = ref.length;
  const m = hyp.length;
  const sim = ref.map((r) => hyp.map((h) => new SequenceMatcher(r, h).ratio()));
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const back = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  for (let i = 1; i <= n; i++) { cost[i][0] = i * GAP_COST; back[i][0] = 1; }
  for (let j = 1; j <= m; j++) { cost[0][j] = j * GAP_COST; back[0][j] = 2; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      // Python min() over (cost, move): lowest cost, then lowest move
      let c = cost[i - 1][j - 1] + 1 - sim[i - 1][j - 1];
      let mv = 0;
      const c1 = cost[i - 1][j] + GAP_COST;
      if (c1 < c) { c = c1; mv = 1; }
      const c2 = cost[i][j - 1] + GAP_COST;
      if (c2 < c) { c = c2; mv = 2; }
      cost[i][j] = c;
      back[i][j] = mv;
    }
  }
  const pairs = [];
  let i = n;
  let j = m;
  while (i || j) {
    const move = back[i][j];
    pairs.push([move !== 2 ? i - 1 : null, move !== 1 ? j - 1 : null]);
    if (move !== 2) i--;
    if (move !== 1) j--;
  }
  return pairs.reverse();
}

// Python's np.percentile (linear interpolation) of an array of numbers.
export function percentile(values, q) {
  const n = values.length;
  if (!n) return NaN;
  const a = Float64Array.from(values).sort();
  const pos = ((n - 1) * q) / 100;
  const lo = Math.floor(pos);
  const hi = Math.min(n - 1, lo + 1);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

// Pieces of at most maxS seconds, cut at the quietest moment of each piece's last 10 s (transcribe._chunks).
export function quietPieces(audio, maxS = 20, rate = 16000) {
  const step = maxS * rate;
  const frame = rate / 10;
  const search = maxS >= 20 ? 10 * rate : step / 2; // cut within the last 10 s (of a short piece: the last half)
  const out = [];
  let start = 0;
  while (audio.length - start > step) {
    const tail = audio.subarray(start + step - search, start + step);
    let best = 0;
    let bestE = Infinity;
    for (let i = 0, k = 0; i + frame <= tail.length; i += frame, k++) {
      let s = 0;
      for (let t = i; t < i + frame; t++) s += Math.abs(tail[t]);
      const e = s / frame;
      if (e < bestE) { bestE = e; best = k; }
    }
    const cut = start + step - search + best * frame + frame / 2;
    out.push([start, audio.subarray(start, cut)]);
    start = cut;
  }
  out.push([start, audio.subarray(start)]);
  return out; // [[offset in samples, samples]]
}
