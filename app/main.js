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
import { Follower, SAMPLE_RATE, applyTuning } from '../core/follower.js';
import { tuningFrom, historyOptsFrom, feedbackOptsFrom, followerOptsFrom, micOptsFrom } from './engine-cfg.js';
import { createTimer, formatTime } from '../core/timer.js';
import { createHistory } from '../core/history.js';
import { createFeedback } from '../core/feedback.js';
import { createReview } from '../core/review.js';
import { openStore, idbBackend, memoryBackend } from '../core/store.js';
import { bn, isoLocal, when } from '../core/bn.js';
import { ICONS } from './icons.js';
import { liveHtml, overviewHtml, weakHtml, esc } from './render.js';
import * as media from './media.js';
import { createSettings } from '../core/settings.js';
import { applyView, isViewId, resolveTheme } from './view.js';
import { createSettingsUi } from './settings-ui.js';
import { setStrings, t, toast, confirmDlg, sheet, $ } from './ui.js';
import { num } from '../core/fmt.js';
import { setDivisions } from '../core/ranges.js';
import { createMemorizedUi } from './memorized-ui.js';
import { createTestUi } from './test-ui.js';
import { createListenUi } from './listen.js';
import { createGoalsUi } from './goals-ui.js';

const params = new URLSearchParams(location.search);
const S = { asr: null, store: null, history: null, feedback: null, review: null, fol: null, mic: null, running: false, look: false,
  settings: null, clips: new Map(), recNames: new Set(), recCache: new Map(), lastVersion: -1, lastErrors: 0, lastStray: null, lastPrompt: null,
  prompting: null, lastIdx: null, started: null, tab: 'recite', weakSurah: null, ready: false };
window.hifz = S;


// ---------------------------------------------------------------- static parts
const HELP = [
  '<b>মাইক বাটন</b> চাপো আর পড়া শুরু করো; কোন সূরা তা নিজে চিনে নেবে (চাইলে ওপরে বেছেও দিতে পারো)। <b>■</b> চাপলে সেশন শেষ ও জমা হবে।',
  'পড়তে পড়তে শব্দ খুলবে: <span class="hz-ok">সবুজ = সঠিক</span>, <span class="hz-bad">লাল = ভুল/বাদ</span> (সাথে সতর্ক-শব্দ), <span class="hz-hint">বেগুনি = ইঙ্গিত/আটকে যাওয়া</span>। নীল ঝলকানো ঘর = এখন যে শব্দ পড়ার কথা।',
  '<b>বিরতি</b> বাটনে থামাও, লাল শব্দ দেখে শোনো, তারপর একই বাটনে আবার চালু করো। চাইলে আগের আয়াত থেকে আবার পড়ে ভুলটা ঠিক করো, অ্যাপ সেখান থেকেই অনুসরণ করবে।',
  'এক সূরা শেষ করে পরের সূরা (বা অন্য যেকোনো সূরা) শুরু করলে অ্যাপ নিজেই সেখানে চলে যাবে — যতক্ষণ পড়বে ততক্ষণ অনুসরণ করবে।',
  '<b>চোখ বাটন</b> = দেখে পড়া (পুরো লেখা দেখা যায়) আর মুখস্থ (লেখা লুকানো)-র মধ্যে বদল।',
  'আটকে গেলে <b>ইঙ্গিত</b> চাপো, বা <b>চুপ থাকো</b> (ওপরের "থামলে আলাফাসি" সেটিংয়ে যত সেকেন্ড, শুরুতে ২): মিশারি আলাফাসি সেখান থেকে একটানা পড়ে যাবেন, শব্দগুলো বেগুনি হয়ে খুলবে। তুমি আবার পড়া শুরু করলে (বা বিরতি/থামাও চাপলে) উনি থেমে যাবেন, আর অ্যাপ তোমার পড়া শুনবে। ইঙ্গিত-বাটন চেপে ধরলে আয়াতের বাকিটা খুলবে।',
  '<b>লাল শব্দে ক্লিক</b> করলে তুমি কী পড়েছ আর কী পড়া উচিত — দুটোই আশেপাশের শব্দসহ শুনতে পারবে। ঠিক পড়ে থাকলে ✓ চাপো।',
  'আগের সেশনে যেখানে ভুল/আটকে গিয়েছিলে সেই শব্দের ঘর <span class="hz-w1 hz-swatch">হালকা</span> থেকে <span class="hz-w3 hz-swatch">গাঢ় লাল</span> হয়ে থাকে; পরপর ৩ বার না দেখে ঠিক পড়লে দাগ চলে যায়।',
  'দাগটা ভুল মনে হলে (রেকর্ডিং না চলার সময়, বা <b>অগ্রগতি</b> ট্যাবে) লাল ঘরে ক্লিক করো: তখন কী পড়েছিলে শুনে <b>✓ ভুল দাগ — মুছে দাও</b> চাপো। দাগ মুছে যাবে, আর সেখানে ওভাবে পড়লে পরে আর ভুল ধরবে না।',
  '<b>অগ্রগতি</b> ট্যাবে প্রতিটা সূরার পাশে আয়াত ধরে একটা রঙিন পট্টি আছে — কোন আয়াতে দুর্বলতা বেশি (গাঢ় লাল), এক নজরে দেখা যায়। ঘরে ক্লিক করলে নিচে সেই আয়াত খুলবে।',
  'ফোনে: প্রথমবার মডেল (প্রায় ১৯ MB) নামবে, তারপর ইন্টারনেট ছাড়াই চলবে। সব ডেটা এই ফোনেই থাকে — <b>অগ্রগতি</b> ট্যাব থেকে ফাইলে ব্যাকআপ নিতে পারো। স্বয়ংক্রিয় যাচাই ভুল করতে পারে; এটা শিক্ষকের বিকল্প নয়।',
];

