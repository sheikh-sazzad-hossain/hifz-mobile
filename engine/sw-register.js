// Registers sw.js (offline + cross-origin isolation). The first visit reloads once so the isolation headers apply.
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return { ok: false, why: 'no service worker here' };
  try {
    const reg = await navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname });
    await navigator.serviceWorker.ready;
    if (!window.crossOriginIsolated && !sessionStorage.getItem('sw-reloaded')) {
      sessionStorage.setItem('sw-reloaded', '1');
      location.reload();
      return { ok: true, reloading: true };
    }
    return { ok: true, scope: reg.scope };
  } catch (e) { return { ok: false, why: String(e.message ?? e) }; }
}
