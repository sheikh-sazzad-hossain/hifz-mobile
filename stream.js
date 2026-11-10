// Streaming test: Quran-Lab's zipformer model runs in a worker (zipformer-worker.js). This page records the
// microphone, shows the phonemes while the user recites, and afterwards runs the same recording through
// the model once more, as fast as it can, to measure the speed (RTF = model seconds per second of audio).
const DIR = 'models/zipformer-quran-v3.1/';
const SR = 16000;
const params = new URLSearchParams(location.search);
const ORT_VERSION = params.get('ort') || '1.31.1';
const STORE = 'hifz-zipformer-threads';
const GOOD_RTF = 0.5; // the model needs half of real time or less: live mode has room to spare
const CLOSE_RTF = 0.9;
const $ = (id) => document.getElementById(id);
const sec = (ms) => (ms / 1000).toFixed(2);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const browser = () => (navigator.userAgent.match(/(EdgA?|SamsungBrowser|OPR|Firefox|Chrome|Version)\/[\d.]+/) || [''])[0];
const spread = (list) => {
  const s = [...list].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return s.length ? { median: at(0.5), p90: at(0.9), max: s[s.length - 1] } : { median: NaN, p90: NaN, max: NaN };
};

let info = null;
let rec = null; // the worker in use
let setup = null; // how the model was loaded and which thread count won
let ikhlas = [];
let busy = true;
let mic = null;
let summary = '';

// One worker = one copy of the model with a fixed thread count.
class Recognizer {
  constructor() {
    this.worker = new Worker('zipformer-worker.js', { type: 'module' });
    this.waiting = null;
    this.onpartial = null;
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'partial') this.onpartial?.(data);
      else if (data.type === 'error') this.fail(new Error(data.message));
      else this.settle('resolve', data);
    };
    this.worker.onerror = (e) => this.fail(new Error(e.message || 'worker চালু হয়নি'));
  }

  settle(how, value) {
    const w = this.waiting;
    this.waiting = null;
    w?.[how](value);
  }

  fail(err) {
    if (this.waiting) this.settle('reject', err);
    else status(`ত্রুটি: ${err.message}`);
  }

  // Send a message that has an answer (ready, final or bench) and wait for it.
  ask(message) {
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
      this.worker.postMessage(message);
    });
  }

  send(message) { this.worker.postMessage(message); }
}

async function detect() {
  const d = { cores: navigator.hardwareConcurrency || 1, isolated: self.crossOriginIsolated === true, phone: '' };
  try {
    const h = await navigator.userAgentData?.getHighEntropyValues(['model', 'platformVersion']);
    if (h) d.phone = [h.model, h.platform, h.platformVersion].filter(Boolean).join(' ');
  } catch { /* not Chromium */ }
  if (!d.phone) d.phone = navigator.userAgent.replace(/^[^(]*\(([^)]*)\).*$/, '$1');
  return d;
}

function showDevice() {
  const yes = (b) => (b ? '<b class="ok">হ্যাঁ</b>' : '<b class="bad">না</b>');
  $('device').innerHTML = `ফোন: ${esc(info.phone)} · ${esc(browser())}<br>` +
    `CPU কোর: ${info.cores} · মাল্টি-থ্রেড: ${yes(info.isolated)}` +
    (setup ? ` · বাছাই: <b>${setup.threads} থ্রেড</b>` : '');
}

function status(text, frac = null) {
  $('status').textContent = text;
  $('barFill').style.width = frac == null ? '0' : `${Math.round(frac * 100)}%`;
}

function lock(on) {
  busy = on;
  $('rec').disabled = on;
  $('file').disabled = on || !!mic;
}

