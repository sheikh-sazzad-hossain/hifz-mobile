// Progress > মুখস্থ: the memorisation tracker screen (spec C3 §9.2). Only the user marks memorisation.
import { t, esc, toast, confirmDlg } from './ui.js';
import { openPicker } from './picker.js';
import * as quran from '../core/quran.js';
import { resolve, addMemorized, removeSurahMemorized, memorizedSummary, suggestMemorized, setDivisions, normalizeMemorized } from '../core/ranges.js';
import { bn, isoLocal } from '../core/bn.js';
import { fill } from '../core/fmt.js';

export function createMemorizedUi({ el, store, history, settings, onChange }) {
  const get = () => store.get('memorized', { ranges: [] });
  const save = async (ranges) => { await store.set('memorized', { ranges }); onChange?.(); draw(); };
  const today = () => isoLocal(new Date()).slice(0, 10);

  function draw() {
    const m = get();
    const sum = memorizedSummary(m.ranges);
    const sug = suggestMemorized(history.sessions(), m.ranges, settings.get('history.good'));
    const rows = [...sum.per].map(([s, c]) => {
      const info = quran.surahInfo(s);
      return `<div class="mm-row"><div class="mm-main"><b>${bn(s)}. ${esc(info.english)}</b> <span class="hp-ar">${esc(info.name)}</span><div class="hp-bar"><i style="width:${Math.round((100 * c) / info.ayahs)}%"></i></div>
        <small>${esc(t('m.cover', { c: bn(c), n: bn(info.ayahs) }))}</small></div><button class="btn" data-mm="edit" data-s="${s}">${esc(t('m.edit'))}</button><button class="btn btn-red" data-mm="rm" data-s="${s}">${esc(t('m.remove'))}</button></div>`;
    }).join('');
    const sugRows = sug.map(([s, a, b], i) => `<div class="mm-row"><div class="mm-main">${esc(t('m.sugRow', { n: bn(s), english: quran.surahInfo(s).english, a: bn(a), b: bn(b) }))}</div><button class="btn" data-mm="sg" data-i="${i}">${esc(t('m.sgAdd'))}</button></div>`).join('');
    el.innerHTML = `<h3 class="hp-h">${esc(t('m.title'))}</h3>${m.ranges.length ? `<p class="hp-note">${esc(t('m.summary', { n: bn(sum.ayahs), s: bn(sum.surahs) }))}</p>${rows}` : `<p class="hp-empty">${esc(t('m.empty'))}</p>`}
      <div class="btn-row"><button class="btn btn-primary" data-mm="add">${esc(t('m.add'))}</button></div>
      ${sug.length ? `<h3 class="hp-h">${esc(t('m.sgTitle'))}</h3>${sugRows}<div class="btn-row"><button class="btn" data-mm="sgall">${esc(t('m.sgAddAll'))}</button></div>` : ''}`;
    el._sug = sug;
  }
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mm]');
    if (!b) return;
    const m = get();
    const act = b.dataset.mm;
    if (act === 'add') openPicker({ memorized: m, onUse: (spec) => save(addMemorized(m.ranges, resolve(spec, m), today())) });
    else if (act === 'edit') openPicker({ spec: { parts: [{ k: 'surah', s: Number(b.dataset.s) }] }, memorized: m, onUse: (spec) => save(addMemorized(m.ranges, resolve(spec, m), today())) });
    else if (act === 'rm') { const s = Number(b.dataset.s); if (await confirmDlg(t('m.removeQ', { english: quran.surahInfo(s).english }))) save(removeSurahMemorized(m.ranges, s)); }
    else if (act === 'sg') save(addMemorized(m.ranges, [el._sug[Number(b.dataset.i)]], today()));
    else if (act === 'sgall') save(addMemorized(m.ranges, el._sug, today()));
  });
  return { draw, ranges: () => get().ranges, normalize: normalizeMemorized, setDivisions, toast };
}
