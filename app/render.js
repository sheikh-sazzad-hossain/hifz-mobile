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
  let out = `<div class="hz-sura"><span class="hz-sura-ar">${esc(info.name)}</span><span class="hz-sura-bn">সূরা ${bn(surah)}. ${esc(info.english)}</span></div>`;
  if (ayah === 1 && surah !== 1 && surah !== 9) {
    out += `<div class="hz-basmala">${esc((indopak.ayahWords(1, 1) ?? [quran.BASMALA]).join(' '))}</div>`;
  }
  return out;
}

export const ayahEndHtml = (surah, ayah, attrs = '') => `<span class="hz-end"${attrs}>${esc(indopak.endMark(surah, ayah))}</span> `;

export function liveHtml(v) {
  if (v.waiting) {
    const paused = v.paused ? '<div class="hz-banner hz-paused">বিরতি — আবার চালু করলে শোনা শুরু হবে।</div>' : '';
    return `${paused}<div class="hz-wait">শুনছি… পড়া শুরু করো, কয়েকটা শব্দ শুনেই <b>সূরা নিজে চিনে নেবে</b>।</div>`;
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
    + (v.auto ? '<span class="hz-auto">স্বয়ংক্রিয়ভাবে চেনা</span>' : '')
    + `<span class="hz-count">আয়াত ${bn(h.ayah)} / ${bn(h.ayahs)}</span><span class="hz-stat hz-ok">সঠিক ${bn(h.said)}</span>`
    + `${v.mistakeList ? `<button class="hz-stat hz-bad" data-act="mlist" data-tip="${esc(t('r.listTip'))}">ভুল/বাদ ${bn(h.missed)}</button>` : `<span class="hz-stat hz-bad">ভুল/বাদ ${bn(h.missed)}</span>`}<span class="hz-stat hz-hint">ইঙ্গিত ${bn(h.hints)}</span></div>`;
  if (v.stray) {
    head += `<div class="hz-banner hz-stray">ভুল: এটা সূরা ${esc(v.stray.english)}-এর আয়াত ${bn(v.stray.ayah)}-এর মতো শোনাচ্ছে। তুমি সূরা ${esc(v.stray.current)} পড়ছিলে, নীল চিহ্ন দেওয়া শব্দ থেকে আবার পড়ো।</div>`;
  }
  if (v.block) head += `<div class="hz-banner hz-block">${esc(t('r.blockBanner'))}</div>`;
  if (v.paused) {
    head += '<div class="hz-banner hz-paused">বিরতি: লাল শব্দে ক্লিক করে দেখো ও শোনো। আবার চালু করলে এখান থেকেই শুনবে; চাইলে আগের আয়াত থেকে আবার পড়ে লাল শব্দ ঠিক করতে পারো।</div>';
  }
  return `${head}<div class="hz-text" data-errors="${v.errors}" data-live="${live}" data-paused="${v.paused ? 1 : 0}">${out.join('')}</div>`;
}

// --- progress tab ---

const cellClass = (lvl, recited) => (lvl || recited ? `hp-ay${lvl}` : 'hp-ayn');
const spanBn = (a, b) => (a === b ? `আয়াত ${bn(a)}` : `আয়াত ${bn(a)}–${bn(b)}`);
const cellTip = (a, b, words, recited) => (words ? `${spanBn(a, b)}: ${bn(words)}টা দুর্বল শব্দ` : `${spanBn(a, b)}: ${recited ? 'ঠিক আছে' : 'এখনো না দেখে পড়া হয়নি'}`);

export function overviewHtml(o) {
  if (o.empty) return '<div class="hp-empty">এখনো কোনো সেশন নেই। তিলাওয়াত ট্যাবে রেকর্ড করে পড়ো, থামালে (■) সেশনটা এখানে জমা হবে।</div>';
  const cards = [['hp-c1', o.cards.sessions, 'মোট সেশন'], ['hp-c2', o.cards.surahs, 'সূরা অনুশীলন'], ['hp-c3', o.cards.minutes, 'মোট মিনিট'], ['hp-c4', o.cards.week, o.cards.weekDays === 7 ? 'এই সপ্তাহে' : `শেষ ${bn(o.cards.weekDays)} দিনে`]]
    .map(([c, v, l]) => `<div class="hp-card ${c}"><div class="hp-num">${bn(v)}</div><div class="hp-lbl">${l}</div></div>`).join('');
  const rows = o.rows.map((st) => {
    const info = quran.surahInfo(st.surah);
    const acc = st.accuracy !== null ? `${bn(st.accuracy)}%` : '—';
    const strip = st.strip.map((c) => `<i class="${cellClass(c.level, c.recited)}" data-ayah="${c.first}" data-to="${c.last}" title="${esc(cellTip(c.first, c.last, c.words, c.recited))}"></i>`).join('');
    return `<tr class="hp-go" data-surah="${st.surah}"><td><b>${bn(st.surah)}. ${esc(info.english)}</b> <span class="hp-ar">${esc(info.name)}</span></td>`
      + `<td><span class="hp-chip ${st.grade.cls}">${st.grade.label}</span></td><td class="hp-n">${acc}</td>`
      + `<td><div class="hp-bar"><i style="width:${st.pct}%"></i></div><small>${bn(st.covered)}/${bn(st.ayahs)} আয়াত</small></td>`
      + `<td><div class="hp-strip">${strip}</div><small>${bn(st.weak)}টা দুর্বল শব্দ</small></td><td class="hp-n">${bn(st.sessions)}</td><td>${when(st.last)}</td></tr>`;
  }).join('');
  const table = '<div class="hp-scroll"><table class="hp-table"><thead><tr><th>সূরা</th><th>অবস্থা</th><th>সাম্প্রতিক নির্ভুলতা</th><th>কতটা পড়া হয়েছে</th><th>কোথায় দুর্বল</th><th>সেশন</th><th>শেষ অনুশীলন</th></tr></thead>'
    + `<tbody>${rows}</tbody></table></div>`;
  const modes = { look: 'দেখে', hifz: 'মুখস্থ', mixed: 'মিশ্র' };
  const recent = o.recent.map((s) => {
    const info = quran.surahInfo(s.surah);
    const a = s.ayahs;
    const span = a.length === 1 ? bn(a[0]) : bn(`${a[0]}–${a.at(-1)}`);
    return `<tr class="hp-go" data-surah="${s.surah}"><td>${when(s.start)}</td><td>${esc(info.english)} <small>(${span})</small></td>`
      + `<td><span class="hp-mode hp-m-${s.mode}">${modes[s.mode]}</span></td><td class="hp-n">${bn(s.words)}</td><td class="hp-n">${bn(s.accuracy)}%</td>`
      + `<td class="hp-n hp-red">${bn(s.missed)}</td><td class="hp-n hp-violet">${bn(s.stuck)}</td><td>${duration(s.seconds)}</td></tr>`;
  }).join('');
  const sessions = '<div class="hp-scroll"><table class="hp-table"><thead><tr><th>কখন</th><th>সূরা (আয়াত)</th><th>ধরন</th><th>শব্দ</th><th>নির্ভুলতা</th><th>ভুল</th><th>আটকে যাওয়া</th><th>সময়</th></tr></thead>'
    + `<tbody>${recent}</tbody></table></div>`;
  return `<div class="hp-cards">${cards}</div><h3 class="hp-h">সূরা অনুযায়ী মুখস্থের অবস্থা</h3>${table}`
    + `<p class="hp-note">অবস্থা: শেষ ${bn(o.window ?? 3)}টা মুখস্থ-সেশনের গড় নির্ভুলতা — ${bn(o.good ?? GOOD)}% বা বেশি = ভালো মুখস্থ, ${bn(o.fair ?? FAIR)}–${bn(o.good ?? GOOD)}% = মোটামুটি। দেখে পড়া সেশন এই হিসাবে ধরা হয় না।<br>`
    + 'কোথায় দুর্বল: প্রতিটা ঘর একটা আয়াত, বাঁ থেকে ডানে আয়াত ১ থেকে শেষ পর্যন্ত — <span class="hp-key"><i class="hp-ay0"></i>সবুজ = ঠিক আছে</span>, '
    + '<span class="hp-key"><i class="hp-ay1"></i><i class="hp-ay2"></i><i class="hp-ay3"></i>হালকা থেকে গাঢ় লাল = যত বেশি দুর্বল</span>, '
    + '<span class="hp-key"><i class="hp-ayn"></i>ধূসর = এখনো না দেখে পড়া হয়নি</span>। ঘরে ক্লিক করলে নিচে সেই আয়াতটা দেখাবে।</p>'
    + (o.noRecent ? '' : `<h3 class="hp-h">সাম্প্রতিক সেশন</h3>${sessions}`);
}

export function weakHtml(w) {
  if (!w) return '';
  const buttons = w.cells.map((c) => `<button class="hp-cell ${cellClass(c.level, c.recited)}" data-goto="${c.ayah}" title="${esc(cellTip(c.ayah, c.ayah, c.words, c.recited))}">${bn(c.ayah)}</button>`).join('');
  const chips = w.zones.map(([f, l, words], n) => `<button class="hp-hot-chip" data-goto="${f}" data-to="${l}" title="ক্লিক করলে নিচে দেখাবে">${bn(n + 1)}. ${spanBn(f, l)} · ${bn(words)}টা দুর্বল শব্দ</button>`).join('');
  const hot = chips ? `<div class="hp-hot"><span class="hp-hot-lbl">সবচেয়ে দুর্বল জায়গা:</span>${chips}</div>` : '';
  const legend = '<div class="hp-legend"><span class="hp-key"><i class="hp-ay0"></i>ঠিক আছে</span><span class="hp-key"><i class="hp-ay1"></i><i class="hp-ay2"></i><i class="hp-ay3"></i>হালকা থেকে গাঢ় লাল = যত বেশি দুর্বল শব্দ</span>'
    + '<span class="hp-key"><i class="hp-ayn"></i>এখনো না দেখে পড়া হয়নি</span></div>';
  const map = `<div class="hp-map"><div class="hp-map-title">আয়াত ধরে দুর্বলতার মানচিত্র<small>প্রতিটা ঘর একটা আয়াত — ক্লিক করলে নিচের লেখায় সেই আয়াতে যাবে</small></div><div class="hp-cells">${buttons}</div>${hot}${legend}</div>`;
  const out = [];
  w.units.forEach((u, i) => {
    out.push(u.level ? `<span class="hz-w${u.level} hz-wk" data-a="${u.ayah}" data-wkunit="${i}">${esc(u.text)}</span> ` : `<span data-a="${u.ayah}">${esc(u.text)}</span> `);
    if (u.end) out.push(ayahEndHtml(w.surah, u.ayah, ` data-a="${u.ayah}"`));
  });
  const head = w.count
    ? `<p class="hp-note">${bn(w.count)}টা দুর্বল শব্দ। হালকা লাল = মাঝেমধ্যে ভুল/আটকে যাও, গাঢ় লাল = বারবার। পরপর ${bn(w.clear ?? CLEAR_STREAK)} সেশন না দেখে ঠিক পড়লে দাগ চলে যায়। <b>লাল শব্দে ক্লিক করলে</b> তখন কী পড়েছিলে শুনতে পারবে; দাগটা ভুল হলে মুছে দিতে পারবে।</p>`
    : '<p class="hp-note">এই সূরায় কোনো দুর্বল জায়গা নেই — মাশাআল্লাহ!</p>';
  return `${map}${head}<div class="hz-text hp-weak-text" data-surah="${w.surah}">${out.join('')}</div>`;
}
