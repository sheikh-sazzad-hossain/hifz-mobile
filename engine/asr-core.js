// Recogniser logic shared by the browser worker and the Node twin: audio → fbank → model → words with times.
// The model call itself is injected (`run(feat, frames) → { data, frames, vocab }`), so the same code runs on
// onnxruntime-web (worker) and onnxruntime-node (tests). Model: quran-asr-tiny (offline Conformer-CTC, letters).
import { StreamingFbank, NUM_BINS, SAMPLE_RATE } from './fbank.js';

export { SAMPLE_RATE };
export const FRAME_SECONDS = 0.04; // one output frame per 40 ms
export const MAX_PASS_SECONDS = 20; // cost grows linearly; longer audio is cut into passes of this length

export function parseTokens(text) {
  const tokens = [];
  for (const line of text.split('\n')) {
    const cut = line.lastIndexOf(' ');
    if (cut > 0) tokens[Number(line.slice(cut + 1))] = line.slice(0, cut);
  }
  return tokens; // 0 = <blk>, 1..29 letters, 30 = ▁ (word separator)
}

// Log-mel features of a whole piece of audio: Float32Array [frames * 80].
export function features(samples) {
  const fb = new StreamingFbank();
  fb.accept(samples);
  fb.finish();
  const frames = fb.available;
  return { feat: fb.peek(frames).slice(), frames };
}

// Greedy CTC: the best token per frame, repeats merged, blanks dropped. Words are the letter runs between
// separators; each word carries the time of its first and last letter frame.
export function decodeWords(lp, frames, vocab, tokens) {
  const words = [];
  let prev = 0;
  let cur = null;
  for (let f = 0; f < frames; f++) {
    let best = 0;
    for (let v = 1, o = f * vocab; v < vocab; v++) if (lp[o + v] > lp[o + best]) best = v;
    if (best !== 0 && best !== prev) {
      if (tokens[best] === '▁') {
        if (cur) { words.push(cur); cur = null; }
      } else {
        cur ??= { w: '', t0: f * FRAME_SECONDS, t1: 0 };
        cur.w += tokens[best];
        cur.t1 = (f + 1) * FRAME_SECONDS;
      }
    }
    prev = best;
  }
  if (cur) words.push(cur);
  return words;
}

// Model spelling → the app's standard spelling. `table` maps a model word to a standard word, or to two words
// separated by a space (the time of the word is then shared by letter count).
export function applySpelling(words, table) {
  if (!table) return words;
  const out = [];
  for (const x of words) {
    const m = table.get ? table.get(x.w) : table[x.w];
    if (m === undefined || m === x.w) { out.push(x); continue; }
    const parts = m.split(' ').filter(Boolean);
    if (parts.length <= 1) { out.push({ ...x, w: parts[0] ?? x.w }); continue; }
    const total = parts.reduce((a, p) => a + p.length, 0);
    let t = x.t0;
    for (const p of parts) {
      const t1 = t + ((x.t1 - x.t0) * p.length) / total;
      out.push({ w: p, t0: t, t1 });
      t = t1;
    }
  }
  return out;
}

export function spellingTable(json) {
  return new Map(Object.entries(json));
}

// The recogniser object both sides hand out. `run` does one model call; `slow` repeats it N times (phone simulation).
export function createCore({ run, tokens, spelling, slow = 1 }) {
  const queue = []; // { priority, seq, job }
  let seq = 0;
  let working = false;

  async function pass(samples) {
    const t = performance.now();
    if (samples.length < 4000) return { words: [], ms: 0 }; // under 0.25 s: nothing to hear (the model needs a few frames)
    const { feat, frames } = features(samples);
    let out;
    for (let i = 0; i < Math.max(1, Math.round(slow)); i++) out = await run(feat, frames);
    const words = applySpelling(decodeWords(out.data, out.frames, out.vocab, tokens), spelling);
    return { words, ms: performance.now() - t };
  }

  // Audio longer than MAX_PASS_SECONDS is cut at 20 s steps (word times are shifted back into place).
  async function hearAll(samples) {
    const step = MAX_PASS_SECONDS * SAMPLE_RATE;
    if (samples.length <= step) return pass(samples);
    const words = [];
    let ms = 0;
    for (let s = 0; s < samples.length; s += step) {
      const r = await pass(samples.subarray(s, Math.min(samples.length, s + step)));
      const shift = s / SAMPLE_RATE;
      for (const w of r.words) words.push({ ...w, t0: w.t0 + shift, t1: w.t1 + shift });
      ms += r.ms;
    }
    return { words, ms };
  }

  async function drain() {
    if (working) return;
    working = true;
    while (queue.length) {
      queue.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
      const { job } = queue.shift();
      await job();
    }
    working = false;
  }

  return {
    // hear(samples16k, { priority }) — higher priority goes first; equal priorities keep their order.
    hear(samples, { priority = 0 } = {}) {
      return new Promise((resolve, reject) => {
        queue.push({ priority, seq: seq++, job: () => hearAll(samples).then(resolve, reject) });
        drain();
      });
    },
    get pending() { return queue.length + (working ? 1 : 0); },
  };
}