// the help bullets quote current values (wait seconds, rounds to clear a mark): spec C3 §2.5
const HELP_EXTRA = 'ওপরের <b>ভুল/বাদ</b> গোনায় চাপলে এই সেশনের সব ভুল একসাথে দেখা যায়; ভুল না হলে <b>বাদ দাও</b>, দরকার হলে <b>ফেরাও</b>।';
function renderHelp() {
  const wait = S.settings ? S.settings.get('recite.waitS') : 2;
  const clear = S.settings ? S.settings.get('history.clearStreak') : 3;
  const list = HELP.map((h, i) => (i === 5 ? h.replace('শুরুতে ২', `শুরুতে ${num(wait)}`) : i === 7 ? h.replace('পরপর ৩ বার', `পরপর ${num(clear)} বার`).replace('পরপর ৩ সেশন', `পরপর ${num(clear)} সেশন`) : h));
  list.push(HELP_EXTRA);
  $('help').innerHTML = list.map((h) => `<li>${h}</li>`).join('');
}

function buildStatic() {
  $('hero-ico').innerHTML = ICONS.book;
  $('theme-btn').innerHTML = ICONS.moon;
  $('gear-btn').innerHTML = ICONS.gear;
  $('rec').innerHTML = `<span class="mic">${ICONS.mic}</span><span class="stop">${ICONS.stop}</span>`;
  $('hz-t-pause').innerHTML = ICONS.pause + ICONS.play;
  $('hz-t-look').innerHTML = ICONS.eye + ICONS.eyeOff;
  $('hz-t-hint').innerHTML = ICONS.bulb;
  const surah = $('s-surah');
  surah.innerHTML = '<option value="0">স্বয়ংক্রিয় — তিলাওয়াত শুনে নিজে খুঁজে নেবে</option>'
    + Array.from({ length: 114 }, (_, i) => { const n = quran.surahInfo(i + 1); return `<option value="${i + 1}">${n.number}. ${esc(n.english)} — ${esc(n.name)}</option>`; }).join('');
  fillWait();
}

// ---------------------------------------------------------------- settings (core/settings.js) and the look
function fillWait() { // the "wait" select on the recite page is the same setting as recite.waitS
  const d = S.settings?.def('recite.waitS');
  if (!d) return;
  const cur = S.settings.get('recite.waitS');
  const opts = d.options.map((o) => [o.label ?? `${num(o.v)} সেকেন্ড`, o.v]);
  if (!d.options.some((o) => o.v === cur)) opts.push([`${num(cur)} সেকেন্ড`, cur]);
  $('s-wait').innerHTML = opts.map(([l, v]) => `<option value="${v}">${l}</option>`).join('');
  $('s-wait').value = String(cur);
}
function setLook(on) { S.settings.set('recite.look', !!on); }
function applyLook() {
  const on = S.settings.get('recite.look');
  S.look = on;
  document.body.classList.toggle('hz-look', on);
  $('hz-t-look').dataset.tip = on ? 'মুখস্থ: লেখা লুকাও' : 'দেখে পড়া: পুরো লেখা দেখাও';
  if (S.fol) S.fol.look = on;
}
function renderLegend() { // view.legend: what each colour means, above the text
  const el = $('hz-legend');
  const on = S.settings.get('view.legend');
  el.hidden = !on;
  if (!on) return;
  const items = [['ok', '--w-ok'], ['bad', '--w-bad'], ['peek', '--w-peek'], ['pend', '--w-pend'], ['next', '--w-next-ring'], ['weak', '--w-3']];
  el.innerHTML = items.map(([k, v]) => `<span><i style="background:var(${v})"></i>${t(`r.lg.${k}`)}</span>`).join('');
}
function onSettingsChange(ids) {
  S.listenUi?.onSettings(ids);
  if (ids.includes('view.legend')) renderLegend();
  if (ids.some(isViewId)) applyView(S.settings.get);
  if (ids.includes('recite.look')) applyLook();
  if (ids.includes('history.clearStreak') || ids.includes('recite.waitS')) renderHelp();
  if (ids.includes('recite.waitS')) { fillWait(); if (S.fol) S.fol.waitS = S.settings.get('recite.waitS'); }
  if (ids.includes('view.theme')) S.settingsUi?.refresh();
  if (ids.some((id) => id.startsWith('view.') || id.startsWith('hide.'))) S.fol && render(true);
}
function cycleTheme() { // tap on the header button: paper -> night -> sepia
  const order = ['paper', 'night', 'sepia'];
  const cur = resolveTheme(S.settings.get('view.theme'));
  S.settings.set('view.theme', order[(order.indexOf(cur) + 1) % 3]);
}

