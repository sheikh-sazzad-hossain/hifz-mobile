// The only place that makes sound: tones and recorded audio (Alafasy, the user's own clips).
// Muted (`?mute=1` in the URL, or setMuted(true)) nothing is ever connected to the speakers, but playback still
// "takes" its real duration, so the logic that waits for a recitation to end behaves the same in tests.
let ctx = null;
let muted = typeof location !== 'undefined' && new URLSearchParams(location.search).get('mute') === '1';
let master = null;
const playing = new Set(); // { stop() }
const decoded = new Map();

export function setMuted(v) { muted = !!v; if (muted) stopAll(); }
export function isMuted() { return muted; }

function audio() {
  if (!ctx) {
    ctx = new (self.AudioContext || self.webkitAudioContext)();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function stopAll() { for (const p of [...playing]) p.stop(); }

// One play handle: { done: Promise<void> (resolves when it ends or is stopped), stop(), duration }.
function handle(duration, node) {
  let finish;
  const done = new Promise((r) => { finish = r; });
  let timer = null;
  const h = {
    duration, done,
    stop() { if (!playing.has(h)) return; playing.delete(h); clearTimeout(timer); try { node?.stop(); } catch { /* already ended */ } finish(); },
  };
  playing.add(h);
  timer = setTimeout(() => h.stop(), duration * 1000 + 50);
  if (node) node.onended = () => h.stop();
  return h;
}

export function tone(freq = 440, seconds = 0.25, volume = 0.15) {
  if (muted) return handle(seconds, null);
  const c = audio();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.frequency.value = freq;
  g.gain.setValueAtTime(volume, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + seconds);
  osc.connect(g).connect(master);
  osc.start();
  osc.stop(c.currentTime + seconds);
  return handle(seconds, osc);
}

export async function load(urlOrBuffer) {
  const key = typeof urlOrBuffer === 'string' ? urlOrBuffer : null;
  if (key && decoded.has(key)) return decoded.get(key);
  const data = key ? await (await fetch(key)).arrayBuffer() : urlOrBuffer;
  const buf = await audio().decodeAudioData(data.slice(0));
  if (key) decoded.set(key, buf);
  return buf;
}

// Play a url or an ArrayBuffer (from `offset` seconds, up to `length` seconds if given).
export async function play(urlOrBuffer, { offset = 0, length } = {}) {
  const buf = await load(urlOrBuffer);
  const duration = Math.max(0, Math.min(length ?? Infinity, buf.duration - offset));
  if (muted) return handle(duration, null);
  const c = audio();
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(master);
  src.start(0, offset, duration);
  return handle(duration, src);
}

// Play raw samples (a recording or a clip, Float32 at `rate`), from `offset` s for at most `length` s.
export function playSamples(samples, rate = 16000, { offset = 0, length } = {}) {
  const total = samples.length / rate;
  const duration = Math.max(0, Math.min(length ?? Infinity, total - offset));
  if (muted) return handle(duration, null);
  const c = audio();
  const buf = c.createBuffer(1, samples.length, rate);
  buf.copyToChannel(samples, 0);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(master);
  src.start(0, offset, duration);
  return handle(duration, src);
}
