// The range picker (spec C3 §9.1): a bottom sheet to choose surahs / juz / hizb / pages / ayahs, with a summary bar.
//   openPicker({ spec, memorized, onUse(spec), onSave(spec, name, icon), saveOk: true })
import { sheet, t, esc } from './ui.js';
import { ICONS } from './icons.js';
import * as quran from '../core/quran.js';
import { resolve, countAyahs, dragSelect } from '../core/ranges.js';
import { bn } from '../core/bn.js';

export const RANGE_ICONS = ['book', 'star', 'moon', 'flag', 'leaf', 'heart', 'bookmark', 'sun'];
const ICON_PATHS = { star: 'm12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.7 5.8 21l1.2-6.8-5-4.9 6.9-1z', leaf: 'M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z', heart: 'M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z', bookmark: 'm19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z', flag: 'M4 22V4M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1' };
export function rangeIcon(name) {
  if (ICONS[name]) return ICONS[name];
  if (name === 'moon') return ICONS.moon;
  if (name === 'sun') return ICONS.sun;
  return `<svg class="hz-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON_PATHS[name] ?? ICON_PATHS.star}"/></svg>`;
}

const label = (p) => {
  if (p.k === 'surah') return `${bn(p.s)}. ${quran.surahInfo(p.s).english}`;
  if (p.k === 'ayahs') return `${quran.surahInfo(p.s).english} ${bn(p.from)}–${bn(p.to)}`;
  if (p.k === 'juz') return t('pk.l.juz', { n: bn(p.n) });
  if (p.k === 'hizb') return t('pk.l.hizb', { n: bn(p.n) });
  if (p.k === 'rub') return t('pk.l.rub', { n: bn(p.n) });
  if (p.k === 'page') return t('pk.l.page', { n: bn(p.n) });
  if (p.k === 'pages') return t('pk.l.pages', { a: bn(p.from), b: bn(p.to) });
  return t('pk.l.mem');
};
export const specLabel = (spec) => (spec?.parts ?? []).map(label).join(', ');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function openPicker({ spec = null, memorized = null, onUse, onSave = null, startUnit = 'surah' } = {}) {
  let parts = JSON.parse(JSON.stringify(spec?.parts ?? []));
  let unit = startUnit;
  let quarters = false;
  let page = { from: 1, to: 1 };
  let ay = { s: 1, from: 1, to: 7 };
  const sh = sheet('<div class="pk"></div>', { cls: 'pk-sheet' });
  const root = sh.el.querySelector('.pk');
  const has = (p) => parts.some((x) => same(x, p));
  const toggle = (p) => { parts = has(p) ? parts.filter((x) => !same(x, p)) : [...parts, p]; };
  const chip = (p, text) => `<button class="chip" aria-pressed="${has(p)}" data-p='${esc(JSON.stringify(p))}'>${esc(text)}</button>`;

  function body() {
    if (unit === 'surah') return `<div class="pk-grid">${Array.from({ length: 114 }, (_, i) => chip({ k: 'surah', s: i + 1 }, `${bn(i + 1)}. ${quran.surahInfo(i + 1).english}`)).join('')}</div>`;
    if (unit === 'juz') return `<div class="pk-grid pk-5">${Array.from({ length: 30 }, (_, i) => chip({ k: 'juz', n: i + 1 }, bn(i + 1))).join('')}</div>`;
    if (unit === 'hizb') {
      return `<label class="pk-q"><input type="checkbox" data-q ${quarters ? 'checked' : ''}> ${esc(t('pk.quarters'))}</label><div class="pk-grid pk-5">${quarters
        ? Array.from({ length: 240 }, (_, i) => chip({ k: 'rub', n: i + 1 }, bn(i + 1))).join('') : Array.from({ length: 60 }, (_, i) => chip({ k: 'hizb', n: i + 1 }, bn(i + 1))).join('')}</div>`;
    }
    if (unit === 'page') {
      return `<p class="hp-note">${esc(t('pk.pageNote'))}</p><div class="pk-step">${t('pk.pageRange', { from: `<input type="number" class="fld" min="1" max="604" data-pg="from" value="${page.from}">`, to: `<input type="number" class="fld" min="1" max="604" data-pg="to" value="${page.to}">` })} <button class="btn" data-addpages>+</button></div>`
        + `<div class="pk-grid pk-5">${Array.from({ length: 31 }, (_, i) => `<button class="chip" data-pgrange="${i * 20 + 1}">${bn(i * 20 + 1)}–${bn(Math.min(604, i * 20 + 20))}</button>`).join('')}</div>`;
    }
    return `<div class="pk-step"><select class="fld" data-ays>${Array.from({ length: 114 }, (_, i) => `<option value="${i + 1}"${ay.s === i + 1 ? ' selected' : ''}>${bn(i + 1)}. ${esc(quran.surahInfo(i + 1).english)}</option>`).join('')}</select>
      <input type="number" class="fld" min="1" data-ay="from" value="${ay.from}"> – <input type="number" class="fld" min="1" data-ay="to" value="${ay.to}"> <button class="btn" data-addays>+</button></div>`;
  }
  function draw() {
    const runs = resolve({ parts }, memorized);
    const units = ['surah', 'juz', 'hizb', 'page', 'ayah'];
    const names = Object.fromEntries(units.map((u) => [u, t(`pk.u.${u}`)]));
    root.innerHTML = `<h2>${esc(t('pk.title'))}</h2><div class="seg" role="radiogroup">${units.map((u) => `<button role="radio" aria-checked="${u === unit}" data-u="${u}">${names[u]}</button>`).join('')}</div>
      <div class="pk-body">${body()}</div>
      <div class="pk-sum">${esc(t('pk.summary', { n: bn(countAyahs(runs)), parts: specLabel({ parts }) || '—' }))}</div>
      <div class="btn-row"><button class="btn" data-clear>${esc(t('pk.clear'))}</button>${onSave ? `<button class="btn" data-save ${parts.length ? '' : 'disabled'}>${esc(t('pk.save'))}</button>` : ''}<button class="btn btn-primary" data-use ${parts.length ? '' : 'disabled'}>${esc(t('pk.use'))}</button></div>`;
  }
  draw();
  // press-and-drag over chips selects (or, if the first chip was on, clears) the whole run; mouse starts at once,
  // touch after a short hold so the sheet still scrolls
  let drag = null;
  let noClick = false;
  const chipAt = (x, y) => { const c = document.elementFromPoint(x, y)?.closest?.('.pk-grid .chip[data-p]'); return c && root.contains(c) ? c : null; };
  const paint = () => root.querySelectorAll('.pk-grid .chip[data-p]').forEach((c) => c.setAttribute('aria-pressed', String(has(JSON.parse(c.dataset.p)))));
  root.addEventListener('pointerdown', (e) => {
    const c = e.target.closest?.('.pk-grid .chip[data-p]');
    if (!c || e.button > 0) return;
    const chips = [...root.querySelectorAll('.pk-grid .chip[data-p]')];
    drag = { chips, parts: chips.map((x) => JSON.parse(x.dataset.p)), base: parts, i0: chips.indexOf(c), i1: chips.indexOf(c), mode: has(JSON.parse(c.dataset.p)) ? 'clear' : 'select', on: e.pointerType === 'mouse', x: e.clientX, y: e.clientY, timer: null };
    if (!drag.on) drag.timer = setTimeout(() => { if (drag) { drag.on = true; navigator.vibrate?.(8); } }, 250);
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.on) { if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) { clearTimeout(drag.timer); drag = null; } return; } // moved before the hold: it is a scroll
    const c = chipAt(e.clientX, e.clientY);
    const i = c ? drag.chips.indexOf(c) : -1;
    if (i < 0 || i === drag.i1) return;
    drag.i1 = i;
    drag.moved = true;
    parts = dragSelect(drag.base, drag.parts, drag.i0, drag.i1, drag.mode);
    paint();
  });
  root.addEventListener('touchmove', (e) => { if (drag?.on) e.preventDefault(); }, { passive: false });
  const endDrag = () => {
    if (!drag) return;
    clearTimeout(drag.timer);
    const moved = drag.moved;
    drag = null;
    if (moved) { noClick = true; setTimeout(() => { noClick = false; }, 150); draw(); }
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);
  root.addEventListener('click', (e) => {
    if (noClick) { noClick = false; e.stopPropagation(); return; }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.u) { unit = b.dataset.u; draw(); return; }
    if (b.dataset.p) { toggle(JSON.parse(b.dataset.p)); draw(); return; }
    if (b.dataset.pgrange) { const f = Number(b.dataset.pgrange); parts.push({ k: 'pages', from: f, to: Math.min(604, f + 19) }); draw(); return; }
    if ('addpages' in b.dataset) { parts.push({ k: 'pages', from: Math.min(page.from, page.to), to: Math.max(page.from, page.to) }); draw(); return; }
    if ('addays' in b.dataset) { const n = quran.surahInfo(ay.s).ayahs; parts.push({ k: 'ayahs', s: ay.s, from: Math.max(1, Math.min(ay.from, n)), to: Math.max(1, Math.min(ay.to, n)) }); draw(); return; }
    if ('clear' in b.dataset) { parts = []; draw(); return; }
    if ('use' in b.dataset) { sh.close(); onUse({ parts }); return; }
    if ('save' in b.dataset) askName();
  });
  root.addEventListener('change', (e) => {
    const el = e.target;
    if ('q' in el.dataset) { quarters = el.checked; draw(); }
    else if (el.dataset.pg) page[el.dataset.pg] = Math.max(1, Math.min(604, Number(el.value) || 1));
    else if (el.dataset.ays) { ay = { s: Number(el.value), from: 1, to: quran.surahInfo(Number(el.value)).ayahs }; draw(); }
    else if (el.dataset.ay) ay[el.dataset.ay] = Number(el.value) || 1;
  });
  function askName() {
    let icon = 'book';
    root.innerHTML = `<h2>${esc(t('pk.save'))}</h2><input class="fld" style="width:100%" data-name placeholder="${esc(t('pk.namePh'))}" maxlength="40">
      <div class="chips" style="margin:12px 0">${RANGE_ICONS.map((i) => `<button class="chip" aria-pressed="${i === icon}" data-icon="${i}">${rangeIcon(i)}</button>`).join('')}</div>
      <div class="btn-row"><button class="btn" data-back>←</button><button class="btn btn-primary" data-ok>${esc(t('pk.save'))}</button></div>`;
    root.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.icon) { icon = b.dataset.icon; root.querySelectorAll('[data-icon]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.icon === icon))); }
      else if ('back' in b.dataset) { root.onclick = null; draw(); }
      else if ('ok' in b.dataset) {
        const name = root.querySelector('[data-name]').value.trim() || specLabel({ parts }).slice(0, 40);
        if (onSave({ parts }, name, icon) !== false) sh.close();
      }
    };
  }
  return sh;
}
