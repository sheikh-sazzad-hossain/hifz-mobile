// The hifz app page: boot (data, store, model), the recitation session (record, pause, hint, eye, stop), the popups,
// the progress tab and the phone extras. The logic lives in core/ and engine/; this file wires it to the page.
// Test hooks: URL ?fakemic=<wav url>&fakespeed=1&mute=1&slow=N&threads=N ; window.hifz.
import { registerServiceWorker } from '../engine/sw-register.js';
import { createRecognizer, modelReady } from '../engine/asr.js';
import { openMic } from '../engine/mic.js';
import { tone } from '../engine/audio-out.js';
import * as quran from '../core/quran.js';
import * as alafasy from '../core/alafasy.js';
import * as indopak from '../core/indopak.js';
import { Follower, SAMPLE_RATE } from '../core/follower.js';
import { createTimer, formatTime } from '../core/timer.js';
import { createHistory } from '../core/history.js';
import { createFeedback } from '../core/feedback.js';
import { createReview } from '../core/review.js';
import { openStore, idbBackend, memoryBackend } from '../core/store.js';
import { bn, isoLocal, when } from '../core/bn.js';
import { ICONS } from './icons.js';
import { liveHtml, overviewHtml, weakHtml, esc } from './render.js';
import * as media from './media.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const S = { asr: null, store: null, history: null, feedback: null, review: null, fol: null, mic: null, running: false, look: false,
  settings: {}, clips: new Map(), recNames: new Set(), recCache: new Map(), lastVersion: -1, lastErrors: 0, lastStray: null, lastPrompt: null,
  prompting: null, lastIdx: null, started: null, tab: 'recite', weakSurah: null, ready: false };
window.hifz = S;

const toast = (msg, ms = 3500) => { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, ms); };

// ---------------------------------------------------------------- static parts
const WAIT_CHOICES = [['বন্ধ', 0], ...[1, 1.5, 2, 2.5, 3, 4, 5, 7, 10].map((s) => [`${s} সেকেন্ড`, s])];
const HELP = [
  '<b>মাইক বাটন</b> চাপো আর পড়া শুরু করো; কোন সূরা তা নিজে চিনে নেবে (চাইলে ওপরে বেছেও দিতে পারো)। <b>■</b> চাপলে সেশন শেষ ও জমা হবে।',
  'পড়তে পড়তে শব্দ খুলবে: <span class="hz-ok">সবুজ = সঠিক</span>, <span class="hz-bad">লাল = ভুল/বাদ</span> (সাথে সতর্ক-শব্দ), <span class="hz-hint">বেগুনি = ইঙ্গিত/আটকে যাওয়া</span>। নীল ঝলকানো ঘর = এখন যে শব্দ পড়ার কথা।',
  '<b>বিরতি</b> বাটনে থামাও, লাল শব্দ দেখে শোনো, তারপর একই বাটনে আবার চালু করো। চাইলে আগের আয়াত থেকে আবার পড়ে ভুলটা ঠিক করো, অ্যাপ সেখান থেকেই অনুসরণ করবে।',
  'এক সূরা শেষ করে পরের সূরা (বা অন্য যেকোনো সূরা) শুরু করলে অ্যাপ নিজেই সেখানে চলে যাবে — যতক্ষণ পড়বে ততক্ষণ অনুসরণ করবে।',
  '<b>চোখ বাটন</b> = দেখে পড়া (পুরো লেখা দেখা যায়) আর মুখস্থ (লেখা লুকানো)-র মধ্যে বদল।',
  'আটকে গেলে <b>ইঙ্গিত</b> চাপো, বা <b>চুপ থাকো</b> (ওপরের "থামলে আলাফাসি" সেটিংয়ে যত সেকেন্ড, শুরুতে ২): মিশারি আলাফাসি সেখান থেকে একটানা পড়ে যাবেন, শব্দগুলো বেগুনি হয়ে খুলবে। তুমি আবার পড়া শুরু করলে (বা বিরতি/থামাও চাপলে) উনি থেমে যাবেন, আর অ্যাপ তোমার পড়া শুনবে।',
  '<b>লাল শব্দে ক্লিক</b> করলে তুমি কী পড়েছ আর কী পড়া উচিত — দুটোই আশেপাশের শব্দসহ শুনতে পারবে। ঠিক পড়ে থাকলে ✓ চাপো।',
  'আগের সেশনে যেখানে ভুল/আটকে গিয়েছিলে সেই শব্দের ঘর <span class="hz-w1 hz-swatch">হালকা</span> থেকে <span class="hz-w3 hz-swatch">গাঢ় লাল</span> হয়ে থাকে; পরপর ৩ বার না দেখে ঠিক পড়লে দাগ চলে যায়।',
  'দাগটা ভুল মনে হলে (রেকর্ডিং না চলার সময়, বা <b>অগ্রগতি</b> ট্যাবে) লাল ঘরে ক্লিক করো: তখন কী পড়েছিলে শুনে <b>✓ ভুল দাগ — মুছে দাও</b> চাপো। দাগ মুছে যাবে, আর সেখানে ওভাবে পড়লে পরে আর ভুল ধরবে না।',
  '<b>অগ্রগতি</b> ট্যাবে প্রতিটা সূরার পাশে আয়াত ধরে একটা রঙিন পট্টি আছে — কোন আয়াতে দুর্বলতা বেশি (গাঢ় লাল), এক নজরে দেখা যায়। ঘরে ক্লিক করলে নিচে সেই আয়াত খুলবে।',
  'ফোনে: প্রথমবার মডেল (প্রায় ১৯ MB) নামবে, তারপর ইন্টারনেট ছাড়াই চলবে। সব ডেটা এই ফোনেই থাকে — <b>অগ্রগতি</b> ট্যাব থেকে ফাইলে ব্যাকআপ নিতে পারো। স্বয়ংক্রিয় যাচাই ভুল করতে পারে; এটা শিক্ষকের বিকল্প নয়।',
];