// The model file is big: download it once, then keep it in the browser's Cache Storage.
async function fetchModel(url, bytes) {
  const cache = await self.caches?.open('hifz-models').catch(() => null);
  const hit = await cache?.match(url);
  if (hit) {
    const data = new Uint8Array(await hit.arrayBuffer());
    if (data.length === bytes) return { data, cached: true };
    await cache.delete(url);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`মডেল নামানো যায়নি (HTTP ${res.status})`);
  const data = new Uint8Array(bytes);
  let got = 0;
  for (const reader = res.body.getReader(); ;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > bytes) throw new Error('মডেল ফাইলের আকার মিলছে না');
    data.set(value, got);
    got += value.length;
    status(`মডেল নামছে ${(got / 1e6).toFixed(0)} / ${(bytes / 1e6).toFixed(0)} MB`, got / bytes);
  }
  if (got !== bytes) throw new Error(`মডেল পুরো নামেনি (${got} / ${bytes} বাইট)`);
  await cache?.put(url, new Response(data, { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => {});
  return { data, cached: false };
}

// Load the model, then find the thread count this phone runs it fastest with. More threads are not always
// faster in WASM (a phone's small cores can slow the big ones down), so each count is timed on the same noise.
async function prepare() {
  const t0 = performance.now();
  const [io, tokens, words] = await Promise.all([
    fetch(`${DIR}io.json`).then((r) => r.json()),
    fetch(`${DIR}tokens.txt`).then((r) => r.text()),
    fetch(`${DIR}ikhlas.json`).then((r) => r.json()),
  ]);
  ikhlas = words;
  const { data, cached } = await fetchModel(DIR + io.model, io.bytes);
  const fetchMs = performance.now() - t0;

  const forced = Number(params.get('threads'));
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
  let options = info.isolated ? [...new Set([1, 2, Math.min(4, Math.ceil(info.cores / 2))])] : [1];
  let calib = {};
  if (forced) options = [forced];
  else if (saved?.ort === ORT_VERSION && saved.cores === info.cores && options.includes(saved.threads)) {
    options = [saved.threads]; // measured on an earlier visit
    calib = saved.calib;
  }
  let best = null;
  const failed = [];
  for (const threads of options) {
    status(`মডেল তৈরি হচ্ছে (${threads} থ্রেড)…`, 1);
    const r = new Recognizer();
    try {
      const ready = await r.ask({ type: 'init', model: data, io, tokens, threads, ortVersion: ORT_VERSION });
      calib[threads] ??= Math.round(ready.calibMs); // a saved choice keeps the numbers it was picked from
      if (!best || ready.calibMs < best.calibMs * 0.9) { // more threads must be clearly faster to win
        rec?.worker.terminate();
        rec = r;
        best = ready;
      } else r.worker.terminate();
    } catch (e) {
      r.worker.terminate();
      failed.push(`${threads}T: ${e.message}`);
    }
  }
  if (!best) throw new Error(failed.join('; '));
  if (!forced) localStorage.setItem(STORE, JSON.stringify({ ort: ORT_VERSION, cores: info.cores, threads: best.threads, calib }));
  setup = { ...best, calib, cached, fetchMs, failed };
}

function showLive(text, lag) {
  const el = $('liveText');
  el.textContent = text;
  el.scrollTop = el.scrollHeight;
  $('lag').textContent = lag == null ? '' : `পিছিয়ে ${lag.toFixed(1)} সে.`;
}

// A live session: pieces of audio go to the worker as they arrive, phonemes come back about twice a second.
// "lag" = how much audio the model has not got through yet when its answer arrives.
function openLive(name) {
  const l = { name, pieces: [], sent: 0, lags: [] };
  rec.onpartial = (p) => {
    const lag = (l.sent - p.processed) / SR;
    l.lags.push(lag);
    showLive(p.text, lag);
  };
  rec.send({ type: 'start' });
  l.push = (piece) => {
    l.pieces.push(piece);
    l.sent += piece.length;
    rec.send({ type: 'audio', samples: piece });
  };
  $('liveCard').hidden = false;
  $('resultCard').hidden = true;
  showLive('', null);
  return l;
}

async function closeLive(l) {
  status('শেষ অংশ পড়া হচ্ছে…', 1);
  const final = await rec.ask({ type: 'stop' });
  rec.onpartial = null;
  showLive(final.text, null);
  const audio = new Float32Array(l.sent);
  let o = 0;
  for (const p of l.pieces) { audio.set(p, o); o += p.length; }
  await analyse(audio, l.name, { text: final.text, chunkMs: final.chunkMs, lags: l.lags });
}

// Run a whole recording through the model at full speed and show the numbers.
async function analyse(audio, name, live = null, keepScores = false) {
  if (audio.length < SR) {
    status('রেকর্ডিং ১ সেকেন্ডের কম — আরেকটু লম্বা করে পড়ো।');
    return null;
  }
  status('গতি মাপা হচ্ছে…', 1);
  const bench = await rec.ask({ type: 'bench', samples: audio, keepScores });
  const run = { name, seconds: audio.length / SR, bench, live };
  render(run);
  status('পরীক্ষা শেষ ✓', 1);
  return run;
}

// How much of the expected phoneme string is in what was heard. The heard text may have more before and
// after it (ta'awwudh, basmala), so only the expected side has to be matched from end to end.
function match(expected, heard) {
  const m = expected.length;
  const n = heard.length;
  const D = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    D[i][0] = i;
    for (let j = 1; j <= n; j++) {
      D[i][j] = Math.min(D[i - 1][j - 1] + (expected[i - 1] !== heard[j - 1]), D[i - 1][j] + 1, D[i][j - 1] + 1);
    }
  }
  let j = 0;
  for (let k = 1; k <= n; k++) if (D[m][k] < D[m][j]) j = k;
  const errors = D[m][j];
  const found = new Array(m).fill(false); // expected characters that were heard as they are
  for (let i = m; i > 0;) {
    if (j > 0 && D[i][j] === D[i - 1][j - 1] + (expected[i - 1] !== heard[j - 1])) {
      found[i - 1] = expected[i - 1] === heard[j - 1];
      i--;
      j--;
    } else if (D[i][j] === D[i - 1][j] + 1) i--;
    else j--;
  }
  return { errors, found };
}

