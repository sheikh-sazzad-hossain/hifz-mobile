// The streaming Quran recogniser, in a worker so the page stays smooth while it runs.
// Model: Quran-Lab zipformer_p-arabic-v3.1 (streaming CTC, int8), run by onnxruntime-web on the CPU (WASM).
// Audio comes in as 16 kHz mono pieces; after every 0.48 s of it the model is called once and the
// phonemes found so far go back to the page. The worker fetches nothing itself except onnxruntime-web.
import { StreamingFbank, SAMPLE_RATE, NUM_BINS } from './fbank.js';

const TAIL = Math.round(0.8 * SAMPLE_RATE); // silence pushed in at the end, so the last real chunk gets decoded
const now = () => performance.now();

let ort;
let session;
let io;
let tokens = [];
let blank = 0;
let fb;
let state;
let prev;
let ids;
let text;
let chunkMs;
let fbankMs;
let logProbs = null; // set to [] to keep every frame's scores (for checks against a reference decode)

function reset() {
  fb = new StreamingFbank();
  state = {};
  for (const s of io.states) {
    const n = s.dims.reduce((a, b) => a * b, 1);
    state[s.name] = new ort.Tensor(s.type, s.type === 'int64' ? new BigInt64Array(n) : new Float32Array(n), s.dims);
  }
  prev = blank;
  ids = [];
  text = '';
  chunkMs = [];
  fbankMs = 0;
}

function accept(samples) {
  const t = now();
  fb.accept(samples);
  fbankMs += now() - t;
}

// One model call over the oldest T frames, then move forward by `shift` frames (the calls overlap).
async function step() {
  const x = new ort.Tensor('float32', fb.peek(io.T).slice(), [1, io.T, NUM_BINS]);
  const t = now();
  const out = await session.run({ x, ...state });
  chunkMs.push(now() - t);
  fb.drop(io.shift);
  io.states.forEach((s, i) => { state[s.name] = out[io.outputs[i + 1]]; });
  const lp = out[io.outputs[0]]; // log-probabilities [1, frames, vocab]
  logProbs?.push(lp.data.slice());
  const [, frames, vocab] = lp.dims;
  for (let f = 0; f < frames; f++) { // greedy CTC: best token per frame, repeats merged, blanks dropped
    let best = 0;
    for (let v = 1, o = f * vocab; v < vocab; v++) if (lp.data[o + v] > lp.data[o + best]) best = v;
    if (best !== blank && best !== prev) {
      ids.push(best);
      text += tokens[best];
    }
    prev = best;
  }
}

async function drain() {
  let ran = false;
  while (fb.available >= io.T) {
    await step();
    ran = true;
  }
  return ran;
}

const result = (type, extra = {}) => ({ type, text, ids: ids.slice(), chunkMs: chunkMs.slice(), fbankMs,
  processed: fb.first * (SAMPLE_RATE / 100), ...extra }); // processed = samples the model has moved past

// The page downloads the model once and hands every worker its own copy, with the model's io.json and tokens.txt.
async function init({ model, io: description, tokens: tokenText, threads, ortVersion }) {
  const t0 = now();
  const dist = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/`;
  ort = await import(`${dist}ort.wasm.min.mjs`);
  ort.env.wasm.wasmPaths = dist;
  ort.env.wasm.numThreads = threads;
  io = description;
  for (const line of tokenText.split('\n')) {
    const cut = line.lastIndexOf(' ');
    if (cut > 0) tokens[Number(line.slice(cut + 1))] = line.slice(0, cut);
  }
  blank = tokens.indexOf('<blank>');
  const t1 = now();
  session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  const t2 = now();

  // Time a few calls on 3 s of noise: the first one warms up, the rest say how fast this thread count is.
  reset();
  const noise = new Float32Array(3 * SAMPLE_RATE);
  for (let i = 0, seed = 1; i < noise.length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    noise[i] = (seed / 4294967296 - 0.5) * 0.1;
  }
  fb.accept(noise);
  await drain();
  const rest = chunkMs.slice(1).sort((a, b) => a - b);
  return { type: 'ready', threads: self.crossOriginIsolated ? threads : 1, importMs: t1 - t0, createMs: t2 - t1,
    warmMs: chunkMs[0], calibMs: rest[Math.floor(rest.length / 2)], chunkSeconds: io.shift / 100,
    ort: ort.env.versions?.web ?? ortVersion };
}

async function handle(m) {
  switch (m.type) {
    case 'init': return init(m);
    case 'start': reset(); return null;
    case 'audio': // live: one piece from the microphone
      accept(m.samples);
      return (await drain()) ? result('partial') : null;
    case 'stop':
      accept(new Float32Array(TAIL));
      fb.finish();
      await drain();
      return result('final');
    case 'bench': { // a whole recording at once, as fast as the phone can go
      reset();
      logProbs = m.keepScores ? [] : null;
      const t = now();
      accept(m.samples);
      accept(new Float32Array(TAIL));
      fb.finish();
      await drain();
      return result('bench', { totalMs: now() - t, seconds: m.samples.length / SAMPLE_RATE, logProbs });
    }
    default: throw new Error(`unknown message ${m.type}`);
  }
}

// Messages are handled strictly one after another, in the order they arrive.
let chain = Promise.resolve();
self.onmessage = (e) => {
  chain = chain.then(() => handle(e.data)).then(
    (reply) => reply && self.postMessage(reply),
    (err) => self.postMessage({ type: 'error', message: String(err?.message ?? err) }));
};