function buildStatic() {
  $('hero-ico').innerHTML = ICONS.book;
  $('theme-btn').innerHTML = ICONS.moon + ICONS.sun;
  $('tab-recite').innerHTML = `${ICONS.book}তিলাওয়াত`;
  $('tab-progress').innerHTML = `${ICONS.chart}অগ্রগতি`;
  $('rec').innerHTML = `<span class="mic">${ICONS.mic}</span><span class="stop">${ICONS.stop}</span>`;
  $('hz-t-pause').innerHTML = ICONS.pause + ICONS.play;
  $('hz-t-look').innerHTML = ICONS.eye + ICONS.eyeOff;
  $('hz-t-hint').innerHTML = ICONS.bulb;
  $('help').innerHTML = HELP.map((h) => `<li>${h}</li>`).join('');
  const surah = $('s-surah');
  surah.innerHTML = '<option value="0">স্বয়ংক্রিয় — তিলাওয়াত শুনে নিজে খুঁজে নেবে</option>'
    + Array.from({ length: 114 }, (_, i) => { const n = quran.surahInfo(i + 1); return `<option value="${i + 1}">${n.number}. ${esc(n.english)} — ${esc(n.name)}</option>`; }).join('');
  $('s-wait').innerHTML = WAIT_CHOICES.map(([l, v]) => `<option value="${v}">${l}</option>`).join('');
}