// ---------------------------------------------------------------- the follower
function applyStartAt() { // recite.startAt: auto | last | continue (spec C3 §4.1)
  const mode = S.settings.get('recite.startAt');
  const last = S.ui?.lastRecite;
  if (mode === 'auto' || !last) return;
  let s = last.s;
  let a1 = last.a1;
  let a2 = last.a2;
  if (mode === 'continue') {
    const count = quran.surahInfo(s).ayahs;
    if (last.lastAyah >= count) { s += 1; a1 = 1; } else a1 = last.lastAyah + 1;
    if (s > 114) return;
    a2 = quran.surahInfo(s).ayahs;
  }
  $('s-surah').value = String(s);
  $('l-first').hidden = $('l-last').hidden = false;
  $('s-first').value = a1;
  $('s-last').value = a2;
}
window.hifzApplyStartAt = applyStartAt;

function surahChoice() {
  const s = Number($('s-surah').value);
  if (!s) return [null, 1, null];
  const count = quran.surahInfo(s).ayahs;
  const last = Math.min(Number($('s-last').value) || count, count);
  return [s, Math.max(1, Math.min(Number($('s-first').value) || 1, last)), last];
}

function followerDeps() {
  return {
    history: { levels: (x) => S.history.levels(x), weakAttrs: (x) => S.history.weakAttrs(x) },
    feedback: S.feedback, alafasy: alafasy.follower, indopak: indopak.follower,
    pieceS: S.settings.get('device.slowPhone') && (S.asr?.info?.slow > 1 || (S.asr?.info?.calibMs ?? 0) > 400) ? 8 : 20,
    opts: followerOptsFrom(S.settings.get),
  };
}
async function openMicSource(onAudio, onEnd) { // the microphone (or the fake one of hifzTest / ?fakemic=) for the test tab
  const over = S.fake;
  S.fake = null;
  const fake = params.get('fakemic');
  return openMic({ onAudio, ...micOptsFrom(S.settings.get),
    fake: over ? { url: over.url, speed: over.speed, loop: false, onEnd } : fake ? { url: fake, speed: Number(params.get('fakespeed')) || 1, loop: false, onEnd } : undefined });
}
function makeFollower() {
  if (!S.running) applyTuning(tuningFrom(S.settings.get)); // engine values only change while nothing runs
  const [s, a, b] = surahChoice();
  const old = S.fol;
  const fol = new Follower(s, a, b, followerDeps());
  fol._leakSeen = old?._leakSeen ?? null;
  fol.waitS = S.settings.get('recite.waitS');
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
  v.mistakeList = S.settings.get('recite.mistakeList');
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
      const mode = S.settings.get('view.scroll');
      const target = mode === 'middle' ? innerHeight * 0.4 : 1.5 * pitch + 8;
      const off = (r.top + r.bottom) / 2 - target;
      const smooth = document.documentElement.dataset.motion === 'full' && document.documentElement.dataset.live !== '1';
      if (mode !== 'off' && Math.abs(off) > pitch / 2) window.scrollBy({ top: off, behavior: smooth ? 'smooth' : 'auto' });
    }
  }
}

function errorTone() {
  const lvl = { off: 0, soft: 0.15, normal: 0.35, loud: 0.6 }[S.settings.get('detect.errorTone')];
  if (!lvl) return;
  const kind = S.settings.get('detect.toneKind');
  if (kind === 'two') { tone(440, 0.13, lvl); setTimeout(() => tone(260, 0.32, lvl), 130); }
  else if (kind === 'beep') tone(660, 0.18, lvl);
  else { tone(660, 0.1, lvl); setTimeout(() => tone(660, 0.1, lvl), 180); }
  if (S.settings.get('detect.vibrate')) navigator.vibrate?.(120);
}

function syncUi(v) {
  const live = !!v.running;
  if (live && (v.errors > S.lastErrors || (v.stray && v.stray.id !== S.lastStray))) errorTone(); // error tone only while recording
  S.lastErrors = v.errors ?? 0;
  S.lastStray = v.stray ? v.stray.id : null;
  const p = v.prompt;
  if (p && p.id !== S.lastPrompt) { // Alafasy reciting on when the reciter is stuck
    S.lastPrompt = p.id;
    if (live) S.prompting = media.playSpan(p.src, Number(p.from), Number(p.to) + 0.1); // the prompt always plays at 1x
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
    const over = S.fake; // set by hifzTest.simulate
    S.fake = null;
    S.mic = await openMic({
      onAudio: (x) => fol.addAudio(x),
      ...micOptsFrom(S.settings.get),
      fake: over ? { url: over.url, speed: over.speed, loop: false, onEnd: () => { if (over.stopAtEnd) stop().then(over.done); else over.done(); } }
        : fake ? { url: fake, speed: Number(params.get('fakespeed')) || 1, loop: params.get('fakeloop') === '1', onEnd: () => { if (params.get('fakestop') !== '0') stop(); } } : undefined,
    });
  } catch (e) {
    timer.stop(); timerLoop(); $('hz-timer').hidden = true;
    toast(`মাইক চালু হয়নি: ${e.message || e}`, 6000);
    return;
  }
  S.running = true;
  setLive();
  wakeLock(true);
  clearTimeout(S.maxTimer);
  const maxMin = S.settings.get('device.maxRecMin');
  if (maxMin) S.maxTimer = setTimeout(() => { if (S.running) { toast('সর্বোচ্চ রেকর্ডিং সময় পার — থামালাম।'); stop(); } }, maxMin * 60000);
  setRecButton(true);
  fol.start(S.asr);
  render(true);
  $('hz-status').textContent = 'শুনছি…';
}

