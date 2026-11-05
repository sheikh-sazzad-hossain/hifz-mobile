// Speed test: Tarteel's Whisper models in the phone's own browser (transformers.js + onnxruntime-web).
// One recording goes through every backend this phone has (WebGPU, WASM). We time the whole clip
// and its 5-second pieces, because a live hifz mode would send windows of about 5 s.
// transformers.min.js is the standalone build (onnxruntime-web bundled); transformers.web.min.js needs a bundler
import { env, AutoProcessor, WhisperForConditionalGeneration } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';

env.allowLocalModels = true; // the models live on this site: ./models/<name>/
env.allowRemoteModels = false;
env.localModelPath = './models/';

const SR = 16000;
const CHUNK_S = 5;
const MAX_CHUNKS = 4;
const GOOD_MS = 1500; // 5 s of audio -> text within 1.5 s: live mode works
const CLOSE_MS = 2500;
const $ = (id) => document.getElementById(id);
const sec = (ms) => (ms / 1000).toFixed(2);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN;
};
const browser = () => (navigator.userAgent.match(/(EdgA?|SamsungBrowser|OPR|Firefox|Chrome|Version)\/[\d.]+/) || [''])[0];

let info = null;
let plans = [];
let busy = false;
let summary = '';

async function detect() {
  const d = { cores: navigator.hardwareConcurrency || 0, isolated: self.crossOriginIsolated === true,
              webgpu: false, f16: false, gpu: '', phone: '' };
  if (navigator.gpu) {
    try {
      const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (a) {
        d.webgpu = true;
        d.f16 = a.features.has('shader-f16');
        const i = a.info ?? {};
        d.gpu = [i.vendor, i.architecture, i.description].filter(Boolean).join(' / ');
      }
    } catch (e) { console.warn('WebGPU adapter:', e); }
  }
  try {
    const h = await navigator.userAgentData?.getHighEntropyValues(['model', 'platformVersion']);
    if (h) d.phone = [h.model, h.platform, h.platformVersion].filter(Boolean).join(' ');
  } catch { /* not Chromium */ }
  if (!d.phone) d.phone = navigator.userAgent.replace(/^[^(]*\(([^)]*)\).*$/, '$1');
  // onnxruntime-web's own default: half the cores, at most 4, and only when cross-origin isolated
  d.threads = d.isolated ? Math.max(1, Math.min(4, Math.ceil(d.cores / 2))) : 1;
  return d;
}

// The decoder runs once per output token (5 s of diacritised recitation is ~40-60 tokens), so where
// it runs matters as much as the encoder. fp16 on the GPU needs the shader-f16 feature.
// Safest first: in transformers.js 4.3.2 one failed session creation makes every later one fail too.
function makePlans(d) {
  const list = [{ name: `CPU ${d.threads}T`, about: `পুরোটা CPU-তে (WASM), ${d.threads} থ্রেড, int8`,
    device: { encoder_model: 'wasm', decoder_model_merged: 'wasm' },
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } }];
  if (d.webgpu) {
    const enc = d.f16 ? 'fp16' : 'fp32';
    list.push({ name: 'GPU+CPU', about: `এনকোডার GPU-তে (${enc}), ডিকোডার CPU-তে (int8)`,
      device: { encoder_model: 'webgpu', decoder_model_merged: 'wasm' },
      dtype: { encoder_model: enc, decoder_model_merged: 'q8' } });
  }
  if (d.webgpu && d.f16) {
    list.push({ name: 'GPU সব', about: 'এনকোডার ও ডিকোডার দুটোই GPU-তে (fp16)',
      device: { encoder_model: 'webgpu', decoder_model_merged: 'webgpu' },
      dtype: { encoder_model: 'fp16', decoder_model_merged: 'fp16' } });
  }
  return list;
}