function checkIkhlas(heard) {
  const words = ikhlas.flatMap((a) => a.words);
  const expected = [...words.map((w) => w.p).join('')];
  const { errors, found } = match(expected, [...heard]);
  let o = 0;
  const marks = words.map((w) => {
    const n = [...w.p].length;
    const ok = found.slice(o, o + n).every(Boolean);
    o += n;
    return { ...w, ok };
  });
  const hit = found.filter(Boolean).length;
  return { marks, total: expected.length, hit, errors, percent: Math.round((100 * hit) / expected.length) };
}

function render(run) {
  const { bench, live } = run;
  const rtf = bench.totalMs / 1000 / run.seconds;
  const chunk = spread(bench.chunkMs);
  const lag = live && spread(live.lags);
  const liveChunk = live && spread(live.chunkMs);
  const heard = live?.text ?? bench.text;
  const check = checkIkhlas(heard);

  let [cls, word] = rtf <= GOOD_RTF ? ['ok', '✓ live হিফজ সম্ভব'] : rtf <= CLOSE_RTF ? ['warn', '≈ সীমার কাছে'] : ['bad', '✗ live-এর জন্য ধীর'];
  if (cls === 'ok' && lag && lag.max > 2) [cls, word] = ['warn', '≈ গতি ঠিক, কিন্তু লাইভে পিছিয়ে পড়েছে'];
  $('resultCard').hidden = false;
  $('verdict').className = cls;
  $('verdict').textContent = `streaming: ১ সেকেন্ড অডিও → ${rtf.toFixed(2)} সেকেন্ড (${setup.threads} থ্রেড) — ${word}`;

  const calib = Object.entries(setup.calib).map(([t, ms]) => `${t}T ${ms} ms`).join(' · ');
  const rows = [
    ['পুরো রেকর্ডিং', `${run.seconds.toFixed(1)} সে. অডিও → ${sec(bench.totalMs)} সে. (RTF ${rtf.toFixed(2)})`],
    [`প্রতি ধাপ (${setup.chunkSeconds} সে. অডিও)`, `মধ্যমা ${chunk.median.toFixed(0)} ms · সর্বোচ্চ ${chunk.max.toFixed(0)} ms`],
    live && ['লাইভে পিছিয়ে', `মধ্যমা ${lag.median.toFixed(1)} সে. · সর্বোচ্চ ${lag.max.toFixed(1)} সে.`],
    ['থ্রেড বাছাই (প্রতি ধাপ)', calib],
    ['মডেল লোড', `${setup.cached ? 'ক্যাশ থেকে' : 'নামানো'} ${sec(setup.fetchMs)} সে. · তৈরি ${sec(setup.createMs)} সে.`],
    ['সূরা ইখলাসের সাথে মিল', `${check.percent}% (${check.total}টা ধ্বনি-চিহ্নের ${check.hit}টা)`],
  ].filter(Boolean);
  $('table').innerHTML = rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  let k = 0;
  $('ikhlas').innerHTML = '<p class="ar">' + ikhlas.map((a) => a.words.map((w) =>
    `<span class="${check.marks[k++].ok ? 'ok' : 'bad'}" title="${esc(w.p)}">${esc(w.t)}</span>`,
  ).join(' ')).join(' ۝ ') + '</p><p class="note">সবুজ = শব্দের সব ধ্বনি ধরা পড়েছে · লাল = কিছু বাদ গেছে বা আলাদা শোনা গেছে (ইখলাস পড়লে প্রযোজ্য)।</p>';
  const same = live && live.text === bench.text;
  $('texts').innerHTML = `<details open><summary>শোনা ধ্বনি${live ? ' — লাইভ' : ''}</summary><p class="ar">${esc(heard)}</p></details>` +
    (live && !same ? `<details><summary>শোনা ধ্বনি — দ্বিতীয়বার (পুরো রেকর্ডিং)</summary><p class="ar">${esc(bench.text)}</p></details>` : '');

  const lines = [
    `হিফজ streaming পরীক্ষা — zipformer v3.1 int8 — ${new Date().toLocaleString('en-GB')}`,
    `ফোন: ${info.phone}; ${browser()}; কোর ${info.cores}; মাল্টি-থ্রেড ${info.isolated ? 'হ্যাঁ' : 'না'}`,
    `থ্রেড বাছাই (ms/ধাপ): ${calib} → ${setup.threads}T${setup.failed.length ? `; ব্যর্থ: ${setup.failed.join('; ')}` : ''}`,
    `লোড: ${setup.cached ? 'ক্যাশ' : 'নামানো'} ${sec(setup.fetchMs)} s, তৈরি ${sec(setup.createMs)} s, প্রথম রান ${sec(setup.warmMs)} s`,
    `অডিও: ${run.seconds.toFixed(1)} s (${run.name})`,
    `গতি: পুরো → ${sec(bench.totalMs)} s, RTF ${rtf.toFixed(3)}; ধাপ (${setup.chunkSeconds} s) মধ্যমা ${chunk.median.toFixed(0)} ms, p90 ${chunk.p90.toFixed(0)}, সর্বোচ্চ ${chunk.max.toFixed(0)}; fbank ${bench.fbankMs.toFixed(0)} ms`,
  ];
  if (live) {
    lines.push(`লাইভ: ধাপ মধ্যমা ${liveChunk.median.toFixed(0)} ms, সর্বোচ্চ ${liveChunk.max.toFixed(0)}; পিছিয়ে মধ্যমা ${lag.median.toFixed(2)} s, সর্বোচ্চ ${lag.max.toFixed(2)} s`);
  }
  lines.push(`ইখলাস মিল: ${check.percent}% (${check.total}-এ ${check.hit}; লাল শব্দ: ${check.marks.filter((w) => !w.ok).map((w) => w.t).join('، ') || 'নেই'})`);
  lines.push(`ধ্বনি${live ? ' (লাইভ)' : ''}: ${heard}`);
  if (live) lines.push(same ? 'দ্বিতীয়বার: লাইভের সাথে হুবহু এক' : `ধ্বনি (দ্বিতীয়বার): ${bench.text}`);
  lines.push(`onnxruntime-web ${setup.ort}`);
  summary = lines.join('\n');
  window.hifzTest.lastRun = run;
}

