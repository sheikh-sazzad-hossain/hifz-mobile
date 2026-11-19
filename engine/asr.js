// Page side of the recogniser: downloads and caches the model, finds the best thread count on this phone,
// and hands out `hear(samples)` with the same contract as the Node twin (engine/asr-node.js).
//   createRecognizer({ onProgress, threads, slow }) → { hear(samples16k, { priority }) → { words, ms }, info }
// URL options: ?threads=N forces a thread count, ?slow=N stretches every model call N times (a slower phone).
const CACHE = 'hifz-model-v1';
const STORE = 'hifz-asr-threads';
const MODEL = new URL('../models/quran-asr-tiny/', import.meta.url).href;
export const MODEL_FILES = ['model.int8.onnx', 'tokens.txt'];
const SPELLING = new URL('../data/spelling.json', import.meta.url).href; // model spelling → the app's standard spelling
export const MODEL_BYTES = 18_850_000 + 70_000;

async function fetchCached(url, onBytes) {
  const cache = 'caches' in self ? await caches.open(CACHE) : null;
  let res = await cache?.match(url);
  if (res) { const buf = await res.arrayBuffer(); onBytes?.(buf.byteLength); return buf; }
  res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const copy = res.clone();
  const reader = res.body.getReader();
  const parts = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    onBytes?.(value.length);
  }
  const buf = await new Blob(parts).arrayBuffer();
  await cache?.put(url, copy).catch(() => {});
  return buf;
}

export async function modelReady() { // is the model already in this browser's cache?
  if (!('caches' in self)) return false;
  return !!(await (await caches.open(CACHE)).match(MODEL + MODEL_FILES[0]));
}

class Remote {
  constructor() {
    this.worker = new Worker(new URL('./asr-worker.js', import.meta.url), { type: 'module' });
    this.nextId = 1;
    this.calls = new Map();
    this.ready = null;
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'heard') {
        const c = this.calls.get(data.id);
        this.calls.delete(data.id);
        if (data.error) c.reject(new Error(data.error)); else c.resolve({ words: data.words, ms: data.ms });
      } else if (data.type === 'ready') this.ready?.resolve(data);
      else if (data.type === 'error') this.ready?.reject(new Error(data.message));
    };
    this.worker.onerror = (e) => this.ready?.reject(new Error(e.message || 'worker did not start'));
  }

  init(msg) {
    return new Promise((resolve, reject) => {
      this.ready = { resolve, reject };
      this.worker.postMessage({ type: 'init', ...msg });
    });
  }

  hear(samples, priority) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.calls.set(id, { resolve, reject });
      const copy = samples.slice(); // the caller keeps its own buffer; the copy's memory moves to the worker (no second copy)
      this.worker.postMessage({ type: 'hear', id, samples: copy, priority }, [copy.buffer]);
    });
  }
}

export async function createRecognizer({ onProgress, threads, slow } = {}) {
  const params = new URLSearchParams(self.location?.search ?? '');
  slow = slow ?? (Number(params.get('slow')) || 1);
  const forced = threads ?? (Number(params.get('threads')) || 0);
  let got = 0;
  const bump = (n) => { got += n; onProgress?.({ loaded: got, total: MODEL_BYTES }); };
  const [model, tokens] = await Promise.all(MODEL_FILES.map((f) => fetchCached(MODEL + f, bump)));
  const spellingText = await fetchCached(SPELLING, bump);
  const tokenText = new TextDecoder().decode(tokens);
  const spelling = JSON.parse(new TextDecoder().decode(spellingText));

  const cores = navigator.hardwareConcurrency || 1;
  const isolated = self.crossOriginIsolated === true;
  let options = isolated ? [...new Set([1, 2, Math.min(4, Math.ceil(cores / 2))])] : [1];
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (forced) options = [forced];
  else if (saved && saved.cores === cores && options.includes(saved.threads)) options = [saved.threads];

  let best = null;
  const calib = {};
  for (const n of options) {
    const r = new Remote();
    try {
      const ready = await r.init({ model: model.slice(0), tokens: tokenText, spelling, threads: n, slow });
      calib[n] = Math.round(ready.calibMs);
      if (!best || ready.calibMs < best.ready.calibMs * 0.9) { best?.remote.worker.terminate(); best = { remote: r, ready }; continue; }
    } catch (e) { calib[n] = String(e.message); }
    r.worker.terminate();
  }
  if (!best) throw new Error(`model did not start: ${JSON.stringify(calib)}`);
  if (!forced) localStorage.setItem(STORE, JSON.stringify({ cores, threads: best.ready.threads, calib }));
  const { remote, ready } = best;

  // C18: a second session in its own worker for the check work (priority 0: verify, audit, relock, final passes).
  // With one session a live pass waited behind a check pass of up to 8-20 s of audio (seconds on a phone), so the
  // words stood still and then came in a burst. Same model and same audio per pass, so the same words; only live
  // passes no longer wait. Needs threads (cross-origin isolation) and at least 6 cores; ?checkworker=0 turns it off.
  let check = null;
  const want = params.get('checkworker') ?? (isolated && cores >= 6 ? '1' : '0');
  if (want !== '0') { // started in the background: the app is ready without it, check passes use the main session until then
    const r = new Remote();
    r.init({ model: model.slice(0), tokens: tokenText, spelling, threads: Math.max(1, Math.min(2, ready.threads)), slow, calib: false })
      .then(() => { check = r; }, () => r.worker.terminate());
  }

  return {
    // One call = one model pass (the worker repeats it `slow` times to imitate a slower phone). Live passes
    // (priority >= 1) go to the main session, check passes to the check session when there is one.
    async hear(samples, { priority = 0 } = {}) {
      return (check && priority < 1 ? check : remote).hear(samples, priority);
    },
    info: { backend: `onnxruntime-web ${ready.ort}`, threads: ready.threads, cores, isolated, calibMs: ready.calibMs, calib, slow, get checkWorker() { return !!check; } },
  };
}
