// Small shared UI helpers: strings (data/ui-strings.json), toast with an optional action, confirm dialog, bottom sheet.
import { t, setBase } from '../core/i18n.js';

export const setStrings = setBase; // the Bengali source table; the selected language pack is set with core/i18n.js setPack
export { t };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (id) => document.getElementById(id);

// toast('text') or toast('text', { action: 'label', onAction, ms }); the old call toast(msg, ms) still works
export function toast(msg, opt = 3500) {
  const o = typeof opt === 'number' ? { ms: opt } : opt;
  const el = $('toast');
  el.replaceChildren(Object.assign(document.createElement('span'), { textContent: msg }));
  if (o.action) {
    const b = Object.assign(document.createElement('button'), { textContent: o.action, type: 'button' });
    b.addEventListener('click', () => { el.hidden = true; o.onAction?.(); });
    el.append(b);
  }
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, o.action ? 6000 : (o.ms ?? 3500));
}

// confirmDlg('question', { ok: 'OK label', cancel: 'No label' }) -> Promise<boolean>; the labels default to the language's OK / No
export function confirmDlg(text, { ok = t('c.ok'), cancel = t('c.no'), danger = false } = {}) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'dlg';
    d.innerHTML = `<p>${esc(text)}</p><div class="btn-row"><button class="btn" data-v="0">${esc(cancel)}</button><button class="btn ${danger ? 'btn-red' : 'btn-primary'}" data-v="1">${esc(ok)}</button></div>`;
    d.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) { d.close(b.dataset.v); } });
    d.addEventListener('close', () => { resolve(d.returnValue === '1'); d.remove(); });
    document.body.append(d);
    d.showModal();
  });
}

// A bottom sheet: sheet(html, { onClose }) -> { el, close() }; tapping the scrim closes it.
export function sheet(html, { onClose, cls = '' } = {}) {
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const el = document.createElement('div');
  el.className = `sheet ${cls}`;
  el.setAttribute('role', 'dialog');
  el.innerHTML = `<div class="grab"></div>${html}`;
  document.body.append(scrim, el);
  const api = { el, close() { scrim.remove(); el.remove(); onClose?.(); } };
  scrim.addEventListener('click', api.close);
  return api;
}