// Any audio the browser can play -> mono Float32 at 16 kHz (decodeAudioData resamples to the context's rate).
async function decodeAudio(buf) {
  const ab = await new OfflineAudioContext(1, 1, SR).decodeAudioData(buf);
  const out = new Float32Array(ab.length);
  for (let c = 0; c < ab.numberOfChannels; c++) {
    const ch = ab.getChannelData(c);
    for (let i = 0; i < ch.length; i++) out[i] += ch[i] / ab.numberOfChannels;
  }
  return out;
}

// Wire an audio source to the capture worklet. The context runs at 16 kHz, so the browser does the resampling.
async function capture(ctx, source, l) {
  await ctx.audioWorklet.addModule('mic-worklet.js');
  const node = new AudioWorkletNode(ctx, 'capture', { channelCount: 1, channelCountMode: 'explicit' });
  node.port.onmessage = (e) => l.push(e.data);
  source.connect(node);
  node.connect(ctx.destination); // the node writes no sound; this connection only keeps it running
  return node;
}

async function toggleMic() {
  const btn = $('rec');
  if (mic) {
    const m = mic;
    mic = null;
    clearInterval(m.tick);
    m.node.port.onmessage = null;
    m.stream.getTracks().forEach((t) => t.stop());
    await m.ctx.close();
    btn.classList.remove('on');
    btn.textContent = '● রেকর্ড শুরু';
    lock(true);
    try {
      await closeLive(m.live);
    } catch (e) {
      status(`ত্রুটি: ${e?.message ?? e}`);
    }
    m.wake?.release().catch(() => {});
    lock(false);
    return;
  }
  if (busy) return;
  lock(true); // until the microphone is open
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false,
      noiseSuppression: false, autoGainControl: true } });
  } catch (e) {
    status(`মাইক চালু হয়নি (${e?.message ?? e})। ব্রাউজারে মাইকের অনুমতি দাও।`);
    lock(false);
    return;
  }
  try {
    const ctx = new AudioContext({ sampleRate: SR });
    if (ctx.sampleRate !== SR) throw new Error(`এই ব্রাউজার ${SR} Hz মাইক দেয় না`);
    const live = openLive('মাইক');
    const node = await capture(ctx, ctx.createMediaStreamSource(stream), live);
    const started = performance.now();
    const tick = setInterval(() => { btn.textContent = `■ থামাও (${Math.floor((performance.now() - started) / 1000)} সে.)`; }, 250);
    mic = { ctx, stream, node, live, tick, wake: await navigator.wakeLock?.request('screen').catch(() => null) };
    btn.classList.add('on');
    btn.textContent = '■ থামাও (0 সে.)';
    status('শুনছি… পড়ো, শেষে থামাও চাপো।');
    busy = false;
    btn.disabled = false; // the file input stays locked while recording
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    status(`মাইক চালু হয়নি (${e?.message ?? e})।`);
    lock(false);
  }
}

