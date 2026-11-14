// App language: loads the selected pack (i18n/<code>.json, lazily, network-first through the service worker), sets <html lang dir>, the schema texts
// and the static texts of index.html (data-t="id" -> textContent, data-t-tip / data-t-aria / data-t-title -> attributes). Bengali is the source and needs no file.
import { LANG_CODES, setPack, localizeSchema, dir, t } from '../core/i18n.js';

const cache = new Map();
export async function loadPack(code) {
  if (code === 'bn' || !LANG_CODES.includes(code)) return {};
  if (cache.has(code)) return cache.get(code);
  let pack = {};
  try {
    const r = await fetch(new URL(`../i18n/${code}.json`, import.meta.url));
    if (r.ok) pack = await r.json();
  } catch { /* offline and not cached: Bengali is the fallback */ }
  cache.set(code, pack);
  return pack;
}

export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of root.querySelectorAll('[data-t-tip]')) el.dataset.tip = t(el.dataset.tTip);
  for (const el of root.querySelectorAll('[data-t-aria]')) el.setAttribute('aria-label', t(el.dataset.tAria));
  for (const el of root.querySelectorAll('[data-t-title]')) el.title = t(el.dataset.tTitle);
  document.title = t('app.title');
}

// returns the code in use; schema = the settings schema object (its texts are rewritten in place)
export async function applyLanguage(code, schema) {
  const pack = await loadPack(code);
  setPack(code, pack);
  if (schema) localizeSchema(schema, pack);
  const h = document.documentElement;
  h.lang = code;
  h.dir = dir(code);
  h.dataset.lang = code;
  applyStatic();
  return code;
}
