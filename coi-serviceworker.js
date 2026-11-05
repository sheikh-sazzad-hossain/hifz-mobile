/* Cross-origin isolation for GitHub Pages, which cannot send custom headers.
   Multi-threaded WASM needs SharedArrayBuffer, and that needs the COOP + COEP headers.
   This file runs twice: as a normal <script> it registers itself as a service worker and
   reloads the page once; as the service worker it adds the headers to every response.
   Same idea as coi-serviceworker by Guido Zuidhof (MIT). */
if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
    event.respondWith((async () => {
      const res = await fetch(req);
      if (res.status === 0) return res; // opaque or redirect: pass through untouched
      const headers = new Headers(res.headers);
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    })());
  });
} else if (!window.crossOriginIsolated && window.isSecureContext && navigator.serviceWorker) {
  const reloadOnce = () => {
    if (sessionStorage.getItem('coi-reloaded')) return; // never loop
    sessionStorage.setItem('coi-reloaded', '1');
    location.reload();
  };
  navigator.serviceWorker.register(document.currentScript.src).then((reg) => {
    if (reg.active && !navigator.serviceWorker.controller) reloadOnce();
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => sw.state === 'activated' && reloadOnce());
    });
  }, (err) => console.warn('COOP/COEP service worker failed:', err));
}
