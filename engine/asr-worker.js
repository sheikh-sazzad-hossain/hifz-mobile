// The recogniser in a worker, so the page stays smooth. onnxruntime-web (WASM, from vendor/) runs quran-asr-tiny;
// the logic around the model is engine/asr-core.js, the same code the Node twin uses.
import { createCore, parseTokens, spellingTable } from './asr-core.js';

let ort;
let core;

async function init({ model, tokens, spelling, threads, slow }) {
  const t0 = performance.now();
  ort = await import('../vendor/ort.wasm.min.mjs');
  ort.env.wasm.wasmPaths = new URL('../vendor/', import.meta.url).href;
  ort.env.wasm.numThreads = threads;
  const t1 = performance.now();
  const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  const t2 = performance.now();
  const run = async (feat, frames) => {
    const out = await session.run({
      x: new ort.Tensor('float32', feat, [1, frames, 80]),
      x_lens: new ort.Tensor('int64', BigInt64Array.from([BigInt(frames)]), [1]),
    });
    const [, f, vocab] = out.log_probs.dims;
    return { data: out.log_probs.data, frames: Number(out.log_probs_len.data[0] ?? f), vocab };
  };
  core = createCore({ run, tokens: parseTokens(tokens), spelling: spelling ? spellingTable(spelling) : null, slow: 1 });
  
  // Time four 3 s passes on noise: the first one warms up, the median of the rest says how fast this thread count is.
  const noise = new Float32Array(48000);
  for (let i = 0, seed = 1; i < noise.length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    noise[i] = (seed / 4294967296 - 0.5) * 0.1;
  }
  const times = [];
  for (let i = 0; i < 4; i++) times.push((await core.hear(noise)).ms);
  const rest = times.slice(1).sort((a, b) => a - b);
  core = createCore({ run, tokens: parseTokens(tokens), spelling: spelling ? spellingTable(spelling) : null, slow });
  return { type: 'ready', threads: self.crossOriginIsolated ? threads : 1, importMs: t1 - t0, createMs: t2 - t1,
    warmMs: times[0], calibMs: rest[1], ort: ort.env.versions?.web };
}

let chain = Promise.resolve();
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'hear') { // queued inside core, higher priority first
    core.hear(m.samples, { priority: m.priority }).then(
      (r) => self.postMessage({ type: 'heard', id: m.id, words: r.words, ms: r.ms }),
      (err) => self.postMessage({ type: 'heard', id: m.id, error: String(err?.message ?? err) }));
    return;
  }
  chain = chain.then(() => (m.type === 'init' ? init(m) : null)).then(
    (reply) => reply && self.postMessage(reply),
    (err) => self.postMessage({ type: 'error', message: String(err?.message ?? err) }));
};
