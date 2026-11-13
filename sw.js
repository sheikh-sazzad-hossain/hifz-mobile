/* Service worker: offline use + cross-origin isolation (GitHub Pages cannot send the COOP/COEP headers that
   multi-threaded WASM needs, so this adds them to every response).
   Same-origin files: network first, copy kept for offline; big immutable files (model, vendor, fonts, data)
   come from the cache first. Cross-origin requests (Quran.com audio and text) pass through untouched except
   that they may be kept for offline replay by the page itself (Cache Storage 'hifz-media-v1'). */
const APP = 'hifz-app-v1';
const IMMUTABLE = /\/(models|vendor|fonts)\//;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function isolate(res) {
  if (res.status === 0 || res.type === 'opaque') return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || (req.cache === 'only-if-cached' && req.mode !== 'same-origin')) return;
  const url = new URL(req.url);
  // Cross-origin (Alafasy's mp3, Quran.com): not handled here at all. A response that passes through this worker
  // is refused by the isolated page (media element "Format error"); the browser's own credentialless fetch works.
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(APP);
    const keep = async (res) => { if (res.ok && res.status === 200) await cache.put(req, res.clone()).catch(() => {}); return res; };
    if (IMMUTABLE.test(url.pathname)) {
      const hit = (await caches.match(req)) || (await caches.match(url.pathname.slice(1)));
      if (hit) return isolate(hit);
      return isolate(await keep(await fetch(req)));
    }
    try { return isolate(await keep(await fetch(req))); } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return isolate(hit);
      throw err;
    }
  })());
});