async function stop() {
  if (!S.running) return;
  S.running = false;
  setLive();
  wakeLock(false);
  clearTimeout(S.maxTimer);
  timer.stop(); timerLoop();
  $('hz-timer').hidden = true;
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
  const keep = S.settings.get('history.saveRecordings');
  if (keep) { await S.store.putBlob('recordings', name, fol.audio.slice()); S.recNames.add(name); } // kept for later review
  const entries = S.history.record(fol, S.started ?? new Date(), fol.len / SAMPLE_RATE, keep ? name : null);
  await S.store.set('sessions', S.history.data.sessions); await S.store.set('weak', S.history.data.weak);
  if (entries.length) {
    const e0 = entries[0];
    S.ui = { ...S.ui, lastRecite: { s: e0.surah, a1: e0.ayahs[0], a2: e0.ayahs.at(-1), lastAyah: e0.ayahs.at(-1) } };
    S.store.set('ui', S.ui);
    const parts = entries.map((e) => `সূরা ${esc(quran.surahInfo(e.surah).english)}: ${bn(e.words)} শব্দ, নির্ভুলতা ${bn(e.accuracy)}%, ভুল ${bn(e.missed)}, আটকে যাওয়া ${bn(e.stuck)}`).join('; ');
    $('hz-final').innerHTML = `<div class="hz-done">সেশন জমা হয়েছে — ${parts}। অগ্রগতি ট্যাবে সব দেখতে পাবে।</div>`;
  }
  refreshProgress();
}

async function wakeLock(on) { // device.keepAwake: Screen Wake Lock while recording
  try {
    if (!on) { await S.wake?.release(); S.wake = null; return; }
    if (S.settings.get('device.keepAwake') && navigator.wakeLock) S.wake = await navigator.wakeLock.request('screen');
  } catch { /* not allowed: ignore */ }
}

function setLive() { document.documentElement.dataset.live = (S.running && !S.fol?.paused) || S.testLive ? '1' : '0'; }

