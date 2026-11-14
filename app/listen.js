// The শোনা tab (spec C3 §8): Alafasy's recitation of a range, with repeats, gaps, word highlight, sleep timer, Media Session,
// listening history and the offline surah manager. Plan logic is core/listen-plan.js; audio is one Audio element (app/media.js srcFor).
import * as quran from '../core/quran.js';
import * as alafasy from '../core/alafasy.js';
import * as indopak from '../core/indopak.js';
import { plan, unitAt } from '../core/listen-plan.js';
import { resolve } from '../core/ranges.js';
import { openPicker, specLabel } from './picker.js';
import * as media from './media.js';
import { isoLocal, bn } from '../core/bn.js';
import { withUnit, num, size } from '../core/fmt.js';
import { ICONS } from './icons.js';

export function createListenUi(ctx) {
  const { S, t, esc, toast, sheet, confirmDlg } = ctx;
  const el = document.getElementById('panel-listen');
  const bar = document.getElementById('hz-player');
  const get = (id) => S.settings.get(id);
  let L = { spec: null, ayahs: [], token: 0, paused: false, status: 'idle', playing: false, played: new Set(), units: new Map(), cur: null, started: 0, playedS: 0, plays: 0, sleepTimer: null };
  let audio = null;
  let raf = 0;
  let resumeWaiters = [];

  const api = { span: (s, a) => alafasy.ayahSpan(s, a), basmala: (s) => alafasy.basmalaSpan(s), count: (s) => quran.surahInfo(s).ayahs };
  const opts = () => ({ repeatAyah: get('listen.repeatAyah'), repeatRange: get('listen.repeatRange'), gapRepeatS: get('listen.gapRepeatS'), gapAyahS: get('listen.gapAyahS'), gapAuto: get('listen.gapAuto'), basmala: get('listen.basmala'),
    nextSurah: get('listen.nextSurah'), speed: get('listen.speed') });

  // ---- text units of an ayah: [{ words: [wi], text, from, to }]
  function unitsOf(s, a) {
    const key = `${s}:${a}`;
    if (L.units.has(key)) return L.units.get(key);
    const ws = quran.ayahs(s, a, a)[0][1];
    const shown = indopak.ayahWords(s, a) || ws;
    const times = alafasy.wordTimes(s, a);
    const span = alafasy.ayahSpan(s, a);
    const out = [];
    let group = [];
    ws.forEach((_, k) => {
      group.push(k);
      if (shown[k] || k + 1 === ws.length) { out.push({ words: group, text: shown[k] || group.map((i) => ws[i]).join(' ') }); group = []; }
    });
    out.forEach((u) => { u.from = times ? times[u.words[0]][0] : span?.[0] ?? 0; u.to = times ? times[u.words.at(-1)][1] : span?.[1] ?? 0; });
    out.aligned = !!times;
    L.units.set(key, out);
    return out;
  }

  function setRange(spec) {
    L.spec = spec;
    L.ayahs = resolve(spec, S.store.get('memorized', { ranges: [] })).flatMap(([s, a, b]) => Array.from({ length: b - a + 1 }, (_, i) => [s, a + i]));
    L.played = new Set();
    stop(false);
    S.ui = { ...S.ui, listenRange: spec }; S.store.set('ui', S.ui);
    draw();
  }

  function draw() {
    const mode = get('listen.text');
    const first = L.ayahs[0];
    const parts = L.ayahs.length ? specLabel(L.spec) : '—';
    const text = L.ayahs.slice(0, 400).map(([s, a]) => {
      const us = unitsOf(s, a);
      const spans = us.map((u, i) => {
        const hidden = mode === 'hide' || (mode === 'reveal' && !L.played.has(`${s}:${a}:${i}`));
        return `<span class="${hidden ? 'hz-hid' : ''}" data-ls="${s}" data-la="${a}" data-lu="${i}">${esc(u.text)}</span>`;
      }).join(' ');
      return `${a === 1 ? `<div class="hz-sura"><span class="hz-sura-ar">${esc(quran.surahInfo(s).name)}</span><span class="hz-sura-bn">${esc(t('p.sura', { n: bn(s), english: quran.surahInfo(s).english }))}</span></div>` : ''}${spans} <span class="hz-end" data-ls="${s}" data-la="${a}" data-lu="-1">${esc(indopak.endMark(s, a))}</span> `;
    }).join('');
    el.innerHTML = `<div class="ls-bar card"><button class="btn" data-lb="pick">${esc(t('l.pick'))}</button><span class="hp-note">${esc(parts)}</span><button class="btn" data-lb="off">${esc(t('l.offTitle'))}</button></div>
      <div id="ls-text" class="card"><div class="hz-text" data-live="0">${text || ''}</div></div><div class="hz-footer"></div>`;
    paintHighlight();
    paintBar();
  }
  const statusText = () => ({ idle: t('l.idle'), loading: t('l.loading'), paused: t('l.pausedS'), ended: t('l.ended'), error: t('l.error') }[L.status] ?? L.statusText ?? '');
  function paintBar() {
    const o = opts();
    const sl = get('listen.sleepMin');
    bar.innerHTML = `<div class="pl-row"><button class="hz-tool" data-pb="prev" aria-label="${esc(t('l.prev'))}">${ICONS.next.replace('<svg', '<svg style="transform:scaleX(-1)"')}</button>
      <button class="hz-rec" data-pb="play" aria-label="${esc(L.playing && !L.paused ? t('l.pause') : t('l.play'))}">${L.playing && !L.paused ? ICONS.pause : ICONS.play}</button>
      <button class="hz-tool" data-pb="next" aria-label="${esc(t('l.next'))}">${ICONS.next}</button></div>
      <div class="pl-chips"><button class="chip" data-pc="speed">${esc(t('l.speedChip', { x: num(o.speed) }))}</button><button class="chip" data-pc="repeatAyah">${esc(t('l.ayahChip', { n: bn(o.repeatAyah) }))}</button>
      <button class="chip" data-pc="repeatRange">${esc(o.repeatRange === 0 ? t('l.rangeChipInf') : t('l.rangeChip', { n: bn(o.repeatRange) }))}</button><button class="chip" data-pc="gap">${esc(t('l.gapChip', { s: num(o.gapAuto ? 0 : o.gapAyahS) }))}</button>
      <button class="chip" data-pc="sleep">${esc(t('l.sleepChip', { m: bn(sl) }))}</button></div>
      <div class="pl-status" role="status">${esc(statusText())} ${L.cur ? `<span class="st-badge">${esc(L.offline ? t('l.offline') : t('l.online'))}</span>` : ''}</div>`;
  }

  // ---- highlight
  function paintHighlight(unit = null) {
    const mode = get('listen.highlight');
    el.querySelectorAll('#ls-text .hz-listen').forEach((x) => x.classList.remove('hz-listen'));
    if (!unit || mode === 'none') return;
    const sel = mode === 'ayah' ? `#ls-text [data-ls="${unit.s}"][data-la="${unit.a}"]` : `#ls-text [data-ls="${unit.s}"][data-la="${unit.a}"][data-lu="${unit.u}"]`;
    const hit = el.querySelectorAll(sel);
    hit.forEach((x) => { if (x.dataset.lu !== '-1') x.classList.add('hz-listen'); });
    if (unit.u >= 0) {
      L.played.add(`${unit.s}:${unit.a}:${unit.u}`);
      if (get('listen.text') === 'reveal') hit.forEach((x) => x.classList.remove('hz-hid'));
    }
    if (get('listen.autoScroll') && hit[0] && document.documentElement.dataset.live !== '1') {
      const r = hit[0].getBoundingClientRect();
      if (r.top < 120 || r.bottom > innerHeight - 220) window.scrollBy({ top: r.top - 160, behavior: document.documentElement.dataset.motion === 'full' ? 'smooth' : 'auto' });
    }
  }

  // ---- playback
  const sleepMs = (ms, token) => new Promise((r) => { const id = setTimeout(r, ms); L.cancel = () => { clearTimeout(id); r(); }; if (token !== L.token) r(); });
  async function waitIfPaused(token) { while (L.paused && token === L.token) await new Promise((r) => resumeWaiters.push(r)); }
  function segment(step, token) {
    return new Promise((resolveSeg) => {
      const speed = () => get('listen.speed');
      const u = unitsOf(step.s, step.a || 1);
      const muted = media.isMuted();
      let done = false;
      let t0 = performance.now();
      let base = step.from;
      let tm = 0;
      const finish = () => { if (done) return; done = true; cancelAnimationFrame(raf); clearTimeout(tm); audio?.pause(); L.cancel = null; resolveSeg(); };
      L.cancel = finish;
      const now = () => (muted ? base + ((performance.now() - t0) / 1000) * speed() : audio.currentTime);
      const tickF = () => {
        if (done) return;
        if (token !== L.token) { finish(); return; }
        if (L.paused) { raf = requestAnimationFrame(tickF); return; }
        const cur = now();
        if (cur >= step.to - 0.02) { finish(); return; }
        if (!step.basmala && document.visibilityState === 'visible') { const i = unitAt(u.map((x) => [x.from, x.to]), cur); L.cur = { s: step.s, a: step.a, u: u.aligned ? i : (i >= 0 ? 0 : -1) }; if (!u.aligned) L.cur.u = -1; paintHighlight(L.cur.u >= 0 || get('listen.highlight') === 'ayah' ? { s: step.s, a: step.a, u: L.cur.u } : { s: step.s, a: step.a, u: -1 }); }
        raf = requestAnimationFrame(tickF);
      };
      (async () => {
        const url = alafasy.surahUrl(step.src ?? step.s);
        L.offline = await media.isCached(url);
        if (muted) { L.status = 'playing'; setPlayingText(step); paintBar(); raf = requestAnimationFrame(tickF); return; }
        audio ??= new Audio();
        audio.pause();
        L.status = 'loading'; paintBar();
        audio.src = await media.srcFor(url);
        audio.preservesPitch = true;
        audio.onerror = () => { L.status = 'error'; paintBar(); finish(); stop(false); };
        audio.addEventListener('loadedmetadata', () => {
          audio.playbackRate = speed();
          audio.currentTime = step.from;
          audio.play().then(() => { L.status = 'playing'; setPlayingText(step); paintBar(); raf = requestAnimationFrame(tickF); tm = setTimeout(() => finish(), ((step.to - step.from) / speed()) * 1000 + 400); }).catch(() => { L.status = 'error'; paintBar(); finish(); });
        }, { once: true });
        if (audio.readyState >= 1) audio.dispatchEvent(new Event('loadedmetadata'));
      })();
    });
  }
  function setPlayingText(step) {
    L.status = 'playing';
    L.statusText = step.basmala ? '﷽' : `${t('l.playing', { a: bn(step.a), k: bn(step.k), n: bn(step.n) })}${opts().repeatRange === 0 ? ` · ${t('l.round', { r: bn(step.round) })}` : ''}`;
    if ('mediaSession' in navigator && !step.basmala) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: `${quran.surahInfo(step.s).english} · ${t('fmt.ayah1', { a: bn(step.a) })}`, artist: t('l.artist'), album: t('app.title') });
    }
  }

  async function run(fromIndex = 0) {
    stop(false);
    if (!L.ayahs.length) return;
    const token = ++L.token;
    L.playing = true; L.paused = false; L.started = L.started || Date.now(); L.status = 'loading';
    wake(true);
    const sleepMin = get('listen.sleepMin');
    clearTimeout(L.sleepTimer);
    if (sleepMin) L.sleepTimer = setTimeout(() => { stop(true); toast(t('l.slept')); }, sleepMin * 60000);
    paintBar();
    let idx = fromIndex;
    const list = L.ayahs.slice(fromIndex);
    for (const st of plan(list, opts(), api)) {
      if (token !== L.token) return;
      await waitIfPaused(token);
      if (st.type === 'wait') {
        L.status = 'gap'; L.statusText = t('l.gap', { s: num(st.seconds) }); paintBar();
        await sleepMs(st.seconds * 1000, token);
      } else {
        L.plays++;
        L.index = L.ayahs.findIndex(([s, a]) => s === st.s && a === st.a);
        await segment(st, token);
      }
    }
    if (token === L.token) { L.status = 'ended'; L.playing = false; paintHighlight(); paintBar(); recordHistory(); wake(false); }
  }
  function stop(record = true) {
    L.token++;
    L.cancel?.();
    audio?.pause();
    clearTimeout(L.sleepTimer);
    cancelAnimationFrame(raf);
    if (L.playing && record) recordHistory();
    L.playing = false; L.paused = false; if (L.status !== 'error') L.status = L.ayahs.length ? 'idle' : 'idle';
    resumeWaiters.forEach((r) => r()); resumeWaiters = [];
    wake(false);
    paintHighlight();
    paintBar();
  }
  function recordHistory() {
    const secs = L.started ? Math.round((Date.now() - L.started) / 1000) : 0;
    if (get('listen.countAsSession') && secs >= 30) {
      const l = S.store.get('listens', []) ?? [];
      S.store.set('listens', [...l, { start: isoLocal(new Date(L.started)), seconds: secs, parts: L.spec, plays: L.plays }].slice(-500));
    }
    L.started = 0; L.plays = 0;
  }
  function togglePause() {
    if (!L.playing) { run(L.index ?? 0); return; }
    L.paused = !L.paused;
    if (L.paused) { audio?.pause(); L.status = 'paused'; } else { audio?.play(); L.status = 'playing'; resumeWaiters.forEach((r) => r()); resumeWaiters = []; }
    paintBar();
  }
  const jump = (d) => { const i = Math.max(0, Math.min(L.ayahs.length - 1, (L.index ?? 0) + d)); run(i); };
  async function wake(on) { try { if (!on) { await L.wake?.release(); L.wake = null; } else if (get('device.keepAwake') && navigator.wakeLock) L.wake = await navigator.wakeLock.request('screen'); } catch { /* ignore */ } }

  // ---- offline manager
  function openOffline() {
    const rows = Array.from({ length: 114 }, (_, i) => i + 1);
    const sh = sheet(`<h2>${esc(t('l.offTitle'))}</h2><div class="btn-row"><span class="hp-note" data-total></span><button class="btn" data-all>${esc(t('l.offGetAll'))}</button></div><div class="off-list"></div>`, { cls: 'off' });
    const list = sh.el.querySelector('.off-list');
    const sizes = new Map();
    const maxB = () => get('audio.offlineMaxMB') * 1048576;
    async function paint() {
      let total = 0;
      const html = [];
      for (const s of rows) {
        const url = alafasy.surahUrl(s);
        const have = await media.isCached(url);
        const sz = sizes.get(s);
        if (have && sz) total += sz;
        const state = have ? t('l.offHave') : sz && sz > maxB() ? t('l.offTooBig') : '';
        html.push(`<div class="mm-row"><div class="mm-main">${esc(t('l.offRow', { n: bn(s), english: quran.surahInfo(s).english, size: sz ? size(sz) : '…' }))}<br><small>${esc(state)}</small></div>${have ? `<button class="btn btn-red" data-del="${s}">${esc(t('l.offDel'))}</button>` : sz && sz > maxB() ? '' : `<button class="btn" data-get="${s}">${esc(t('l.offGet'))}</button>`}</div>`);
      }
      list.innerHTML = html.join('');
      sh.el.querySelector('[data-total]').textContent = t('l.offTotal', { mb: bn((total / 1048576).toFixed(1)) });
    }
    (async () => { let i = 0; const worker = async () => { while (i < rows.length) { const s = rows[i++]; sizes.set(s, await media.surahSize(alafasy.surahUrl(s))); } }; await Promise.all([worker(), worker(), worker(), worker()]); paint(); })();
    paint();
    sh.el.addEventListener('click', async (e) => {
      const g = e.target.closest('[data-get]'); const d = e.target.closest('[data-del]'); const all = e.target.closest('[data-all]');
      if (g) { const s = Number(g.dataset.get); g.textContent = t('l.offGetting', { p: bn(0) }); const ok = await media.cacheSurah(alafasy.surahUrl(s), (got, tot) => { g.textContent = t('l.offGetting', { p: bn(tot ? Math.round((100 * got) / tot) : 0) }); }, maxB()); if (!ok) toast(t('l.error')); paint(); }
      else if (d) { const s = Number(d.dataset.del); if (await confirmDlg(t('l.offDelQ', { english: quran.surahInfo(s).english }))) { await media.uncacheSurah(alafasy.surahUrl(s)); paint(); } }
      else if (all) {
        const todo = rows.filter((s) => (sizes.get(s) ?? 0) <= maxB());
        const mb = todo.reduce((n, s) => n + (sizes.get(s) ?? 0), 0) / 1048576;
        if (await confirmDlg(t('l.offGetAllQ', { n: bn(todo.length), mb: bn(Math.round(mb)) }))) { for (const s of todo) await media.cacheSurah(alafasy.surahUrl(s), null, maxB()); paint(); }
      }
    });
  }

  // ---- events
  el?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lb]');
    if (b) { if (b.dataset.lb === 'pick') openPicker({ spec: L.spec, onUse: setRange }); else openOffline(); return; }
    const w = e.target.closest('[data-ls]');
    if (w) { const i = L.ayahs.findIndex(([s, a]) => s === Number(w.dataset.ls) && a === Number(w.dataset.la)); if (i >= 0) run(i); }
  });
  bar?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pb]');
    if (b) { const a = b.dataset.pb; if (a === 'play') togglePause(); else jump(a === 'next' ? 1 : -1); return; }
    const c = e.target.closest('[data-pc]');
    if (c) {
      const id = { speed: 'listen.speed', repeatAyah: 'listen.repeatAyah', repeatRange: 'listen.repeatRange', gap: 'listen.gapAyahS', sleep: 'listen.sleepMin' }[c.dataset.pc];
      const d = S.settings.def(id);
      const list = d.control === 'sld' ? [0, 1, 2, 3, 5, 10] : d.options.map((o) => o.v);
      const i = list.indexOf(get(id));
      S.settings.set(id, list[(i + 1) % list.length]);
      if (id === 'listen.speed' && audio) audio.playbackRate = get(id);
      paintBar();
    }
  });
  if ('mediaSession' in navigator) {
    const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch { /* unsupported */ } };
    set('play', () => togglePause()); set('pause', () => togglePause()); set('previoustrack', () => jump(-1)); set('nexttrack', () => jump(1));
  }

  return {
    show() { if (!L.spec) { setRange(S.ui?.listenRange ?? { parts: [{ k: 'surah', s: 1 }] }); } else draw(); },
    live: () => false,
    playing: () => L.playing && !L.paused,
    stop: () => stop(true),
    onSettings(ids) { if (ids.some((i) => i.startsWith('listen.'))) { if (audio) audio.playbackRate = get('listen.speed'); if (ids.includes('listen.text')) draw(); else paintBar(); } },
    openOffline,
    startFromHook(spec) { setRange(spec ?? { parts: [{ k: 'surah', s: 112 }] }); run(0); },
    state: () => ({ status: L.status, playing: L.playing, paused: L.paused, index: L.index ?? 0, count: L.ayahs.length, cur: L.cur, statusText: L.statusText }),
    withUnit,
  };
}
