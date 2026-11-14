// Playing the surah mp3 of Alafasy (a span of it) and the reciter's own recordings/clips, through engine/audio-out.js
// (so ?mute=1 silences everything). The mp3 streams from the CDN; a surah can be kept for offline use in Cache Storage.
import { playSamples, setMuted, isMuted, stopAll } from '../engine/audio-out.js';

export { setMuted, isMuted, stopAll };
const CACHE = 'hifz-media-v1';
const MAX_OFFLINE_BYTES = 40 * 1024 * 1024; // surahs bigger than this are only streamed

let player = null;
let current = null; // { stop() }
const blobUrls = new Map();

export async function srcFor(url) {
  if (blobUrls.has(url)) return blobUrls.get(url);
  if ('caches' in self) {
    const hit = await (await caches.open(CACHE)).match(url);
    if (hit) { const u = URL.createObjectURL(await hit.blob()); blobUrls.set(url, u); return u; }
  }
  return url;
}

export async function isCached(url) { return 'caches' in self && !!(await (await caches.open(CACHE)).match(url)); }

// Keep a surah's mp3 for offline use (returns false when it is too big or the download fails).
export async function cacheSurah(url, onProgress, maxBytes = MAX_OFFLINE_BYTES) {
  try {
    if (await isCached(url)) return true;
    const head = await fetch(url, { method: 'HEAD' });
    const size = Number(head.headers.get('content-length') || 0);
    if (size > maxBytes) return false;
    const res = await fetch(url);
    if (!res.ok) return false;
    const copy = res.clone();
    const reader = res.body.getReader();
    let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; got += value.length; onProgress?.(got, size); }
    await (await caches.open(CACHE)).put(url, copy);
    return true;
  } catch { return false; }
}

// A handle { done: Promise, stop() } like audio-out's. Muted: nothing is played but the time passes.
export function playSpan(url, from, to, { rate = 1 } = {}) {
  stopCurrent();
  const duration = Math.max(0, to - from);
  let finish;
  const done = new Promise((r) => { finish = r; });
  let timer = null;
  const h = { done, duration, stop() { clearTimeout(timer); player?.pause(); if (current === h) current = null; finish(); } };
  current = h;
  if (isMuted()) { timer = setTimeout(() => h.stop(), duration * 1000); return h; }
  (async () => {
    player ??= new Audio();
    player.pause();
    player.src = await srcFor(url);
    player.addEventListener('loadedmetadata', () => {
      player.playbackRate = rate;
      player.currentTime = from;
      player.play().catch(() => h.stop());
      const watch = () => { if (current !== h) return; if (player.currentTime >= to) h.stop(); else requestAnimationFrame(watch); };
      requestAnimationFrame(watch);
    }, { once: true });
  })();
  return h;
}

export function playClip(samples, { from = 0, to = null } = {}) {
  stopCurrent();
  const h = playSamples(samples, 16000, { offset: from, length: to === null ? undefined : to - from });
  current = h;
  h.done.then(() => { if (current === h) current = null; });
  return h;
}

export function stopCurrent() { current?.stop(); current = null; player?.pause(); }

export async function uncacheSurah(url) { blobUrls.delete(url); return 'caches' in self ? (await caches.open(CACHE)).delete(url) : false; }
export async function surahSize(url) { try { return Number((await fetch(url, { method: 'HEAD' })).headers.get('content-length') || 0); } catch { return 0; } }