function showDevice(d) {
  const yes = (b) => (b ? '<b class="ok">হ্যাঁ</b>' : '<b class="bad">না</b>');
  $('device').innerHTML =
    `ফোন: ${esc(d.phone)} · ${esc(browser())}<br>` +
    `WebGPU: ${yes(d.webgpu)}${d.gpu ? ` (${esc(d.gpu)})` : ''} · fp16: ${yes(d.f16)}<br>` +
    `CPU কোর: ${d.cores} · মাল্টি-থ্রেড: ${yes(d.isolated)} (${d.threads} থ্রেড)` +
    (d.webgpu ? '' : '<br><span class="note">WebGPU নেই, তাই শুধু CPU (WASM) পরীক্ষা হবে।</span>');
}

function status(text, frac = null) {
  $('statusCard').hidden = false;
  $('status').textContent = text;
  $('barFill').style.width = frac == null ? '0' : `${Math.round(frac * 100)}%`;
}

function lock(on) {
  for (const id of ['rec', 'model', 'file']) $(id).disabled = on;
}

async function load(model, plan) {
  const files = new Map();
  const progress_callback = (e) => {
    if (e.status !== 'progress' || !e.total) return;
    files.set(e.file, [e.loaded, e.total]);
    let got = 0;
    let all = 0;
    for (const [l, t] of files.values()) { got += l; all += t; }
    status(`${plan.name}: মডেল নামছে ${(got / 1e6).toFixed(0)} / ${(all / 1e6).toFixed(0)} MB`, got / all);
  };
  const t0 = performance.now();
  const processor = await AutoProcessor.from_pretrained(model);
  const whisper = await WhisperForConditionalGeneration.from_pretrained(model, {
    device: plan.device, dtype: plan.dtype, progress_callback });
  return { processor, whisper, loadMs: performance.now() - t0 };
}

// Time one clip. generate() calls streamer.put() once right after the encoder (with the prompt)
// and then once per new token, so the first mark splits encoder time from decoder time.
async function transcribe(m, audio, maxNew = 128) {
  const t0 = performance.now();
  const inputs = await m.processor(audio);
  const t1 = performance.now();
  const marks = [];
  const streamer = { put() { marks.push(performance.now()); }, end() {} };
  const ids = await m.whisper.generate({ ...inputs, language: 'ar', task: 'transcribe', max_new_tokens: maxNew, streamer });
  const t2 = performance.now();
  const text = m.processor.batch_decode(ids, { skip_special_tokens: true })[0].trim();
  const encEnd = marks[0] ?? t2;
  return { text, ms: t2 - t0, featMs: t1 - t0, encMs: encEnd - t1, decMs: t2 - encEnd, tokens: Math.max(0, marks.length - 1) };
}

async function runAll(audio, source) {
  if (busy) return;
  busy = true;
  lock(true);
  const wake = await navigator.wakeLock?.request('screen').catch(() => null);
  const model = $('model').value;
  const n = CHUNK_S * SR;
  const full = audio.subarray(0, Math.min(audio.length, 30 * SR)); // Whisper hears at most 30 s at once
  const chunks = [];
  for (let i = 0; i + n <= audio.length && chunks.length < MAX_CHUNKS; i += n) chunks.push(audio.subarray(i, i + n));
  const run = { size: model.includes('tiny') ? 'tiny' : 'base', source, seconds: audio.length / SR,
                nChunks: chunks.length, rows: [] };
  $('resultCard').hidden = true;
  let failed = false;
  try {
    for (const plan of plans) {
      const row = { plan, chunks: [] };
      run.rows.push(row);
      if (failed) {
        row.error = 'চালানো যায়নি: আগের পদ্ধতির ত্রুটিতে মডেল-ইঞ্জিন আটকে গেছে (পেজ রিলোড করলে ঠিক হয়)';
        render(run);
        continue;
      }
      try {
        status(`${plan.name}: মডেল লোড হচ্ছে…`);
        const m = await load(model, plan);
        row.loadMs = m.loadMs;
        status(`${plan.name}: প্রথম রান (warm-up)…`, 1);
        row.warmMs = (await transcribe(m, new Float32Array(SR), 4)).ms;
        status(`${plan.name}: পুরো রেকর্ডিং…`, 1);
        row.full = await transcribe(m, full, 440); // diacritised text: ~9 tokens per second of recitation
        for (let k = 0; k < chunks.length; k++) {
          status(`${plan.name}: ৫ সেকেন্ডের টুকরো ${k + 1}/${chunks.length}…`, 1);
          row.chunks.push(await transcribe(m, chunks[k]));
        }
        await m.whisper.dispose();
      } catch (e) {
        console.error(e);
        row.error = String(e?.message ?? e).slice(0, 300);
        failed = true;
      }
      render(run);
    }
    status('পরীক্ষা শেষ ✓', 1);
  } finally {
    busy = false;
    lock(false);
    wake?.release().catch(() => {});
  }
}