// ---------------------------------------------------------------- theme and settings
function applyTheme() {
  const dark = S.settings.theme === 'dark' || (!S.settings.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0b1220' : '#0d9488';
}
const saveSettings = () => S.store.set('settings', S.settings);
function setLook(on) {
  S.look = on;
  document.body.classList.toggle('hz-look', on);
  $('hz-t-look').dataset.tip = on ? 'মুখস্থ: লেখা লুকাও' : 'দেখে পড়া: পুরো লেখা দেখাও';
  if (S.fol) S.fol.look = on;
  S.settings.look = on;
  saveSettings();
}

// ---------------------------------------------------------------- the follower
function surahChoice() {
  const s = Number($('s-surah').value);
  if (!s) return [null, 1, null];
  const count = quran.surahInfo(s).ayahs;
  const last = Math.min(Number($('s-last').value) || count, count);
  return [s, Math.max(1, Math.min(Number($('s-first').value) || 1, last)), last];
}

function makeFollower() {
  const [s, a, b] = surahChoice();
  const old = S.fol;
  const fol = new Follower(s, a, b, {
    history: { levels: (x) => S.history.levels(x), weakAttrs: (x) => S.history.weakAttrs(x) },
    feedback: S.feedback, alafasy: alafasy.follower, indopak: indopak.follower,
    pieceS: S.asr?.info?.slow > 1 || (S.asr?.info?.calibMs ?? 0) > 400 ? 8 : 20,
  });
  fol._leakSeen = old?._leakSeen ?? null;
  fol.waitS = Number($('s-wait').value);
  fol.look = S.look;
  S.fol = fol;
  S.lastVersion = -1;
  return fol;
}

// ---------------------------------------------------------------- rendering the live view
function render(force = false) {
  const fol = S.fol;
  if (!fol || (!force && fol.version === S.lastVersion)) return;
  S.lastVersion = fol.version;
  const v = fol.view();
  S.view = v;
  $('hz-live').innerHTML = liveHtml(v);
  syncUi(v);
  if (v.waiting) return;
  // current line second from the top (the fixed bar covers the lower screen)
  const next = document.querySelector('#hz-live [data-i]');
  if (next && next.dataset.i !== S.lastIdx) {
    S.lastIdx = next.dataset.i;
    const r = next.getBoundingClientRect();
    const text = next.closest('.hz-text');
    if (r.height && text) {
      const pitch = parseFloat(getComputedStyle(text).lineHeight) || r.height * 2;
      const off = (r.top + r.bottom) / 2 - (1.5 * pitch + 8);
      if (Math.abs(off) > pitch / 2) window.scrollBy({ top: off, behavior: 'smooth' });
    }
  }
}

function syncUi(v) {
  const live = !!v.running;
  if (live && (v.errors > S.lastErrors || (v.stray && v.stray.id !== S.lastStray))) tone(330, 0.32, 0.2); // error tone only while recording
  S.lastErrors = v.errors ?? 0;
  S.lastStray = v.stray ? v.stray.id : null;
  const p = v.prompt;
  if (p && p.id !== S.lastPrompt) { // Alafasy reciting on when the reciter is stuck
    S.lastPrompt = p.id;
    if (live) S.prompting = media.playSpan(p.src, Number(p.from), Number(p.to) + 0.1);
  }
  if (S.prompting && (!v.playing || !live)) { S.prompting.stop(); S.prompting = null; }
  const pause = $('hz-t-pause');
  pause.disabled = !(v.paused || live);
  pause.classList.toggle('is-paused', !!v.paused);
  pause.dataset.tip = v.paused ? 'চালিয়ে যাও — যেখানে থেমেছিলে সেখান থেকে' : 'বিরতি — যেখানে আছ সেখানেই থামবে, পরে আবার চালু করা যাবে';
}

// ---------------------------------------------------------------- recording
function setRecButton(on) {
  $('rec').classList.toggle('is-on', on);
  $('rec').dataset.tip = on ? 'থামাও — সেশন শেষ ও জমা হবে' : 'রেকর্ড শুরু — পড়া শুরু করো';
  $('rec').setAttribute('aria-label', on ? 'থামাও' : 'রেকর্ড');
  for (const id of ['s-surah', 's-first', 's-last']) $(id).disabled = on;
}

// recitation timer (core/timer.js): shown from start until the next start; refreshed by rAF/interval for display only
const timer = createTimer();
let timerTick = null;
function paintTimer() {
  const el = $('hz-timer');
  el.hidden = false;
  el.textContent = formatTime(timer.elapsedMs());
  el.classList.toggle('is-run', timer.running);
  el.classList.toggle('is-paused', !timer.running && !timer.stopped);
}
function timerLoop() { clearInterval(timerTick); paintTimer(); if (timer.running) timerTick = setInterval(paintTimer, 250); }
window.__timer = timer;

async function start() {
  if (S.running || !S.ready) return;
  $('hz-final').innerHTML = '';
  const fol = makeFollower();
  fol.started = new Date();
  S.started = fol.started;
  S.lastErrors = 0; S.lastStray = null; S.lastPrompt = null;
  timer.start(); timerLoop(); // starts the moment the button is pressed
  try {
    const fake = params.get('fakemic');
    S.mic = await openMic({
      onAudio: (x) => fol.addAudio(x),
      fake: fake ? { url: fake, speed: Number(params.get('fakespeed')) || 1, loop: params.get('fakeloop') === '1', onEnd: () => { if (params.get('fakestop') !== '0') stop(); } } : undefined,
    });
  } catch (e) {
    timer.stop(); timerLoop(); $('hz-timer').hidden = true;
    toast(`মাইক চালু হয়নি: ${e.message || e}`, 6000);
    return;
  }
  S.running = true;
  setRecButton(true);
  fol.start(S.asr);
  render(true);
  $('hz-status').textContent = 'শুনছি…';
}

async function stop() {
  if (!S.running) return;
  S.running = false;
  timer.stop(); timerLoop();
  const fol = S.fol;
  S.mic?.stop();
  S.mic = null;
  setRecButton(false);
  media.stopCurrent();
  $('hz-status').textContent = 'যাচাই করা হচ্ছে…';
  $('rec').disabled = true;
  try {
    await fol.finish(S.asr);
  } finally { $('rec').disabled = false; }
  $('hz-status').textContent = '';
  render(true);
  if (fol.len < SAMPLE_RATE) { $('hz-final').innerHTML = '<div class="hz-banner hz-paused">রেকর্ডিং খুব ছোট।</div>'; return; }
  if (fol.surah === null) {
    $('hz-final').innerHTML = '<div class="hz-banner hz-stray">কোনো আয়াতের সঙ্গে মেলেনি। আরেকটু লম্বা করে পড়ো, অথবা সূরা নিজে বেছে দাও।</div>';
    return;
  }
  const name = `${isoLocal(new Date()).replace(/[-:]/g, '').replace('T', '_')}.wav`;
  await S.store.putBlob('recordings', name, fol.audio.slice()); // kept for later review
  S.recNames.add(name);
  const entries = S.history.record(fol, S.started ?? new Date(), fol.len / SAMPLE_RATE, name);
  await S.store.set('sessions', S.history.data.sessions); await S.store.set('weak', S.history.data.weak);
  if (entries.length) {
    const parts = entries.map((e) => `সূরা ${esc(quran.surahInfo(e.surah).english)}: ${bn(e.words)} শব্দ, নির্ভুলতা ${bn(e.accuracy)}%, ভুল ${bn(e.missed)}, আটকে যাওয়া ${bn(e.stuck)}`).join('; ');
    $('hz-final').innerHTML = `<div class="hz-done">সেশন জমা হয়েছে — ${parts}। অগ্রগতি ট্যাবে সব দেখতে পাবে।</div>`;
  }
  refreshProgress();
}

async function togglePause() {
  const fol = S.fol;
  if (!fol || !S.running) return;
  if (fol.paused) { timer.resume(); timerLoop(); S.mic?.resume(); fol.resume(S.asr); render(true); }
  else { timer.pause(); timerLoop(); S.mic?.pause(); await fol.pause(S.asr); render(true); }
}

// ---------------------------------------------------------------- popups
function popup() {
  let pop = $('pop');
  if (pop) return pop;
  pop = document.createElement('div');
  pop.id = 'pop';
  pop.className = 'hz-pop';
  pop.hidden = true;
  pop.innerHTML = `<div class="hz-card"><div class="hz-card-top"></div>
    <button class="hz-x hz-tip-left" data-tip="বন্ধ করো" aria-label="বন্ধ">${ICONS.x}</button>
    <div class="hz-card-body"><div class="hz-meta"></div><div class="hz-left" hidden></div>
      <div class="hz-row"><div class="hz-row-main"><div class="hz-lbl hz-said-lbl"></div><div class="hz-ar hz-said"></div></div>
        <button class="hz-round hz-mine" aria-label="আমার পড়া শুনি">${ICONS.headphones}</button></div>
      <div class="hz-row"><div class="hz-row-main"><div class="hz-lbl">যা পড়া উচিত</div><div class="hz-ar hz-should"></div></div>
        <button class="hz-round hz-right" data-tip="মিশারি আলাফাসির তিলাওয়াত (আশেপাশের শব্দসহ)" aria-label="আলাফাসির তিলাওয়াত">${ICONS.speaker}</button></div>
      <div class="hz-row hz-ok-row"><button class="hz-round hz-okbtn" aria-label="ঠিক পড়েছি">${ICONS.check}</button><div class="hz-ok-lbl"></div></div>
    </div></div>`;
  document.body.appendChild(pop);
  pop.addEventListener('click', (e) => { if (e.target === pop || e.target.closest('.hz-x')) closePopup(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopup(); });
  pop.querySelector('.hz-mine').addEventListener('click', async () => {
    const c = popup.current;
    if (!c) return;
    if (c.mode === 'err' && c.clip) media.playClip(c.clip);
    if (c.mode === 'wk' && c.rec) {
      const rec = await loadRecording(c.rec);
      if (rec) media.playClip(rec, { from: Number(c.rfrom), to: Number(c.rto) });
    }
  });
  pop.querySelector('.hz-right').addEventListener('click', () => { const c = popup.current; if (c?.src) media.playSpan(c.src, Number(c.from), Number(c.to) + 0.1); });
  pop.querySelector('.hz-okbtn').addEventListener('click', async () => {
    const c = popup.current;
    if (!c) return;
    closePopup();
    if (c.mode === 'err') {
      if (S.fol?.accept(c.k)) { toast('মনে রাখলাম — এখানে এভাবে পড়লে আর ভুল ধরবে না।'); await S.store.set('accepted', S.feedback.data); render(true); }
    } else await forgetMark(c.wk);
  });
  return pop;
}

function closePopup() { const p = $('pop'); if (p) p.hidden = true; media.stopCurrent(); }

const part = (cls, text) => { const s = document.createElement('span'); s.className = cls; s.textContent = text; return s; };

function openPopup(c) { // c: { mode: 'err' | 'wk', word, pre, post, heard, heardpre, clip | rec..., src... }
  const pop = popup();
  popup.current = c;
  const meta = pop.querySelector('.hz-meta');
  meta.hidden = c.mode === 'err';
  const left = pop.querySelector('.hz-left');
  left.hidden = !(c.mode === 'wk' && c.left > 0);
  left.replaceChildren();
  if (!left.hidden) {
    left.append(part('hz-left-main', `আর ${bn(c.left)} বার না দেখে সঠিক পড়লে লাল দাগ চলে যাবে`));
    left.append(part('hz-left-sub', (Number(c.streak) > 0 ? `এ পর্যন্ত পরপর ${bn(c.streak)} সেশন ঠিক হয়েছে। ` : '') +
      'প্রতি সেশনে একবার গোনা হয়, পরপর হতে হবে — মাঝে ভুল বা আটকালে গোনা আবার শুরু থেকে; দেখে পড়লে গোনা হয় না।'));
  }
  meta.textContent = c.mode === 'wk' ? `আগের সেশনে এখানে ${c.kind} — মোট ${bn(c.count)} বার, শেষবার ${c.last}` : '';
  pop.querySelector('.hz-said-lbl').textContent = c.mode === 'err' ? 'তুমি যা পড়েছ (মডেল যা শুনেছে)' : 'তখন তুমি যা পড়েছিলে (মডেল যা শুনেছিল)';
  const said = pop.querySelector('.hz-said');
  said.replaceChildren();
  if (c.heard || c.heardpre) {
    if (c.heardpre) said.append(part('hz-ctx', `${c.heardpre} `));
    said.append(part('hz-target', c.heard || '—'));
  } else said.textContent = c.mode === 'err' ? 'কিছু শোনা যায়নি — শব্দটা বাদ পড়েছে বলে মনে হচ্ছে' : 'তখনকার রেকর্ডিং পাওয়া যায়নি';
  said.classList.toggle('hz-none', !c.heard && !c.heardpre);
  const should = pop.querySelector('.hz-should');
  should.replaceChildren();
  if (c.pre) should.append(part('hz-ctx', `${c.pre} `));
  should.append(part('hz-target', c.word));
  if (c.post) should.append(part('hz-ctx', ` ${c.post}`));
  const mine = pop.querySelector('.hz-mine');
  mine.disabled = c.mode === 'err' ? !c.clip : !c.rec;
  mine.dataset.tip = c.mode === 'err' ? 'আমার পড়া শুনি (আগের দুই শব্দসহ)' : 'তখনকার আমার পড়া শুনি';
  pop.querySelector('.hz-right').disabled = !c.src;
  const ok = pop.querySelector('.hz-okbtn');
  ok.dataset.tip = c.mode === 'err' ? 'আমি সঠিকই পড়েছি — মডেল ভুল শুনেছে' : 'ঠিকই পড়েছিলাম — দাগ মুছে দাও, এভাবে পড়লে আর ভুল ধরবে না';
  pop.querySelector('.hz-ok-lbl').textContent = c.mode === 'err' ? 'আমি সঠিকই পড়েছি' : 'ভুল দাগ — মুছে দাও';
  pop.hidden = false;
}

function errorPopup(item) {
  const e = item.error;
  openPopup({ mode: 'err', k: e.k, word: e.word, pre: e.pre, post: e.post, heard: e.heard, heardpre: e.heardPre, clip: e.clip,
    src: e.alafasy?.[0], from: e.alafasy?.[1], to: e.alafasy?.[2] });
}

function markPopup(mark, info) { // a word marked from earlier sessions
  openPopup({ mode: 'wk', wk: `${mark.surah}:${mark.ayah}:${mark.wi}`, word: mark.word, pre: mark.pre, post: mark.post,
    kind: info?.kind, count: info?.count, left: info?.left, streak: info?.streak, last: info?.last ? when(info.last) : '', heard: info?.heard, heardpre: '',
    rec: info?.rec, rfrom: info?.rfrom, rto: info?.rto, src: info?.src, from: info?.from, to: info?.to });
}

async function loadRecording(name) {
  if (S.recCache.has(name)) return S.recCache.get(name);
  const r = await S.store.getBlob('recordings', name);
  if (r) S.recCache.set(name, r);
  return r;
}

async function preloadRecordingsOf(records, surah) { // review.clear needs the recordings of a mark's events
  for (const r of records) {
    for (const e of r.events ?? []) if (e.rec) await loadRecording(e.rec);
    const old = S.history.recordingOf(r, surah); // an older mark: found in its session's recording
    if (old) await loadRecording(old[0]);
  }
}

async function forgetMark(key) {
  const [s, a, k] = key.split(':').map(Number);
  const rec = S.history.weakRecords(s).find(([x, y]) => x === a && y === k);
  if (rec) await preloadRecordingsOf([rec[2]], s);
  const taught = await S.review.clear(S.asr, s, a, k);
  S.fol?.forgetMark(s, a, k);
  await persistAll();
  toast(`দাগ মুছে দিলাম${taught ? ' — এখানে এভাবে পড়লে আর ভুল ধরবে না।' : '।'}`);
  refreshProgress();
  render(true);
}

async function forgetSurah() {
  const s = S.weakSurah;
  if (!s) return;
  if (!confirm('এই সূরার সব লাল দাগ মুছে দেব? যেসব জায়গার রেকর্ডিং আছে, সেগুলো ঠিক পড়া হিসেবে মনে রাখা হবে — পরে একইভাবে পড়লে আর ভুল ধরবে না।')) return;
  const marked = S.history.weakRecords(s);
  await preloadRecordingsOf(marked.map((m) => m[2]), s);
  for (const [a, k] of marked) { await S.review.clear(S.asr, s, a, k); S.fol?.forgetMark(s, a, k); }
  await persistAll();
  toast(`${bn(marked.length)}টা দাগ মুছে দিলাম — এসব জায়গায় এভাবে পড়লে আর ভুল ধরবে না।`);
  refreshProgress();
  render(true);
}

async function persistAll() {
  await S.store.set('sessions', S.history.data.sessions);
  await S.store.set('weak', S.history.data.weak);
  await S.store.set('index', S.history.data.index);
  await S.store.set('accepted', S.feedback.data);
}

// ---------------------------------------------------------------- progress tab
function refreshProgress() {
  $('hp-overview').innerHTML = overviewHtml(S.history.overview());
  const practised = S.history.surahStats().map((x) => x.surah);
  const sel = $('hp-surah');
  if (!practised.includes(S.weakSurah)) S.weakSurah = practised[0] ?? null;
  sel.innerHTML = practised.map((n) => { const i = quran.surahInfo(n); return `<option value="${n}">${n}. ${esc(i.english)} — ${esc(i.name)}</option>`; }).join('');
  if (S.weakSurah) sel.value = String(S.weakSurah);
  renderWeak();
  S.store.blobNames('recordings').then(async (names) => {
    const bytes = await S.store.blobBytes('recordings');
    $('storage-info').textContent = `ফোনে জমা: ${bn(S.history.data.sessions.length)}টা সেশন-এন্ট্রি, ${bn(names.length)}টা রেকর্ডিং (${bn((bytes / 1048576).toFixed(1))} MB)।`;
  });
}

function renderWeak() {
  S.weakView = S.weakSurah ? S.history.weakView(S.weakSurah, indopak.ayahWords) : null;
  $('hp-weak').innerHTML = weakHtml(S.weakView);
  $('hp-clear-all').disabled = !S.weakView?.count;
}

function showAyahs(surah, from, to) {
  const text = document.querySelector('#hp-weak-box .hp-weak-text');
  if (!text || (surah && text.dataset.surah !== String(surah))) return false;
  const spans = [...text.querySelectorAll('[data-a]')].filter((s) => +s.dataset.a >= from && +s.dataset.a <= to);
  if (!spans.length) return false;
  spans[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  spans.forEach((s) => { s.classList.remove('hp-flash'); void s.offsetWidth; s.classList.add('hp-flash'); });
  setTimeout(() => spans.forEach((s) => s.classList.remove('hp-flash')), 2600);
  return true;
}

function selectTab(tab) {
  S.tab = tab;
  for (const t of ['recite', 'progress']) {
    $(`tab-${t}`).setAttribute('aria-selected', String(t === tab));
    $(`panel-${t}`).hidden = t !== tab;
  }
  if (tab === 'progress') refreshProgress();
}

// ---------------------------------------------------------------- backup, install, offline
async function exportData() {
  const obj = await S.store.exportAll();
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hifz-backup-${isoLocal(new Date()).slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function importData(file) {
  try {
    const obj = JSON.parse(await file.text());
    const merge = confirm('ফাইলের ডেটা এখনকার ডেটার সাথে মেলাবে? (OK = মেলাও, Cancel = এখনকার সব ডেটা ফাইলের ডেটা দিয়ে বদলে দাও)');
    await S.store.importAll(obj, { merge });
    toast('ডেটা ফেরত এসেছে — পাতা আবার খুলছে…');
    setTimeout(() => location.reload(), 900);
  } catch (e) { toast(`ফাইল পড়া যায়নি: ${e.message || e}`, 6000); }
}

// ---------------------------------------------------------------- boot
async function loadJson(path) { return (await fetch(new URL(`../data/${path}`, import.meta.url))).json(); }

async function boot() {
  const sw = await registerServiceWorker();
  if (sw.reloading) return;
  quran.setData(await loadJson('quran.json'));
  buildStatic();
  alafasy.setData(await loadJson('alafasy_words.json'));
  indopak.setData(await loadJson('indopak_words.json'));

  S.store = await openStore(params.get('memstore') === '1' ? memoryBackend() : idbBackend());
  S.settings = S.store.get('settings', {});
  const data = { sessions: S.store.get('sessions', []), weak: S.store.get('weak', {}), index: S.store.get('index', {}) };
  for (const n of await S.store.blobNames('recordings')) S.recNames.add(n);
  for (const n of await S.store.blobNames('clips')) S.clips.set(n, await S.store.getBlob('clips', n));
  S.history = createHistory({ data, persist: (k) => S.store.set(k, data[k]), hasRecording: (n) => S.recNames.has(n), alafasy: alafasy.follower });
  S.feedback = createFeedback({
    data: S.store.get('accepted', { places: {}, log: [] }), persist: () => S.store.set('accepted', S.feedback.data),
    getClip: (n) => S.clips.get(n), putClip: (n, s) => { S.clips.set(n, s); S.store.putBlob('clips', n, s); },
  });
  S.review = createReview({ history: S.history, feedback: S.feedback, getRecording: (n) => S.recCache.get(n), persist: () => S.store.set('index', data.index) });

  applyTheme();
  $('s-wait').value = String(S.settings.waitS ?? 2);
  setLook(!!S.settings.look);
  makeFollower();
  render(true);
  wireEvents();
  setInterval(() => { try { render(); } catch (e) { console.error(e); } }, 150);

  // the model: download (first visit only), then ready
  const card = $('modelcard');
  const cached = await modelReady();
  $('modeltext').textContent = cached ? 'মডেল তৈরি হচ্ছে…' : 'মডেল নামছে (প্রায় ১৯ MB, শুধু প্রথমবার)…';
  try {
    S.asr = await createRecognizer({ onProgress: ({ loaded, total }) => {
      $('modelbar').style.width = `${Math.min(100, (loaded / total) * 100)}%`;
      if (loaded >= total * 0.98) $('modeltext').textContent = 'মডেল তৈরি হচ্ছে…';
    } });
    $('modelbar').style.width = '100%';
    S.ready = true;
    card.hidden = true;
    $('rec').disabled = false;
    $('footer').textContent = `মডেল: quran-asr-tiny · ${S.asr.info.backend}, ${S.asr.info.threads} থ্রেড। প্রথমবারের পর ইন্টারনেট ছাড়াই চলবে। স্বয়ংক্রিয় যাচাই ভুল করতে পারে; এটা শিক্ষকের বিকল্প নয়।`;
  } catch (e) {
    $('modeltext').textContent = `মডেল চালু হয়নি: ${e.message || e}`;
    console.error(e);
  }
}

function wireEvents() {
  $('theme-btn').addEventListener('click', () => { S.settings.theme = document.documentElement.classList.contains('dark') ? 'light' : 'dark'; saveSettings(); applyTheme(); });
  $('tab-recite').addEventListener('click', () => selectTab('recite'));
  $('tab-progress').addEventListener('click', () => selectTab('progress'));
  $('rec').addEventListener('click', () => (S.running ? stop() : start()));
  $('hz-t-pause').addEventListener('click', togglePause);
  $('hz-t-hint').addEventListener('click', () => { S.fol?.hint(); render(true); });
  $('hz-t-look').addEventListener('click', () => setLook(!S.look));
  $('s-wait').addEventListener('change', () => { S.settings.waitS = Number($('s-wait').value); saveSettings(); if (S.fol) S.fol.waitS = S.settings.waitS; });
  const setup = () => { if (!S.running) { makeFollower(); render(true); } };
  $('s-surah').addEventListener('change', () => {
    const s = Number($('s-surah').value);
    $('l-first').hidden = $('l-last').hidden = !s;
    if (s) { $('s-first').value = 1; $('s-last').value = quran.surahInfo(s).ayahs; }
    setup();
  });
  $('s-first').addEventListener('change', setup);
  $('s-last').addEventListener('change', setup);
  document.addEventListener('click', (e) => {
    const err = e.target.closest('#hz-live [data-err]');
    if (err && S.view?.items) { errorPopup(S.view.items[+err.dataset.err]); return; }
    const mk = e.target.closest('#hz-live [data-mk]');
    if (mk && S.view?.items && !S.running) { const it = S.view.items[+mk.dataset.mk]; markPopup(it.mark, it.mark.info); return; }
    const wk = e.target.closest('#hp-weak [data-wkunit]');
    if (wk && S.weakView) {
      const u = S.weakView.units[+wk.dataset.wkunit];
      markPopup({ surah: S.weakView.surah, ayah: u.ayah, wi: u.wi, word: u.text, pre: u.pre, post: u.post }, u.info);
      return;
    }
    const go = e.target.closest('#hp-weak-box [data-goto]');
    if (go) { showAyahs(null, +go.dataset.goto, +(go.dataset.to || go.dataset.goto)); return; }
    const row = e.target.closest('#hp-overview tr.hp-go');
    if (row) {
      const cell = e.target.closest('.hp-strip [data-ayah]');
      S.weakSurah = Number(row.dataset.surah);
      $('hp-surah').value = String(S.weakSurah);
      renderWeak();
      if (cell) showAyahs(S.weakSurah, +cell.dataset.ayah, +cell.dataset.to);
      else document.querySelector('#hp-weak-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  $('hp-surah').addEventListener('change', () => { S.weakSurah = Number($('hp-surah').value); renderWeak(); });
  $('hp-clear-all').addEventListener('click', forgetSurah);
  $('btn-export').addEventListener('click', exportData);
  $('btn-import').addEventListener('click', () => $('file-import').click());
  $('file-import').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });
  let deferred = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('btn-install').hidden = false; });
  $('btn-install').addEventListener('click', async () => { if (deferred) { deferred.prompt(); deferred = null; $('btn-install').hidden = true; } });
}

// hooks for the browser tests
S.start = start; S.stop = stop; S.togglePause = togglePause; S.render = render; S.selectTab = selectTab; S.refreshProgress = refreshProgress;
boot().catch((e) => { console.error(e); toast(`শুরু করা যায়নি: ${e.message || e}`, 8000); });
