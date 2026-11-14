// Turning the Follower's view() and the history data into HTML, with the laptop app's classes (app/style.css).
// Events are attached by main.js through data attributes: data-err (red word index), data-mk (marked word: index
// into the view's items), data-i (the next word, kept in view), data-goto / data-to (ayahs), data-surah (progress rows).
import * as quran from '../core/quran.js';
import { t } from './ui.js';
import * as indopak from '../core/indopak.js';
import { bn, when, duration } from '../core/bn.js';
import { GOOD, FAIR, CLEAR_STREAK } from '../core/history.js'; // defaults; the history data carries the current values

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS_CLASS = { correct: 'hz-ok', missed: 'hz-bad', hint: 'hz-hint', pending: 'hz-pend', given: 'hz-given' };

function surahTitle(surah, ayah) {
  const info = quran.surahInfo(surah);
  let out = `<div class="hz-sura"><span class="hz-sura-ar">${esc(info.name)}</span><span class="hz-sura-bn">${esc(t('p.sura', { n: bn(surah), english: info.english }))}</span></div>`;
  if (ayah === 1 && surah !== 1 && surah !== 9) {
    out += `<div class="hz-basmala">${esc((indopak.ayahWords(1, 1) ?? [quran.BASMALA]).join(' '))}</div>`;
  }
  return out;
}

export const ayahEndHtml = (surah, ayah, attrs = '') => `<span class="hz-end"${attrs}>${esc(indopak.endMark(surah, ayah))}</span> `;

export function liveHtml(v) {
  if (v.waiting) {
    const paused = v.paused ? `<div class="hz-banner hz-paused">${esc(t('p.paused'))}</div>` : '';
    return `${paused}<div class="hz-wait">${t('p.waiting')}</div>`;
  }
  const out = [];
  v.items.forEach((it, idx) => {
    if (it.title) out.push(surahTitle(it.title.surah, it.title.ayah));
    const classes = [];
    let css = '';
    let data = '';
    if (it.weak) classes.push(`hz-w${it.weak}`);
    if (it.weak && it.status !== 'missed') { classes.push('hz-wk'); data += ` data-mk="${idx}"`; }
    if (it.status === null) {
      classes.push('hz-hid');
      if (it.here) { classes.push('hz-next'); data += ` data-i="${v.pos}"`; }
    } else {
      classes.push(STATUS_CLASS[it.status]);
      if (it.fresh !== undefined) { classes.push('hz-fresh'); css = ` style="animation-delay:${(it.fresh * 0.08).toFixed(2)}s"`; }
      if (it.status === 'missed') { classes.push('hz-err'); data += ` data-err="${idx}"`; }
      if (it.block) classes.push('hz-block-word');
      if (it.here) { classes.push('hz-here'); data += ` data-i="${v.pos}"`; }
    }
    out.push(`<span class="${classes.join(' ')}"${css}${data}>${esc(it.text)}</span>`);
    out.push(it.ayahEnd ? ` ${ayahEndHtml(it.ayahEnd.surah, it.ayahEnd.ayah, ` data-es="${it.ayahEnd.surah}" data-ea="${it.ayahEnd.ayah}"`)}` : ' ');
  });
  const h = v.head;
  const live = v.running ? 1 : 0;
  let head = `<div class="hz-head"><span class="hz-surah">${bn(h.surah)}. ${esc(h.english)} <span class="hz-surah-ar">${esc(h.arabic)}</span></span>`
    + (v.auto ? `<span class="hz-auto">${esc(t('p.autoDetected'))}</span>` : '')
    + `<span class="hz-count">${esc(t('p.hCount', { a: bn(h.ayah), n: bn(h.ayahs) }))}</span><span class="hz-stat hz-ok">${esc(t('p.hOk', { n: bn(h.said) }))}</span>`
    + `${v.mistakeList ? `<button class="hz-stat hz-bad" data-act="mlist" data-tip="${esc(t('r.listTip'))}">${esc(t('p.hBad', { n: bn(h.missed) }))}</button>` : `<span class="hz-stat hz-bad">${esc(t('p.hBad', { n: bn(h.missed) }))}</span>`}<span class="hz-stat hz-hint">${esc(t('p.hHint', { n: bn(h.hints) }))}</span></div>`;
  if (v.stray) {
    head += `<div class="hz-banner hz-stray">${esc(t('p.stray', { english: v.stray.english, ayah: bn(v.stray.ayah), current: v.stray.current }))}</div>`;
  }
  if (v.block) head += `<div class="hz-banner hz-block">${esc(t('r.blockBanner'))}</div>`;
  if (v.paused) {
    head += `<div class="hz-banner hz-paused">${esc(t('p.pausedBanner'))}</div>`;
  }
  return `${head}<div class="hz-text" data-errors="${v.errors}" data-live="${live}" data-paused="${v.paused ? 1 : 0}">${out.join('')}</div>`;
}