$('file').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f || busy) return;
  lock(true);
  try {
    $('liveCard').hidden = true;
    await analyse(await decodeAudio(await f.arrayBuffer()), f.name);
  } catch (err) {
    status(`ফাইল পড়া গেল না: ${err?.message ?? err}`);
  }
  e.target.value = '';
  lock(false);
};

$('copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(summary);
    $('copied').textContent = 'কপি হয়েছে ✓';
  } catch {
    window.prompt('এখান থেকে কপি করো:', summary);
  }
};

// For the laptop-side automated check (no microphone there): the same paths the mic uses, fed from a recording.
window.hifzTest = {
  decodeAudio,
  analyse,
  get summary() { return summary; },
  get setup() { return setup; },
  // pieces of 100 ms pushed at real-time pace (speed 1), without the audio graph
  async simulate(audio, speed = 1) {
    const l = openLive('নকল লাইভ');
    for (let p = 0; p < audio.length; p += SR / 10) {
      l.push(audio.slice(p, p + SR / 10));
      await new Promise((r) => setTimeout(r, 100 / speed));
    }
    await closeLive(l);
    return window.hifzTest.lastRun;
  },
  // the recording played through a 16 kHz AudioContext into the capture worklet, as the microphone would be
  async play(audio) {
    const ctx = new AudioContext({ sampleRate: SR });
    await ctx.resume();
    const buffer = ctx.createBuffer(1, audio.length, SR);
    buffer.copyToChannel(audio, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const l = openLive('worklet নকল');
    const node = await capture(ctx, source, l);
    await new Promise((r) => { source.onended = r; source.start(); });
    await new Promise((r) => setTimeout(r, 300)); // let the last pieces arrive
    node.port.onmessage = null;
    await ctx.close();
    await closeLive(l);
    return window.hifzTest.lastRun;
  },
};

(async () => {
  info = await detect();
  showDevice();
  // First visit: coi-serviceworker.js reloads the page once to switch multi-threading on. Wait for that
  // reload instead of starting a 73 MB download it would cut off.
  if (!info.isolated && window.isSecureContext && navigator.serviceWorker && !sessionStorage.getItem('coi-reloaded')) {
    status('পেজ তৈরি হচ্ছে…');
    await new Promise((r) => setTimeout(r, 4000));
  }
  try {
    await prepare();
  } catch (e) {
    console.error(e);
    status(`মডেল চালু হয়নি: ${e?.message ?? e}`);
    return;
  }
  showDevice();
  $('rec').onclick = toggleMic;
  lock(false);
  if (navigator.mediaDevices?.getUserMedia) status('মডেল তৈরি ✓ — রেকর্ড চাপো।', 1);
  else {
    $('rec').disabled = true;
    status('মডেল তৈরি ✓ — এখানে মাইক চলবে না (https লাগে)। অডিও ফাইল দিয়ে পরীক্ষা করো।', 1);
  }
})();