async function togglePause() {
  const fol = S.fol;
  if (!fol || !S.running) return;
  if (fol.paused) { timer.resume(); timerLoop(); S.mic?.resume(); fol.resume(S.asr); setLive(); render(true); }
  else { timer.pause(); timerLoop(); S.mic?.pause(); await fol.pause(S.asr); setLive(); render(true); }
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
  pop.querySelector('.hz-right').addEventListener('click', () => { const c = popup.current; if (c?.src) media.playSpan(c.src, Number(c.from), Number(c.to) + 0.1, { rate: S.settings.get('audio.popupSpeed') }); });
  pop.querySelector('.hz-okbtn').addEventListener('click', async () => {
    const c = popup.current;
    if (!c) return;
    closePopup();
    if (c.mode === 'err') {
      if ((S.popFol ?? S.fol)?.remove(c.k)) { toast(S.settings.get('detect.teachOnRemove') ? t('r.removedTaught') : t('r.removed')); await S.store.set('accepted', S.feedback.data); render(true); }
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
  meta.textContent = c.mode === 'wk' ? `আগের সেশনে এখানে ${c.kind} — মোট ${bn(c.count)} বার, শেষবার ${c.last}${S.settings.get('history.popupTimes') && c.times ? ` · ${t('h.times', { t: bn(c.times), e: bn(c.count) })}` : ''}` : '';
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

function errorPopup(item, fol = null) {
  S.popFol = fol;
  const e = item.error;
  openPopup({ mode: 'err', k: e.k, word: e.word, pre: e.pre, post: e.post, heard: e.heard, heardpre: e.heardPre, clip: e.clip,
    src: e.alafasy?.[0], from: e.alafasy?.[1], to: e.alafasy?.[2] });
}

function markPopup(mark, info) { // a word marked from earlier sessions
  openPopup({ mode: 'wk', wk: `${mark.surah}:${mark.ayah}:${mark.wi}`, word: mark.word, pre: mark.pre, post: mark.post,
    kind: info?.kind, count: info?.count, times: info?.times, left: info?.left, streak: info?.streak, last: info?.last ? when(info.last) : '', heard: info?.heard, heardpre: '',
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

// ---------------------------------------------------------------- mistake list (spec C3 §6.1)
function mistakeRows() {
  const fol = S.fol;
  const units = fol.units();
  const rows = [];
  units.forEach((u, ui) => {
    const ks = u.filter((k) => fol.words[k].status === 'missed' || fol.words[k].removed || (fol.words[k].status === 'hint' && S.settings.get('peek.countsAsMistake')));
    if (!ks.length) return;
    const w = fol.words[ks[0]];
    const kind = w.status === 'hint' ? 'peek' : w.added ? 'added' : (w.heard ? 'changed' : 'skipped');
    const [pre, post] = fol._neighbours(ui, units, 2, 1);
    rows.push({ k: ks[0], removed: !!w.removed && w.status !== 'missed', kind: w.removed && w.status !== 'missed' ? (w.removed.added ? 'added' : w.removed.heard ? 'changed' : 'skipped') : kind, text: fol._unitText(u), pre, post, ayah: w.ayah, error: w.status === 'missed' ? { k: ks[0], word: fol._unitText(u), pre, post, heard: w.heard ?? '', heardPre: w.heardPre ?? '', clip: w.clipCtx ?? w.clip ?? null, alafasy: alafasy.follower.contextAudio(w.surah, w.ayah, w.wi, S.settings.get('audio.ctxBefore'), S.settings.get('audio.ctxAfter')) } : null });
  });
  return rows;
}
function openMistakeList() {
  const draw = () => {
    const rows = mistakeRows();
    const live = rows.filter((r) => !r.removed);
    const gone = rows.filter((r) => r.removed);
    const row = (r) => `<div class="ml-row"><div class="hz-ar ml-w"><span class="hz-ctx">${esc(r.pre)}</span> <b>${esc(r.text)}</b> <span class="hz-ctx">${esc(r.post)}</span></div>
      <div class="ml-m">${esc(t('r.ayahRef', { a: bn(r.ayah) }))} · ${esc(t(`r.kind.${r.kind}`))}</div>
      <div class="btn-row">${r.removed ? `<button class="btn" data-ml="restore" data-k="${r.k}">${esc(t('r.restore'))}</button>` : r.kind === 'peek' ? '' : `<button class="btn" data-ml="listen" data-k="${r.k}">${ICONS.speaker} ${esc(t('r.listen'))}</button><button class="btn" data-ml="remove" data-k="${r.k}">${esc(t('r.remove'))}</button>`}</div></div>`;
    sh.el.querySelector('.ml-body').innerHTML = (live.length ? live.map(row).join('') : `<p class="hp-note">${esc(t('r.empty'))}</p>`)
      + (gone.length ? `<h3 class="hp-h">${esc(t('r.removedTitle', { n: bn(gone.length) }))}</h3>${gone.map(row).join('')}` : '')
      + (live.some((r) => r.kind !== 'peek') ? `<div class="btn-row"><button class="btn btn-red" data-ml="all">${esc(t('r.removeAll'))}</button></div>` : '');
    sh.el.querySelector('h2').textContent = t('r.listTitle', { n: bn(live.filter((r) => r.kind !== 'peek').length) });
    return rows;
  };
  const sh = sheet(`<h2></h2><div class="ml-body"></div>`, { cls: 'ml' });
  let rows = draw();
  sh.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ml]');
    if (!b) return;
    const k = Number(b.dataset.k);
    if (b.dataset.ml === 'listen') { const r = rows.find((x) => x.k === k); if (r?.error) { sh.close(); openPopup({ mode: 'err', k, word: r.error.word, pre: r.error.pre, post: r.error.post, heard: r.error.heard, heardpre: r.error.heardPre, clip: r.error.clip, src: r.error.alafasy?.[0], from: r.error.alafasy?.[1], to: r.error.alafasy?.[2] }); } return; }
    if (b.dataset.ml === 'all') {
      if (!(await confirmDlg(t('r.removeAllQ')))) return;
      for (const r of rows) if (!r.removed && r.kind !== 'peek') S.fol.remove(r.k);
    } else if (b.dataset.ml === 'remove') {
      const w = S.fol.words[k];
      if (!S.running && S.fol.len) await forgetMark(`${w.surah}:${w.ayah}:${w.wi}`); // after stop: the saved mark is forgotten (§6.6)
      else { S.fol.remove(k); toast(S.settings.get('detect.teachOnRemove') ? t('r.removedTaught') : t('r.removed')); }
    } else if (b.dataset.ml === 'restore') { S.fol.restore(k); toast(t('r.restored')); }
    await S.store.set('accepted', S.feedback.data);
    render(true);
    rows = draw();
  });
}

// ---------------------------------------------------------------- progress tab
function refreshProgress() {
  if (S.running || S.testLive) return; // heavy screens are computed when the mic is off
  const ov = S.history.overview();
  ov.noRecent = true;
  $('hp-overview').innerHTML = overviewHtml(ov);
  $('hp-extra').innerHTML = S.goalsUi.summaryHtml();
  $('hp-recent').innerHTML = S.goalsUi.recentHtml();
  drawToday();
  S.goalsUi.afterSave();
  if (S.pview && S.pview !== 'overview') showProgressView(S.pview);
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

function drawToday() { const el = $('hz-today'); if (el) el.innerHTML = S.goalsUi?.todayHtml() ?? ''; }
S.drawToday = drawToday;
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

const TABS = [['recite', 'book'], ['test', 'card'], ['listen', 'speaker'], ['progress', 'chart']]; // টেস্ট and শোনা join here in their phases
const tabLabel = (id) => t(`nav.tab.${id}`);
function buildTabs() {
  const nav = $('tabs');
  nav.querySelectorAll('.tab').forEach((b) => b.remove());
  TABS.forEach(([id, icon]) => {
    const b = document.createElement('button');
    b.className = 'tab'; b.role = 'tab'; b.id = `tab-${id}`; b.setAttribute('aria-controls', `panel-${id}`); b.setAttribute('aria-selected', String(id === S.tab));
    b.innerHTML = `${ICONS[icon]}<span>${tabLabel(id)}</span>`;
    b.addEventListener('click', () => selectTab(id));
    nav.insertBefore(b, $('ribbon'));
  });
  nav.addEventListener('keydown', (e) => {
    const i = TABS.findIndex(([id]) => id === S.tab);
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (d) { selectTab(TABS[(i + d + TABS.length) % TABS.length][0]); $(`tab-${S.tab}`).focus(); }
  });
}
function placeRibbon() {
  const b = $(`tab-${S.tab}`);
  if (!b) return;
  $('ribbon').style.transform = `translateX(${b.offsetLeft}px) scaleX(${b.offsetWidth})`;
}
const PROGRESS_VIEWS = [['overview'], ['goals'], ['memorized'], ['tests'], ['badges']]; // more views are added by later phases
S.progressViews = PROGRESS_VIEWS;
function showProgressView(id) {
  S.pview = id;
  for (const [v] of PROGRESS_VIEWS) $(`pg-${v}`).hidden = v !== id;
  if (id === 'goals') $('pg-goals').innerHTML = S.goalsUi.goalsHtml();
  if (id === 'tests') $('pg-tests').innerHTML = S.goalsUi.testsHtml();
  if (id === 'badges') $('pg-badges').innerHTML = S.goalsUi.badgesHtml();
  if (id === 'overview') refreshProgress();
  document.querySelectorAll('#hp-seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === id)));
  if (id === 'memorized') S.memUi.draw();
}
function buildProgressSeg() {
  const names = { overview: 'সারাংশ', goals: 'লক্ষ্য', memorized: 'মুখস্থ', tests: 'টেস্ট', badges: 'অর্জন' };
  const list = S.progressViews.map(([id]) => id);
  $('hp-seg').innerHTML = list.map((id) => `<button role="radio" aria-checked="${id === S.pview}" data-v="${id}">${names[id]}</button>`).join('');
}
function selectTab(tab, { instant = false } = {}) {
  const prev = S.tab;
  if (tab === prev && S.tabsReady) return;
  if ((S.running && tab !== 'recite') || (S.testLive && tab !== 'test')) { toast(t('nav.busy')); return; }
  const h = document.documentElement;
  const swap = () => {
    S.tab = tab;
    document.body.dataset.tab = tab;
    for (const [id] of TABS) {
      $(`tab-${id}`).setAttribute('aria-selected', String(id === tab));
      $(`panel-${id}`).hidden = id !== tab;
    }
    placeRibbon();
    if (!S.running && !S.testLive) $('hz-timer').hidden = true; // the timer belongs to a recording in progress
    if (tab === 'progress') refreshProgress();
    $('hz-player').hidden = tab !== 'listen';
    if (tab === 'listen') S.listenUi?.show(); else if (prev === 'listen') S.listenUi?.stop();
    if (tab === 'test') { S.testUi?.show(); $('hz-t-pause').disabled = false; $('hz-t-next').hidden = false; } else $('hz-t-next').hidden = true;
  };
  const idx = (x) => TABS.findIndex(([id]) => id === x);
  h.style.setProperty('--turn', idx(tab) > idx(prev) ? 1 : -1);
  const animate = !instant && S.tabsReady && h.dataset.motion === 'full' && h.dataset.live !== '1'; // gentle / off / reduced motion: instant
  if (animate && document.startViewTransition) document.startViewTransition(swap);
  else {
    swap();
    if (animate) { const el = $(`panel-${tab}`); el.classList.remove('hz-enter'); void el.offsetWidth; el.classList.add('hz-enter'); }
  }
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
  const schema = await loadJson('settings-schema.json');
  setStrings(await loadJson('ui-strings.json'));
  S.settings = createSettings({ store: S.store, schema, platform: 'M' });
  S.settings.onChange(onSettingsChange);
  applyView(S.settings.get);
  buildTabs();
  setDivisions(await loadJson('divisions.json'));
  fillWait();
  renderHelp();
  renderLegend();
  S.settingsUi = createSettingsUi({ root: $('st'), settings: S.settings, ctx: {
    t, toast, confirmDlg, isLive: () => S.running, reload: () => location.reload(),
    previewWords: () => (indopak.ayahWords(1, 2) ?? []).concat(indopak.ayahWords(1, 3) ?? []).concat(indopak.ayahWords(1, 5) ?? []),
    mics: () => S.mics ?? [{ v: 'default', label: 'যন্ত্রের নিজের মাইক' }],
    openOffline: () => S.listenUi.openOffline(),
  } });
  document.getElementById('app').dataset.ready = '1';
  navigator.mediaDevices?.enumerateDevices?.().then((l) => {
    const ins = l.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default');
    S.mics = [{ v: 'default', label: 'যন্ত্রের নিজের মাইক' }, ...ins.map((d, i) => ({ v: d.deviceId, label: d.label || `মাইক ${num(i + 1)}` }))];
  }).catch(() => {});
  setTimeout(() => document.documentElement.classList.remove('st-boot'), 900);
  const data = { sessions: S.store.get('sessions', []), weak: S.store.get('weak', {}), index: S.store.get('index', {}) };
  for (const n of await S.store.blobNames('recordings')) S.recNames.add(n);
  for (const n of await S.store.blobNames('clips')) S.clips.set(n, await S.store.getBlob('clips', n));
  S.history = createHistory({ data, persist: (k) => S.store.set(k, data[k]), hasRecording: (n) => S.recNames.has(n), alafasy: alafasy.follower, opts: () => historyOptsFrom(S.settings.get) });
  S.feedback = createFeedback({
    data: S.store.get('accepted', { places: {}, log: [] }), persist: () => S.store.set('accepted', S.feedback.data),
    getClip: (n) => S.clips.get(n), putClip: (n, s) => { S.clips.set(n, s); S.store.putBlob('clips', n, s); },
    opts: () => feedbackOptsFrom(S.settings.get),
  });
  S.review = createReview({ history: S.history, feedback: S.feedback, getRecording: (n) => S.recCache.get(n), persist: () => S.store.set('index', data.index) });

  S.memUi = createMemorizedUi({ el: $('pg-memorized'), store: S.store, history: S.history, settings: S.settings, onChange: () => {} });
  S.testUi = createTestUi({ S, t, esc, toast, sheet, confirmDlg, followerDeps, openMicSource, errorPopup, tone, endMark: (s, a) => indopak.endMark(s, a),
    setLive: (on) => { S.testLive = on; $('rec').classList.toggle('is-on', on); setLive(); }, saveUi: (o) => { S.ui = { ...S.ui, ...o }; S.store.set('ui', S.ui); },
    goSettings: (g) => S.settingsUi.open(g), goProgress: (v) => { selectTab('progress'); showProgressView(v); }, refreshProgress: () => refreshProgress(), refreshTests: () => { if (S.pview === 'tests') $('pg-tests').innerHTML = S.goalsUi.testsHtml(); } });
  S.listenUi = createListenUi({ S, t, esc, toast, sheet, confirmDlg });
  S.settingsUi.ctx = null;
  S.goalsUi = createGoalsUi({ S });
  S.progressRefresh = () => refreshProgress();
  S.pview = 'overview';
  buildProgressSeg();
  drawToday();
  $('panel-progress').addEventListener('click', async (e) => {
    const r = S.goalsUi.onClick(e);
    if (r === 'recent') $('hp-recent').innerHTML = S.goalsUi.recentHtml();
    const pl = e.target.closest('[data-hplay]');
    if (pl) { const rec = await loadRecording(pl.dataset.hplay); if (rec) media.playClip(rec); }
  });
  $('hz-today').addEventListener('click', () => { selectTab('progress'); showProgressView('goals'); });
  $('hp-seg').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) showProgressView(b.dataset.v); });
  applyLook();
  S.ui = S.store.get('ui', {});
  applyStartAt();
  makeFollower();
  render(true);
  wireEvents();
  setInterval(() => { try { render(); } catch (e) { console.error(e); } }, 150);
  selectTab('recite', { instant: true });
  S.tabsReady = true;
  placeRibbon();
  routeFromHash();

  // the model: download (first visit only), then ready
  const card = $('modelcard');
  const cached = await modelReady();
  $('modeltext').textContent = cached ? 'মডেল তৈরি হচ্ছে…' : 'মডেল নামছে (প্রায় ১৯ MB, শুধু প্রথমবার)…';
  try {
    const th = S.settings.get('device.threads');
    S.asr = await createRecognizer({ threads: th === 'auto' ? undefined : th, onProgress: ({ loaded, total }) => {
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
  const themeBtn = $('theme-btn');
  let pressTimer = null;
  let longPressed = false;
  themeBtn.addEventListener('pointerdown', () => { longPressed = false; pressTimer = setTimeout(() => { longPressed = true; S.settingsUi.open('view'); }, 550); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) themeBtn.addEventListener(ev, () => clearTimeout(pressTimer));
  themeBtn.addEventListener('click', () => { if (!longPressed) cycleTheme(); });
  themeBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); S.settingsUi.open('view'); });
  $('gear-btn').addEventListener('click', () => S.settingsUi.open());
  addEventListener('resize', placeRibbon);
  document.fonts?.ready.then(placeRibbon);
  $('rec').addEventListener('click', () => (S.tab === 'test' ? S.testUi.onTool('rec') : S.running ? stop() : start()));
  $('hz-t-pause').addEventListener('click', () => (S.tab === 'test' ? S.testUi.onTool('pause') : togglePause()));
  $('hz-t-next').innerHTML = ICONS.next;
  $('hz-t-next').addEventListener('click', () => S.testUi.onTool('next'));
  const hintBtn = $('hz-t-hint');
  let hintTimer = null;
  let hintLong = false;
  const doHint = (rest) => { if (S.tab === 'test') S.testUi.onTool(rest ? 'rest' : 'hint'); else { rest ? S.fol?.peekRest() : S.fol?.hint(); render(true); } };
  hintBtn.addEventListener('pointerdown', () => { hintLong = false; clearTimeout(hintTimer); if (S.settings.get('peek.longPressRest')) hintTimer = setTimeout(() => { hintLong = true; doHint(true); }, 500); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) hintBtn.addEventListener(ev, () => clearTimeout(hintTimer));
  hintBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); if (S.settings.get('peek.longPressRest')) { hintLong = true; doHint(true); } });
  hintBtn.addEventListener('click', () => { if (hintLong) { hintLong = false; return; } doHint(false); });
  hintBtn.dataset.tip = t('r.hintTip');
  $('hz-live').addEventListener('dblclick', () => { if (S.running && S.settings.get('peek.doubleTap')) { S.fol?.hint(); render(true); } });
  document.addEventListener('click', (e) => { if (e.target.closest('#hz-live [data-act="mlist"]')) openMistakeList(); });
  $('hz-t-look').addEventListener('click', () => (S.tab === 'test' ? S.testUi.onTool('eye') : setLook(!S.look)));
  $('s-wait').addEventListener('change', () => S.settings.set('recite.waitS', Number($('s-wait').value)));
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

// ---------------------------------------------------------------- keyboard shortcuts and the ayah-mark menu (spec C3 §4.8, §6.10)
document.addEventListener('keydown', (e) => {
  if (!S.settings?.get('device.shortcuts') || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const test = S.tab === 'test';
  const map = { ' ': () => (S.tab === 'listen' ? 0 : test ? S.testUi.onTool('pause') : togglePause()), h: () => (test ? S.testUi.onTool('hint') : (S.fol?.hint(), render(true))), r: () => (test ? S.testUi.onTool('rest') : (S.fol?.peekRest(), render(true))),
    e: () => (test ? S.testUi.onTool('eye') : setLook(!S.look)), m: () => document.querySelector('#hz-live [data-act="mlist"]')?.click(), n: () => test && S.testUi.onTool('next'), p: () => S.tab === 'listen' && document.querySelector('#hz-player [data-pb="play"]')?.click() };
  if (map[k]) { e.preventDefault(); map[k](); }
});
(function ayahMarkMenu() {
  let timer = null;
  const open = (m) => {
    const s = Number(m.dataset.es);
    const a = Number(m.dataset.ea);
    const last = quran.surahInfo(s).ayahs;
    const sh = sheet(`<h2>${esc(quran.surahInfo(s).english)} · আয়াত ${bn(a)}</h2><div class="btn-row"><button class="btn" data-g="listen">${esc(t('r.menu.listen'))}</button><button class="btn" data-g="test">${esc(t('r.menu.test'))}</button></div>`);
    sh.el.addEventListener('click', (e) => {
      const g = e.target.closest('[data-g]')?.dataset.g;
      if (!g) return;
      const spec = { parts: [{ k: 'ayahs', s, from: a, to: last }] };
      sh.close();
      if (g === 'listen') { selectTab('listen'); S.listenUi.startFromHook(spec); S.listenUi.stop(); S.listenUi.show(); } else { selectTab('test'); S.testUi.setSpec(spec, `${quran.surahInfo(s).english} ${bn(a)}–${bn(last)}`); }
    });
  };
  document.addEventListener('pointerdown', (e) => { const m = e.target.closest('[data-es]'); if (m && !S.running && !S.testLive) timer = setTimeout(() => open(m), 550); });
  for (const ev of ['pointerup', 'pointercancel', 'pointermove']) document.addEventListener(ev, () => clearTimeout(timer));
  document.addEventListener('contextmenu', (e) => { const m = e.target.closest('[data-es]'); if (m && !S.running && !S.testLive) { e.preventDefault(); open(m); } });
})();

// hooks for the browser tests (window.hifzTest, spec C3 §2.9)
const longTasks = [];
try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (document.documentElement.dataset.live === '1') longTasks.push({ start: e.startTime, ms: e.duration }); }).observe({ entryTypes: ['longtask'] }); } catch { /* not supported */ }
window.hifzTest = {
  settings: { get: (id) => S.settings.get(id), set: (id, v) => S.settings.set(id, v), reset: (g) => S.settings.reset(g ?? null), all: () => S.settings.all() },
  simulate(url, { speed = 1, mode = 'recite', stopAtEnd = true } = {}) {
    return new Promise((resolve) => {
      S.fake = { url, speed, stopAtEnd, done: resolve };
      if (mode === 'recite') start().then(() => { if (!S.running) resolve(); });
      else if (mode === 'listen') { selectTab('listen'); S.listenUi.startFromHook(window.hifzTest.listenRange); const w = setInterval(() => { if (['ended', 'idle'].includes(S.listenUi.state().status) && !S.listenUi.state().playing) { clearInterval(w); resolve(); } }, 300); }
      else if (mode === 'test') { selectTab('test'); S.testUi.startFromHook(window.hifzTest.testRange); const w = setInterval(() => { if (S.testUi.state().phase === 'results') { clearInterval(w); resolve(); } }, 300); }
    });
  },
  kv: { get: (k, d) => S.store.get(k, d), set: (k, v) => S.store.set(k, v) },
  listenState: () => S.listenUi?.state(),
  testRange: null, testState: () => S.testUi?.state(),
  state: () => ({ mode: S.tab, running: S.running, paused: !!S.fol?.paused, view: S.view?.head ?? null, test: window.hifzTest.testState?.() ?? null, listen: window.hifzTest.listenState?.() ?? null }),
  perf: () => ({ longTasks: longTasks.slice(), over100: longTasks.filter((x) => x.ms > 100).length, animations: document.getAnimations().length }),
};
// #settings or #settings/<group> in the address opens the settings page (screenshots, shortcuts)
function routeFromHash() {
  const m = /^#\/?(settings|recite|progress|test|listen)(?:\/(\w+))?/.exec(location.hash);
  if (!m) return;
  if (m[1] === 'settings') S.settingsUi.open(m[2]); else selectTab(m[1], { instant: true });
}
S.routeFromHash = routeFromHash;
S.start = start; S.stop = stop; S.togglePause = togglePause; S.render = render; S.selectTab = selectTab; S.refreshProgress = refreshProgress;
boot().catch((e) => { console.error(e); toast(`শুরু করা যায়নি: ${e.message || e}`, 8000); });