// --- progress tab ---

const cellClass = (lvl, recited) => (lvl || recited ? `hp-ay${lvl}` : 'hp-ayn');
const spanBn = (a, b) => (a === b ? t('fmt.ayah1', { a: bn(a) }) : t('fmt.ayahN', { a: bn(a), b: bn(b) }));
const cellTip = (a, b, words, recited) => (words ? t('p.cellWeak', { span: spanBn(a, b), n: bn(words) }) : `${spanBn(a, b)}: ${t(recited ? 'p.cellOk' : 'p.cellNone')}`);

export function overviewHtml(o) {
  if (o.empty) return `<div class="hp-empty">${esc(t('p.empty'))}</div>`;
  const cards = [['hp-c1', o.cards.sessions, t('p.cSessions')], ['hp-c2', o.cards.surahs, t('p.cSurahs')], ['hp-c3', o.cards.minutes, t('p.cMinutes')], ['hp-c4', o.cards.week, o.cards.weekDays === 7 ? t('p.cWeek') : t('p.cWeekN', { n: bn(o.cards.weekDays) })]]
    .map(([c, v, l]) => `<div class="hp-card ${c}"><div class="hp-num">${bn(v)}</div><div class="hp-lbl">${l}</div></div>`).join('');
  const rows = o.rows.map((st) => {
    const info = quran.surahInfo(st.surah);
    const acc = st.accuracy !== null ? `${bn(st.accuracy)}%` : '—';
    const strip = st.strip.map((c) => `<i class="${cellClass(c.level, c.recited)}" data-ayah="${c.first}" data-to="${c.last}" title="${esc(cellTip(c.first, c.last, c.words, c.recited))}"></i>`).join('');
    return `<tr class="hp-go" data-surah="${st.surah}"><td><b>${bn(st.surah)}. ${esc(info.english)}</b> <span class="hp-ar">${esc(info.name)}</span></td>`
      + `<td><span class="hp-chip ${st.grade.cls}">${st.grade.label}</span></td><td class="hp-n">${acc}</td>`
      + `<td><div class="hp-bar"><i style="width:${st.pct}%"></i></div><small>${esc(t('p.ayahCount', { a: bn(st.covered), n: bn(st.ayahs) }))}</small></td>`
      + `<td><div class="hp-strip">${strip}</div><small>${esc(t('p.weakCount', { n: bn(st.weak) }))}</small></td><td class="hp-n">${bn(st.sessions)}</td><td>${when(st.last)}</td></tr>`;
  }).join('');
  const th = (ids) => ids.map((i) => `<th>${esc(t(`p.th.${i}`))}</th>`).join('');
  const table = `<div class="hp-scroll"><table class="hp-table"><thead><tr>${th(['surah', 'state', 'acc', 'read', 'weak', 'sessions', 'last'])}</tr></thead>`
    + `<tbody>${rows}</tbody></table></div>`;
  const modes = { look: t('p.mode.look'), hifz: t('p.mode.hifz'), mixed: t('p.mode.mixed') };
  const recent = o.recent.map((s) => {
    const info = quran.surahInfo(s.surah);
    const a = s.ayahs;
    const span = a.length === 1 ? bn(a[0]) : bn(`${a[0]}–${a.at(-1)}`);
    return `<tr class="hp-go" data-surah="${s.surah}"><td>${when(s.start)}</td><td>${esc(info.english)} <small>(${span})</small></td>`
      + `<td><span class="hp-mode hp-m-${s.mode}">${modes[s.mode]}</span></td><td class="hp-n">${bn(s.words)}</td><td class="hp-n">${bn(s.accuracy)}%</td>`
      + `<td class="hp-n hp-red">${bn(s.missed)}</td><td class="hp-n hp-violet">${bn(s.stuck)}</td><td>${duration(s.seconds)}</td></tr>`;
  }).join('');
  const sessions = `<div class="hp-scroll"><table class="hp-table"><thead><tr>${th(['when', 'surahAyah', 'mode', 'words', 'acc2', 'missed', 'stuck', 'time'])}</tr></thead>`
    + `<tbody>${recent}</tbody></table></div>`;
  const key = (c, txt) => `<span class="hp-key">${c}${esc(txt)}</span>`;
  const keys = [key('<i class="hp-ay0"></i>', t('p.key0')), key('<i class="hp-ay1"></i><i class="hp-ay2"></i><i class="hp-ay3"></i>', t('p.key1')), key('<i class="hp-ayn"></i>', t('p.key2'))];
  return `<div class="hp-cards">${cards}</div><h3 class="hp-h">${esc(t('p.bySurah'))}</h3>${table}`
    + `<p class="hp-note">${esc(t('p.stateNote', { w: bn(o.window ?? 3), good: bn(o.good ?? GOOD), fair: bn(o.fair ?? FAIR) }))}<br>`
    + `${esc(t('p.weakNote', { k0: '\u0001', k1: '\u0002', k2: '\u0003' })).replace('\u0001', keys[0]).replace('\u0002', keys[1]).replace('\u0003', keys[2])}</p>`
    + (o.noRecent ? '' : `<h3 class="hp-h">${esc(t('p.recent'))}</h3>${sessions}`);
}

