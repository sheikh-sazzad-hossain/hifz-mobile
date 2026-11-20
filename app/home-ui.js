// C20 হোম tab (the user's picture of 2026-11-20): greeting + Hijri / Gregorian date, the memorisation ring, streak and
// today's (or yesterday's) activity, "আজকের আয়াত", four shortcut tiles, the resume button, and the empty / success states.
// Everything shown comes from the existing data (memorised list, sessions, goals, streak, last recitation place); the
// choices are pure functions in core/home.js. Buttons only open existing screens (মুখস্থ with a range, টেস্ট, শোনা, picker).
import * as quran from '../core/quran.js';
import * as indopak from '../core/indopak.js';
import * as G from '../core/goals.js';
import * as H from '../core/home.js';
import { resolve } from '../core/ranges.js';
import { bn, isoLocal } from '../core/bn.js';
import { pctText } from '../core/fmt.js';
import { lang } from '../core/i18n.js';
import { ICONS } from './icons.js';
import { openPicker } from './picker.js';
import { t, esc, sheet, $ } from './ui.js';

const TR_DIR = '../data/tr-bn-bengali-v1/'; // Tanzil bn.bengali (Muhiuddin Khan), one file per surah, cache-first in sw.js

export function createHomeUi({ S, goRecite, selectTab, openMemorized }) {
  const trCache = new Map();
  let picks = {};

  const kv = (k, d) => S.store.get(k, d) ?? d;
  const name = (s) => quran.surahLabel(s);
  const place = (r) => t('hm.place', { name: name(r.s), a: bn(r.a1), b: bn(r.a2) });

  function dateLine() {
    const d = new Date();
    const code = lang();
    const hj = H.hijriText(d, code);
    return [hj, H.gregText(d, code)].filter(Boolean).map((x) => `<span>${esc(bn(x))}</span>`).join('<i aria-hidden="true"></i>');
  }

  function ring(pct) {
    const r = 40;
    const c = 2 * Math.PI * r;
    const off = c * (1 - pct / 100);
    return `<div class="hm-ring" role="img" aria-label="${esc(pctText(pct))}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="hm-track" cx="50" cy="50" r="${r}"/>`
      + (pct ? `<circle class="hm-arc" cx="50" cy="50" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" style="--c:${c.toFixed(2)}"/>` : '') + `</svg><b><bdi dir="ltr">${esc(pctText(pct))}</bdi></b></div>`;
  }

  function ayahHtml(s, a) {
    const words = (indopak.ayahWords(s, a) ?? []).filter(Boolean).join(' ');
    const text = words; // the number sits in its own circle (as in the picture), so the font's ayah-end sign is not repeated
    const tr = lang() === 'bn';
    return `<div class="card hm-ayah" id="hm-ayah"><div class="hm-label">${esc(t('hm.ayahTitle'))}</div>`
      + `<div class="hm-ar-row"><span class="hm-num" aria-hidden="true">${esc(bn(a))}</span><div class="hm-ar" lang="ar" dir="rtl">${esc(text)}</div></div>`
      + `<div class="hm-ref">${esc(t('hm.ayahRef', { name: name(s), a: bn(a) }))}</div>`
      + (tr ? `<div class="hm-tr" id="hm-tr" aria-busy="true"><i class="sk"></i><i class="sk sk-s"></i></div>` : '')
      + '</div>';
  }

  async function fillTranslation(s, a) {
    const el = $('hm-tr');
    if (!el) return;
    try {
      if (!trCache.has(s)) trCache.set(s, fetch(new URL(`${TR_DIR}${String(s).padStart(3, '0')}.json`, import.meta.url)).then((r) => (r.ok ? r.json() : null)).catch(() => null));
      const list = await trCache.get(s);
      const line = list?.[a - 1];
      const now = $('hm-tr');
      if (!now) return;
      if (!line) { now.remove(); trCache.delete(s); return; }
      now.removeAttribute('aria-busy');
      now.innerHTML = `<p><b>${esc(t('hm.trans'))}</b> ${esc(line)}</p><small>[${esc(name(s))} ${esc(bn(`${s}:${a}`))}]</small>`;
    } catch { $('hm-tr')?.remove(); }
  }

  const tile = (act, icon, label) => `<button class="hm-tile" data-hm="${act}">${ICONS[icon]}<span>${esc(label)}</span></button>`;
  const row = (act, icon, title, sub) => `<button class="hm-row" data-hm="${act}"><span class="hm-row-ico">${ICONS[icon]}</span><span class="hm-row-main"><b>${esc(title)}</b><small>${esc(sub)}</small></span>${ICONS.chevron}</button>`;

  function draw() {
    const el = $('hm-body');
    if (!el || !S.history || !S.goalsUi) return;
    const nm = S.settings.get('view.name');
    $('hm-hello').textContent = nm ? t('hm.hello', { name: nm }) : t('hm.helloNo');
    $('hm-date').innerHTML = dateLine();
    const latin = document.querySelector('.hz-latin');
    if (latin) latin.hidden = t('app.title') === latin.textContent; // Latin-script packs already call the app "Hifzun Noor"

    const ranges = kv('memorized', { ranges: [] }).ranges ?? [];
    const sessions = S.history.sessions();
    const d = S.goalsUi.data();
    const dayStart = S.settings.get('goals.dayStart');
    const today = G.dayKey(isoLocal(new Date()), dayStart);
    const act = H.dayActivity(d.recs, (iso) => G.dayKey(iso, dayStart), today, G.addDays(today, -1));
    const prog = H.memorizedProgress(ranges);
    const goals = d.goals.filter(({ g }) => !g.paused).length;
    const state = H.homeState({ sessions: sessions.length, ranges: ranges.length, others: kv('manual', []).length + kv('tests', []).length, goals, goalsDoneToday: d.doneDay(today), todayCounted: d.streak.todayCounted });
    const lastRecite = S.ui?.lastRecite ?? null;
    const [as, aa] = H.ayahOfDay({ lastRecite, sessions });
    picks = { resume: H.resumePlace({ lastRecite, sessions }), sabqi: H.pickSabqi({ ranges, sessions, lastRecite }), manzil: H.pickManzil({ ranges, sessions }) };
    const todaySessions = sessions.filter((x) => x.kind !== 'test' && G.dayKey(x.start, dayStart) === today && x.ayahs?.length);
    const doneRange = todaySessions.length ? { s: todaySessions.at(-1).surah, a1: Math.min(...todaySessions.at(-1).ayahs), a2: Math.max(...todaySessions.at(-1).ayahs) } : null;

    const ringCard = `<div class="card hm-ring-card">${ring(prog.pct)}<div class="hm-ring-main"><h2 class="hm-h">${esc(t('hm.progress'))}</h2>`
      + `<div class="hm-line">${esc(t('hm.juz', { n: bn(prog.juzDone), t: bn(prog.juzTotal) }))}<button class="hm-info" data-hm="info" aria-label="${esc(t('hm.infoAria'))}">${ICONS.info}</button></div>`
      + (prog.ayahs ? `<div class="hm-line">${esc(t('hm.ayahs', { n: bn(prog.ayahs.toLocaleString('en-IN')) }))}</div>` : `<button class="hm-hint" data-hm="mem">${esc(t('hm.ringEmpty'))}</button>`)
      + '</div></div>';
    const statCard = `<div class="card hm-stats"><div class="hm-stat">${ICONS.calendar}<div><small>${esc(t('hm.streak'))}</small><b>${esc(t('hm.days', { n: bn(d.streak.current) }))}</b></div></div>`
      + `<div class="hm-stat">${ICONS.clock}<div><small>${esc(t(act.when === 'today' ? 'hm.today' : 'hm.yesterday'))}</small><b>${esc(t('hm.activity', { m: bn(act.minutes), a: bn(act.ayahs) }))}</b></div></div></div>`;
    const tiles = `<div class="hm-tiles">${tile('sabqi', 'bookOpen', t('hm.sabqi'))}${tile('manzil', 'layers', t('hm.manzil'))}${tile('listen', 'headphones', t('hm.listen'))}${tile('test', 'calendarCheck', t('hm.selfTest'))}</div>`;
    const resume = picks.resume
      ? `<button class="hm-main" data-hm="resume">${ICONS.bookOpen}<span class="hm-main-txt"><b>${esc(t('hm.resume'))}</b><small>${esc(place(picks.resume))}</small></span>${ICONS.chevron}</button>`
      : `<button class="hm-main" data-hm="start">${ICONS.bookOpen}<span class="hm-main-txt"><b>${esc(t('hm.start'))}</b></span>${ICONS.chevron}</button>`;
    const empty = `<div class="card hm-empty"><div class="hm-empty-ico">${ICONS.bookOpen}</div><h2 class="hm-h">${esc(t('hm.emptyTitle'))}</h2><p>${esc(t('hm.emptyBody'))}</p>`
      + `<button class="hm-main" data-hm="start">${ICONS.bookOpen}<span class="hm-main-txt"><b>${esc(t('hm.start'))}</b></span>${ICONS.chevron}</button></div>`;
    const success = `<div class="card hm-done"><div class="hm-done-ico">${ICONS.tick}</div><h2 class="hm-h">${esc(t('hm.doneTitle'))}<br>${esc(t('hm.doneBody'))}</h2>`
      + (doneRange ? `<small>${esc(place(doneRange))}</small>` : '') + '</div>'
      + `<div class="card hm-next"><h2 class="hm-h">${esc(t('hm.next'))}</h2>`
      + row('sabqi', 'layers', t('hm.sabqiRow'), picks.sabqi ? place(picks.sabqi) : t('hm.pickSub'))
      + row('manzil', 'layers', t('hm.manzil'), picks.manzil ? place(picks.manzil) : t('hm.pickSub'))
      + row('listen', 'headphones', t('hm.listenRow'), picks.resume ? place(picks.resume) : t('hm.pickSub'))
      + row('test', 'calendarCheck', t('hm.testRow'), t('hm.testSub')) + '</div>';

    let html;
    if (state === 'success') html = success + ringCard + statCard + ayahHtml(as, aa);
    else if (state === 'empty') html = ringCard + statCard + ayahHtml(as, aa) + tiles + empty;
    else html = ringCard + statCard + ayahHtml(as, aa) + tiles + resume;
    el.innerHTML = html;
    el.dataset.state = state;
    el.removeAttribute('aria-busy');
    fillTranslation(as, aa);
  }

  function pickThen(go) { // no stretch known: the range picker, then মুখস্থ with the first stretch chosen
    const mem = kv('memorized', { ranges: [] });
    openPicker({ memorized: mem, onUse: (spec) => { const run = resolve(spec, mem)[0]; if (run) go({ s: run[0], a1: run[1], a2: run[2] }); } });
  }

  function onClick(e) {
    const b = e.target.closest('[data-hm]');
    if (!b) return;
    const a = b.dataset.hm;
    if (a === 'info') {
      const sh = sheet(`<h2>${esc(t('hm.progress'))}</h2><p class="hm-sheet-p">${esc(t('hm.ringInfo', { total: bn(6236) }))}</p><div class="btn-row"><button class="btn btn-primary" data-x="mem">${esc(t('hm.openList'))}</button></div>`);
      sh.el.addEventListener('click', (ev) => { if (ev.target.closest('[data-x="mem"]')) { sh.close(); openMemorized(); } });
    } else if (a === 'mem') openMemorized();
    else if (a === 'listen') selectTab('listen');
    else if (a === 'test') selectTab('test');
    else if (a === 'start') { if (picks.resume) goRecite(picks.resume); else selectTab('recite'); }
    else if (a === 'resume' || a === 'sabqi' || a === 'manzil') { const r = picks[a]; if (r) goRecite(r); else pickThen(goRecite); }
  }
  $('panel-home').addEventListener('click', onClick);

  return { draw, picks: () => picks };
}