function render(run) {
  $('resultCard').hidden = false;
  const stats = (r) => r.chunks.length && {
    five: median(r.chunks.map((c) => c.ms)),
    enc: median(r.chunks.map((c) => c.encMs)),
    perTok: median(r.chunks.filter((c) => c.tokens).map((c) => c.decMs / c.tokens)),
  };
  const best = run.rows.filter((r) => r.chunks.length).sort((a, b) => stats(a).five - stats(b).five)[0];
  const v = $('verdict');
  if (best) {
    const ms = stats(best).five;
    const [cls, word] = ms <= GOOD_MS ? ['ok', '✓ live হিফজ সম্ভব'] : ms <= CLOSE_MS ? ['warn', '≈ সীমার কাছে'] : ['bad', '✗ live-এর জন্য ধীর'];
    v.className = cls;
    v.textContent = `${run.size}: ৫ সেকেন্ড অডিও → ${sec(ms)} সেকেন্ড (${best.plan.name}) — ${word}`;
  } else {
    v.className = 'warn';
    v.textContent = run.seconds < CHUNK_S ? 'রেকর্ডিং ৫ সেকেন্ডের কম — আরেকটু লম্বা করে পড়ো।' : 'এখনও ফল নেই।';
  }
  const fullS = Math.min(run.seconds, 30).toFixed(0);
  let html = `<tr><th>পদ্ধতি</th><th>৫ সে. অডিও</th><th>পুরো ${fullS} সে.</th><th>এনকোডার</th><th>প্রতি টোকেন</th><th>লোড</th></tr>`;
  let texts = '';
  for (const r of run.rows) {
    if (r.error) {
      html += `<tr><td>${esc(r.plan.name)}</td><td colspan="5" class="bad">ত্রুটি: ${esc(r.error)}</td></tr>`;
      continue;
    }
    const s = stats(r);
    html += `<tr><td title="${esc(r.plan.about)}">${esc(r.plan.name)}</td>` +
      `<td><b>${s ? sec(s.five) + ' সে.' : '—'}</b></td>` +
      `<td>${r.full ? sec(r.full.ms) + ' সে.' : '—'}</td>` +
      `<td>${s ? sec(s.enc) + ' সে.' : '—'}</td>` +
      `<td>${s && s.perTok ? s.perTok.toFixed(0) + ' ms' : '—'}</td>` +
      `<td>${r.loadMs ? sec(r.loadMs) + ' সে.' : '—'}</td></tr>`;
    if (r.full) {
      texts += `<details${r === best ? ' open' : ''}><summary>লেখা — ${esc(r.plan.name)}</summary>` +
        `<p class="ar">${esc(r.full.text)}</p>` +
        r.chunks.map((c, k) => `<p class="note">টুকরো ${k + 1}: ${sec(c.ms)} সে. · <span dir="rtl">${esc(c.text)}</span></p>`).join('') +
        '</details>';
    }
  }
  $('table').innerHTML = html;
  $('texts').innerHTML = texts;

  const lines = [
    `হিফজ গতি পরীক্ষা — ${run.size} — ${new Date().toLocaleString('en-GB')}`,
    `ফোন: ${info.phone}; ${browser()}; কোর ${info.cores}; WebGPU ${info.webgpu ? 'হ্যাঁ' : 'না'}${info.gpu ? ` (${info.gpu})` : ''}; ` +
      `fp16 ${info.f16 ? 'হ্যাঁ' : 'না'}; থ্রেড ${info.threads}${info.isolated ? '' : ' (isolation নেই)'}`,
    `অডিও: ${run.seconds.toFixed(1)} s (${run.source}), ৫ s টুকরো ${run.nChunks}টা`,
  ];
  for (const r of run.rows) {
    const s = stats(r);
    lines.push(r.error ? `${r.plan.name}: ত্রুটি — ${r.error}` :
      `${r.plan.name}: 5s→${s ? sec(s.five) : '-'} s [${r.chunks.map((c) => sec(c.ms)).join(' ')}], ` +
      `পুরো→${r.full ? sec(r.full.ms) : '-'} s (${r.full?.tokens ?? '-'} টোকেন), এনকোডার ${s ? sec(s.enc) : '-'} s, ` +
      `${s && s.perTok ? s.perTok.toFixed(0) : '-'} ms/টোকেন, লোড ${r.loadMs ? sec(r.loadMs) : '-'} s, প্রথম রান ${r.warmMs ? sec(r.warmMs) : '-'} s`);
  }
  for (const r of run.rows) if (r.full) lines.push(`লেখা (${r.plan.name}): ${r.full.text}`);
  lines.push(`transformers.js ${env.version}, onnxruntime-web ${env.backends.onnx?.versions?.web ?? '?'}`);
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

let recorder = null;
async function toggleRecord() {
  if (recorder) { recorder.stop(); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  } catch (e) {
    status(`মাইক চালু হয়নি (${e?.message ?? e})। ব্রাউজারে মাইকের অনুমতি দাও।`);
    return;
  }
  const parts = [];
  const r = new MediaRecorder(stream);
  const btn = $('rec');
  const started = performance.now();
  const tick = setInterval(() => { btn.textContent = `■ থামাও (${Math.floor((performance.now() - started) / 1000)} সে.)`; }, 250);
  r.ondataavailable = (e) => e.data.size && parts.push(e.data);
  r.onstop = async () => {
    clearInterval(tick);
    stream.getTracks().forEach((t) => t.stop());
    recorder = null;
    btn.classList.remove('on');
    btn.textContent = '● রেকর্ড শুরু';
    try {
      const audio = await decodeAudio(await new Blob(parts, { type: r.mimeType }).arrayBuffer());
      await runAll(audio, 'মাইক');
    } catch (e) {
      lock(false);
      status(`অডিও পড়া গেল না: ${e?.message ?? e}`);
    }
  };
  recorder = r;
  r.start();
  btn.classList.add('on');
  btn.textContent = '■ থামাও (0 সে.)';
  $('model').disabled = true;
  $('file').disabled = true;
}

$('file').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    await runAll(await decodeAudio(await f.arrayBuffer()), f.name);
  } catch (err) {
    status(`ফাইল পড়া গেল না: ${err?.message ?? err}`);
  }
  e.target.value = '';
};

$('copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(summary);
    $('copied').textContent = 'কপি হয়েছে ✓';
  } catch {
    window.prompt('এখান থেকে কপি করো:', summary);
  }
};

(async () => {
  info = await detect();
  if (env.backends.onnx?.wasm) env.backends.onnx.wasm.numThreads = info.threads;
  plans = makePlans(info);
  showDevice(info);
  $('rec').onclick = toggleRecord;
  lock(false);
  if (!navigator.mediaDevices?.getUserMedia) {
    $('rec').disabled = true;
    status('এখানে মাইক চলবে না (https লাগে)। অডিও ফাইল দিয়ে পরীক্ষা করো।');
  }
})();

// Used by the laptop-side automated check (runs a file through the same path as the mic).
window.hifzTest = { runAll, decodeAudio, get summary() { return summary; } };