export function weakHtml(w) {
  if (!w) return '';
  const buttons = w.cells.map((c) => `<button class="hp-cell ${cellClass(c.level, c.recited)}" data-goto="${c.ayah}" title="${esc(cellTip(c.ayah, c.ayah, c.words, c.recited))}">${bn(c.ayah)}</button>`).join('');
  const chips = w.zones.map(([f, l, words], n) => `<button class="hp-hot-chip" data-goto="${f}" data-to="${l}" title="${esc(t('p.hotChipTip'))}">${bn(n + 1)}. ${spanBn(f, l)} · ${esc(t('p.weakCount', { n: bn(words) }))}</button>`).join('');
  const hot = chips ? `<div class="hp-hot"><span class="hp-hot-lbl">${esc(t('p.hotLabel'))}</span>${chips}</div>` : '';
  const legend = `<div class="hp-legend"><span class="hp-key"><i class="hp-ay0"></i>${esc(t('p.legend1'))}</span><span class="hp-key"><i class="hp-ay1"></i><i class="hp-ay2"></i><i class="hp-ay3"></i>${esc(t('p.legend2'))}</span>`
    + `<span class="hp-key"><i class="hp-ayn"></i>${esc(t('p.legend3'))}</span></div>`;
  const map = `<div class="hp-map"><div class="hp-map-title">${esc(t('p.mapTitle'))}<small>${esc(t('p.mapSub'))}</small></div><div class="hp-cells">${buttons}</div>${hot}${legend}</div>`;
  const out = [];
  w.units.forEach((u, i) => {
    out.push(u.level ? `<span class="hz-w${u.level} hz-wk" data-a="${u.ayah}" data-wkunit="${i}">${esc(u.text)}</span> ` : `<span data-a="${u.ayah}">${esc(u.text)}</span> `);
    if (u.end) out.push(ayahEndHtml(w.surah, u.ayah, ` data-a="${u.ayah}"`));
  });
  const head = w.count
    ? `<p class="hp-note">${t('p.weakHead', { n: bn(w.count), clear: bn(w.clear ?? CLEAR_STREAK) })}</p>`
    : `<p class="hp-note">${esc(t('p.noWeak'))}</p>`;
  return `${map}${head}<div class="hz-text hp-weak-text" data-surah="${w.surah}">${out.join('')}</div>`;
}
