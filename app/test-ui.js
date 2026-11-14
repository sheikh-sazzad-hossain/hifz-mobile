// The টেস্ট tab (spec C3 §7): setup, countdown, flash cards followed live by a fixed-mode Follower, scoring, results, resume.
// The page (main.js) hands in ctx: { S, t, esc, toast, sheet, confirmDlg, openMicSource(onAudio, onEnd), followerDeps(), errorPopup(item), tone, setLive(on), media, goSettings(group) }.
import { Follower, SAMPLE_RATE } from '../core/follower.js';
import * as quran from '../core/quran.js';
import { resolve, countAyahs } from '../core/ranges.js';
import { createGenerator, optionsFrom, newSeed, tally, resultOf, cardMistakes, suggestions, dayOfYear, cardWords, toggleRemoved } from '../core/testmode.js';
import { followerOptsFrom } from './engine-cfg.js';
import { openPicker, rangeIcon, specLabel } from './picker.js';
import { createTimer, formatTime } from '../core/timer.js';
import { bn, isoLocal, when } from '../core/bn.js';
import { fill, num, span } from '../core/fmt.js';
import { ICONS } from './icons.js';
import { slipStack, countUp, staggerSlips, rosette } from './beats.js';
import { addRange, removeRange, moveRange, renameRange } from '../core/ranges.js';

export function createTestUi(ctx) {
  const { S, t, esc, toast, sheet, confirmDlg } = ctx;
  const el = document.getElementById('panel-test');
  const get = (id) => S.settings.get(id);
  const mem = () => S.store.get('memorized', { ranges: [] });
  const ui = () => S.store.get('ui', {});
  let sel = { spec: null, name: '', saved: false };
  let T = null; // the running test
  let tick = null;
  const timer = createTimer();
  const weakCache = new Map();
  const weakScore = (s, a) => { if (!weakCache.has(s)) weakCache.set(s, new Map(S.history.ayahCells(s).map((c) => [c.ayah, c.score]))); return weakCache.get(s).get(a) ?? 0; };

  // ---------------------------------------------------------------- setup
  const starterSpec = () => ({ parts: Array.from({ length: 16 }, (_, i) => ({ k: 'surah', s: 99 + i })) });
  function pending() { return (S.store.get('tests', []) ?? []).findLast?.((x) => x.state === 'paused') ?? [...(S.store.get('tests', []) ?? [])].reverse().find((x) => x.state === 'paused'); }

  function drawSetup() {
    if (!el) return;
    const m = mem();
    const ranges = S.store.get('ranges', []) ?? [];
    const sg = suggestions({ memorized: m.ranges, sessions: S.history.sessions(), weakScore, good: get('history.good'), dayOfYear: dayOfYear() });
    const p = pending();
    const rules = t('t.rules', { q: bn(get('test.questions')), w: bn(get('test.lengthWords')), h: bn(get('test.hintWords')) });
    const runs = sel.spec ? resolve(sel.spec, m) : [];
    const nothing = !m.ranges.length && !ranges.length;
    el.innerHTML = `<div class="tq-setup"><h2 class="hp-h">${esc(t('t.setupTitle'))}</h2>
      ${p ? `<div class="hz-banner hz-paused">${esc(t('t.resumeQ', { i: bn(p.cards.length), n: bn(p.settings.endBy === 'count' ? p.settings.questions : p.cards.length) }))}<div class="btn-row"><button class="btn btn-primary" data-ta="resume">${esc(t('t.resume'))}</button><button class="btn" data-ta="results">${esc(t('t.seeResults'))}</button><button class="btn btn-red" data-ta="discard">${esc(t('t.discard'))}</button></div></div>` : ''}
      ${nothing ? `<div class="card"><b>${esc(t('t.starterTitle'))}</b><p class="hp-note">${esc(t('t.starterBody', { a: t('t.starterRange', { n: bn(99), english: 'Az-Zalzala' }), b: t('t.starterRange', { n: bn(114), english: 'An-Naas' }) }))}</p><div class="btn-row"><button class="btn btn-primary" data-ta="starter">${esc(t('t.start'))}</button><button class="btn" data-ta="markmem">${esc(t('t.markMemorized'))}</button></div></div>` : ''}
      ${sg.length ? `<h3 class="hp-h">${esc(t('t.suggested'))}</h3><div class="tq-sg">${sg.map((x, i) => `<button class="tq-sgcard" data-ta="sg" data-i="${i}"><b>${esc(t(`t.sg.${x.id}.name`))}</b><small>${esc(t(`t.sg.${x.id}.sub`))}</small><span class="st-badge">${esc(t('t.ayahBadge', { n: bn(countAyahs(x.runs)) }))}</span></button>`).join('')}</div>` : ''}
      <h3 class="hp-h">${esc(t('t.myRanges'))}</h3><div class="chips">
        <button class="chip" ${m.ranges.length ? '' : 'disabled'} aria-pressed="${sel.spec?.parts?.[0]?.k === 'memorized'}" data-ta="mem" ${m.ranges.length ? '' : `data-tip="${esc(t('t.noMemorized'))}"`}>${esc(t('t.myMemorized'))}</button>
        ${ranges.map((r) => `<button class="chip" aria-pressed="${sel.saved === r.id}" data-ta="saved" data-id="${r.id}">${rangeIcon(r.icon)} ${esc(r.name)}</button>`).join('')}
        <button class="chip" data-ta="new">+ ${esc(t('t.newRange'))}</button></div>
      ${sel.saved ? `<div class="btn-row"><button class="btn" data-ta="rename">${esc(t('t.rename'))}</button><button class="btn" data-ta="up">${esc(t('t.up'))}</button><button class="btn" data-ta="down">${esc(t('t.down'))}</button><button class="btn btn-red" data-ta="del">${esc(t('t.delete'))}</button></div>` : ''}
      ${sel.spec ? `<p class="hp-note">${esc(t('t.rangeSummary', { name: sel.name || specLabel(sel.spec), n: bn(countAyahs(runs)) }))}</p>` : ''}
      <p class="hp-note">${esc(rules)} · <a href="#" data-ta="rules">${esc(t('t.changeRules'))}</a></p>
      <div class="st-row inline tap" data-ta="temp"><div class="st-lab"><div class="st-label">${esc(t('t.temporary'))}</div></div><div class="st-ctl"><button class="sw" role="switch" aria-checked="${get('test.temporary')}" aria-label="${esc(t('t.temporary'))}"></button></div></div>
      <div class="btn-row"><button class="btn btn-primary" data-ta="start" ${!sel.spec || !countAyahs(runs) || !S.ready ? 'disabled' : ''}>${esc(!S.ready ? t('t.modelWait') : sel.spec && !countAyahs(runs) ? t('t.emptyRange') : t('t.start'))}</button></div></div>`;
  }
  el?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ta]');
    if (!b || T?.phase === 'card') return;
    const a = b.dataset.ta;
    const ranges = S.store.get('ranges', []) ?? [];
    const pick = (spec, name, saved = false) => { sel = { spec, name, saved }; ctx.saveUi({ testRange: spec }); drawSetup(); };
    if (a === 'rules') { e.preventDefault(); ctx.goSettings('test'); }
    else if (a === 'mem') pick({ parts: [{ k: 'memorized' }] }, t('t.myMemorized'));
    else if (a === 'saved') { const r = ranges.find((x) => x.id === b.dataset.id); pick(r.spec, r.name, r.id); }
    else if (a === 'sg') { const sg = suggestions({ memorized: mem().ranges, sessions: S.history.sessions(), weakScore, good: get('history.good'), dayOfYear: dayOfYear() })[Number(b.dataset.i)]; pick({ parts: sg.runs.map(([s, from, to]) => ({ k: 'ayahs', s, from, to })) }, t(`t.sg.${sg.id}.name`)); }
    else if (a === 'new') openPicker({ spec: sel.spec, memorized: mem(), onUse: (spec) => pick(spec, ''), onSave: (spec, name, icon) => { const l = addRange(S.store.get('ranges', []) ?? [], { name, icon, spec }); if (!l) { toast(t('pk.full')); return false; } S.store.set('ranges', l); toast(t('pk.saved', { name })); pick(spec, name, l.at(-1).id); return true; } });
    else if (a === 'rename') { const n = prompt(t('t.rename'), sel.name); if (n) { await S.store.set('ranges', renameRange(ranges, sel.saved, n)); sel.name = n; drawSetup(); } }
    else if (a === 'up' || a === 'down') { await S.store.set('ranges', moveRange(ranges, sel.saved, a === 'up' ? -1 : 1)); drawSetup(); }
    else if (a === 'del') { if (await confirmDlg(t('t.deleteQ', { name: sel.name }))) { await S.store.set('ranges', removeRange(ranges, sel.saved)); sel = { spec: null, name: '', saved: false }; drawSetup(); } }
    else if (a === 'temp') { S.settings.set('test.temporary', !get('test.temporary')); drawSetup(); }
    else if (a === 'starter') pick(starterSpec(), t('t.starterTitle'));
    else if (a === 'markmem') ctx.goProgress('memorized');
    else if (a === 'start') startRun();
    else if (a === 'resume') resume(pending());
    else if (a === 'results') showResults(pending(), true);
    else if (a === 'discard') { await S.store.set('tests', (S.store.get('tests', []) ?? []).filter((x) => x.state !== 'paused')); drawSetup(); }
  });

  // ---------------------------------------------------------------- running a test
  function startRun(spec = sel.spec, name = sel.name) {
    const runs = resolve(spec, mem());
    if (!runs.length || !S.ready) return false;
    const opts = optionsFrom(get);
    const seed = newSeed();
    T = { spec, name: name || specLabel(spec), runs, opts, seed, gen: createGenerator(runs, opts, seed, weakScore), cards: [], cur: null, shown: null, phase: 'intro', temporary: get('test.temporary'), showRef: get('test.showRef'),
      startedAt: new Date(), gate: true, paused: false, mic: null, lastBest: 0, id: `t${Date.now().toString(36)}` };
    if (!ui().introSeen?.test) { introSheet(() => countdown()); ctx.saveUi({ introSeen: { ...(ui().introSeen ?? {}), test: true } }); } else countdown();
    return true;
  }
  function introSheet(done) {
    const sh = sheet(`<h2>${esc(t('t.introTitle'))}</h2><ul class="help-list">${[1, 2, 3, 4, 5].map((i) => `<li>${esc(t(`t.intro${i}`))}</li>`).join('')}</ul><div class="btn-row"><button class="btn btn-primary" data-ok>${esc(t('t.introOk'))}</button></div>`);
    sh.el.querySelector('[data-ok]').addEventListener('click', () => { sh.close(); done(); });
  }
  async function countdown() {
    T.phase = 'countdown';
    drawRun();
    try { T.mic = await ctx.openMicSource((x) => { if (!T.gate && T.cur && !T.paused) T.cur.fol.addAudio(x); }, () => { if (T?.phase === 'card') end(); }); } catch (e) { toast(t('a.micFail', { err: e.message || e }), 6000); T = null; drawSetup(); return; }
    const n = get('test.countdown');
    const stack = slipStack(el); // beat 5: three paper slips rise, ৩ · ২ · ১ on the top one
    for (let i = n; i >= 1; i--) { stack.setNumber(bn(i)); await new Promise((r) => setTimeout(r, 1000)); if (!T) { stack.remove(); return; } }
    if (n) { stack.go(t('t.go')); await new Promise((r) => setTimeout(r, 400)); }
    stack.remove();
    T.gate = false;
    T.phase = 'card';
    T.timeStart = Date.now();
    timer.start();
    ctx.setLive(true);
    nextCard();
    clearInterval(tick);
    tick = setInterval(onTick, 150);
  }
  function over() { // the test has reached its end by the settings
    if (T.opts.endBy === 'count') return T.cards.length >= T.opts.questions;
    if (T.opts.endBy === 'time') return (timer.elapsedMs() / 60000) >= T.opts.minutes;
    return false;
  }
  function nextCard() {
    if (over()) { end(); return; }
    const card = T.gen.next();
    if (!card) { end(); return; }
    const fol = new Follower(card.s, card.a1, card.a2, { ...ctx.followerDeps(), opts: { ...followerOptsFrom(get), fixed: true, silenceHelp: 'word', added: get('detect.added') && get('test.checkAdded') } });
    fol.trim(card.a1, card.wi1, card.a2, card.wi2);
    fol.give(card.hint);
    fol.waitS = get('test.silence') === 'alafasy' ? get('test.silenceS') : 0;
    fol.look = false;
    fol.start(S.asr);
    const cur = { card: { ...card, mistakes: [], peekMistakes: 0, stray: false, result: null, rec: null }, fol, closed: false, lastHint: 0, status: 'listening' };
    T.cards.push(cur.card);
    cur.card.fol = fol;
    T.cur = cur;
    if (!T.shown || get('test.advance') === 'tap') T.shown = cur;
    drawRun();
  }
  function collect(cur) { // mistakes of a card from its words
    const c = cur.card;
    c.mistakes = [];
    cur.fol.words.forEach((w, k) => {
      if (w.status === 'missed') c.mistakes.push({ a: w.ayah, wi: w.wi, k, word: w.show || w.word, kind: w.added ? 'added' : w.heard ? 'changed' : 'skipped', heard: w.heard ?? '', removed: false });
      else if (w.removed) c.mistakes.push({ a: w.ayah, wi: w.wi, k, word: w.show || w.word, kind: w.removed.added ? 'added' : 'changed', heard: w.removed.heard, removed: true });
    });
    c.peekMistakes = get('peek.countsAsMistake') ? cur.fol.words.filter((w) => w.status === 'hint').length : 0;
    c.peeks = cur.fol.words.filter((w) => w.status === 'hint').length;
    if (cur.fol.stray || cur.sawStray) c.stray = true;
    c.result = cur.skipped ? 'skipped' : resultOf({ ...c, result: null });
    return c;
  }
  function sound(pass) {
    if (!get('test.sound')) { return; }
    const lvl = Math.max(0.15, { off: 0, soft: 0.15, normal: 0.35, loud: 0.6 }[get('detect.errorTone')]);
    if (pass) { ctx.tone(880, 0.12, lvl); setTimeout(() => ctx.tone(1175, 0.15, lvl), 130); } else { ctx.tone(330, 0.15, lvl); setTimeout(() => ctx.tone(220, 0.3, lvl), 160); }
  }
  function complete(cur, skipped = false) {
    if (cur.closed) return;
    cur.closed = true;
    cur.skipped = skipped;
    collect(cur);
    cur.status = skipped ? 'skipped' : 'checking';
    const c = cur.card;
    if (!skipped) { sound(c.result === 'pass'); if (get('test.vibrate')) navigator.vibrate?.(c.result === 'pass' ? 40 : [80, 60, 80]); }
    const adv = get('test.advance');
    if (T.cur === cur) { T.cur = null; if (adv === 'auto' || skipped) nextCard(); else T.waitTap = true; }
    if (adv === 'auto' && !skipped) setTimeout(() => { if (T) { T.shown = T.cur ?? cur; drawRun(); } }, get('test.holdS') * 1000); else if (skipped && T) { T.shown = T.cur ?? T.shown; }
    (skipped ? cur.fol.halt() : cur.fol.finish(S.asr)).then(() => { if (!T) return; collect(cur); cur.status = 'done'; drawRun(); });
    drawRun();
  }
  function onTick() {
    if (!T || T.phase !== 'card' || T.paused) return;
    const cur = T.cur;
    if (cur) {
      const f = cur.fol;
      if (f.stray) cur.sawStray = true;
      if (f.done() && !f.pending().length && !cur.closed) { complete(cur); return; }
      // the reciter stopped one word short of the card end: the live passes never settle the last word (it is cut at
      // the window's end), so after 2.5 s without progress one final pass (as Stop would run) settles it and the card closes
      if (f.pos >= f.words.length - 1 && f.len - f.advancedAt > 2.5 * SAMPLE_RATE && f.len > 3 * SAMPLE_RATE && !cur.tail) {
        cur.tail = true;
        f.update(S.asr, { final: true }).then(() => { f.version++; }, () => {});
      }
      const sil = get('test.silence');
      const sS = get('test.silenceS');
      if (sil === 'show' && f.quietFor(sS) && f.len - cur.lastHint > sS * SAMPLE_RATE) { f.hint(); cur.lastHint = f.len; }
      const ap = get('test.autoPauseS');
      if (ap && f.quietFor(ap) && f.len > ap * SAMPLE_RATE) { pause(); toast(t('t.autoPaused')); return; }
    }
    if (T.opts.endBy === 'time' && over() && (!cur || cur.closed)) { end(); return; }
    drawRun(true);
  }
  function pause() {
    if (!T || T.phase !== 'card') return;
    if (T.paused) { T.paused = false; timer.resume(); T.mic?.resume(); if (T.cur) T.cur.fol.resume(S.asr); ctx.setLive(true); }
    else { T.paused = true; timer.pause(); T.mic?.pause(); ctx.setLive(false); if (T.cur) T.cur.fol.pause(S.asr); persistPaused(); }
    drawRun();
  }
  async function persistPaused() {
    if (T.temporary) return;
    const rec = serialize('paused');
    const l = (S.store.get('tests', []) ?? []).filter((x) => x.id !== T.id);
    await S.store.set('tests', [...l, rec].slice(-500));
  }
  const serialize = (state) => ({ id: T.id, start: isoLocal(T.startedAt), end: isoLocal(new Date()), seconds: Math.round(timer.elapsedMs() / 1000), rangeName: T.name, rangeSpec: T.spec, seed: T.seed, settings: T.opts,
    cards: T.cards.map(({ fol, ...c }) => ({ ...c, mistakes: c.mistakes.map(({ k, ...m }) => m) })), ...tally(T.cards, get('test.skipCounts')), state, index: T.cards.length });
  function skip() { if (T?.cur && T.phase === 'card' && !T.paused) complete(T.cur, true); else if (T?.waitTap) { T.waitTap = false; nextCard(); T.shown = T.cur; drawRun(); } }
  function peek(rest) { const f = T?.cur?.fol; if (!f || T.paused) return; if (rest) f.peekRest(); else f.hint(); drawRun(); }

  async function end() {
    if (!T) return;
    clearInterval(tick);
    T.mic?.stop(); T.mic = null;
    timer.stop();
    ctx.setLive(false);
    if (T.cur && !T.cur.closed) { const cur = T.cur; collect(cur); if (cur.fol.words.slice(cur.card.hint).some((w) => w.status && w.status !== 'given')) { cur.closed = true; await cur.fol.finish(S.asr); collect(cur); } else { T.cards.pop(); await cur.fol.halt(); } }
    T.cur = null;
    T.phase = 'results';
    T.early = !over() && T.opts.endBy === 'count';
    for (const c of T.cards) if (c.fol) { /* keep words for the results view */ }
    showResults(T);
  }

  // ---------------------------------------------------------------- results
  let resSheet = null;
  function showResults(run, stored = false, redraw = false) { // redraw: the sheet is rebuilt after a remove / restore, so no entry motion again
    const live = !stored;
    const cards = run.cards;
    const sc = tally(cards, get('test.skipCounts'));
    const secs = live ? Math.round(timer.elapsedMs() / 1000) : run.seconds;
    resSheet?.close();
    const mrows = (list, restore) => list.map((m) => `<div class="ml-row"><div class="hz-ar ml-w"><b>${esc(m.word)}</b></div><div class="ml-m">${esc(t('r.ayahRef', { a: bn(m.a) }))} · ${esc(t(`r.kind.${m.kind}`))}</div><div class="btn-row"><button class="btn" data-rm="${m.ci}:${m.mi}">${esc(t(restore ? 'r.restore' : 'r.remove'))}</button></div></div>`).join('');
    const all = []; const gone = [];
    cards.forEach((c, ci) => (c.mistakes ?? []).forEach((m, mi) => (m.removed ? gone : all).push({ ...m, ci, mi })));
    const slips = cards.map((c, i) => `<button class="slip ${c.result}" data-slip="${i}" aria-label="${bn(i + 1)}"></button>`).join('');
    const html = `<h2>${esc(t('t.resTitle'))}${run.temporary || T?.temporary ? ` <small class="hp-note">${esc(t('t.tempLabel'))}</small>` : ''}</h2>
      ${live ? '' : `<p class="hp-note">${esc(t('h.testRow', { date: when(run.start), range: run.rangeName, p: sc.score === null ? '—' : bn(sc.score), c: bn(sc.pass), n: bn(sc.answered) }))}</p>`}<div class="tq-score" data-score="${sc.score ?? ''}">${esc(t('t.resScore', { p: sc.score === null ? '—' : bn(sc.score) }))}</div>
      <div class="tq-line">${esc(t('t.resCorrect', { c: bn(sc.pass), n: bn(sc.answered) }))} · ${esc(t('t.resBest', { s: bn(sc.bestStreak) }))} · ${esc(t('t.resTime', { time: formatTime(secs * 1000) }))}</div>
      <div class="slips">${slips}</div>
      <h3 class="hp-h">${esc(all.length ? t('t.resAll', { n: bn(all.length) }) : t('t.resNone'))}</h3>${mrows(all, false)}
      ${gone.length ? `<h3 class="hp-h">${esc(t('t.resRemoved', { n: bn(gone.length) }))}</h3>${mrows(gone, true)}` : ''}
      ${live ? '' : `<p class="hp-note">${esc(t('h.testEditNote'))}</p>`}<div class="btn-row">${live && run.early ? `<button class="btn" data-ra="keep">${esc(t('t.keepGoing'))}</button>` : ''}${live && !run.early ? `<button class="btn" data-ra="replay">${esc(t('t.replay'))}</button><button class="btn" data-ra="new">${esc(t('t.newTest'))}</button>` : ''}${live && !sel.saved && !run.temporary ? `<button class="btn" data-ra="save">${esc(t('t.saveThis'))}</button>` : ''}<button class="btn btn-primary" data-ra="done">${esc(t('t.done'))}</button></div>`;
    const sh = sheet(html, { cls: 'tq-res' });
    resSheet = sh;
    const scoreEl = sh.el.querySelector('.tq-score');
    const sealed = sc.score === 100 && sc.answered >= 1;
    if (sealed) scoreEl.classList.add('seal');
    if (!redraw && sc.score !== null) { // beat 7: the number counts up, mini-slips follow with a 30 ms stagger, a 100 % result draws its seal
      const fmt = (v) => t('t.resScore', { p: bn(v) });
      countUp(scoreEl, sc.score, fmt).then(() => { if (sealed && scoreEl.isConnected) rosette(scoreEl); });
      staggerSlips(sh.el.querySelector('.slips'));
    } else if (sealed) rosette(scoreEl);
    sh.el.addEventListener('click', async (e) => {
      const rm = e.target.closest('[data-rm]');
      const sl = e.target.closest('[data-slip]');
      if (sl) { cardSheet(cards[Number(sl.dataset.slip)]); return; }
      if (rm && !live) { // a stored test: only its own record and score change
        const [ci, mi] = rm.dataset.rm.split(':').map(Number);
        const nxt = toggleRemoved(run, ci, mi, get('test.skipCounts'));
        await S.store.set('tests', (S.store.get('tests', []) ?? []).map((x) => (x.id === nxt.id ? nxt : x)));
        showResults(nxt, true, true);
        ctx.refreshTests?.();
        return;
      }
      if (rm) {
        const [ci, mi] = rm.dataset.rm.split(':').map(Number);
        const c = cards[ci];
        const m = c.mistakes[mi];
        const cur = { fol: c.fol };
        if (m.removed) c.fol.restore(m.k); else c.fol.remove(m.k);
        collect({ card: c, fol: c.fol, skipped: c.result === 'skipped' });
        showResults(run, false, true);
        return;
      }
      const b = e.target.closest('[data-ra]');
      if (!b) return;
      const a = b.dataset.ra;
      if (a === 'keep') { sh.close(); T.phase = 'card'; T.gate = true; reopen(); return; }
      if (a === 'save') { openPicker({ spec: run.spec, memorized: mem(), onUse: () => {}, onSave: (spec, name, icon) => { const l = addRange(S.store.get('ranges', []) ?? [], { name, icon, spec }); if (!l) { toast(t('pk.full')); return false; } S.store.set('ranges', l); toast(t('pk.saved', { name })); return true; } }); return; }
      sh.close(); resSheet = null;
      if (live) await finalize(run);
      else if (a === 'done') drawSetup();
      const spec = run.spec; const name = run.name;
      T = null;
      if (a === 'replay') startRun(spec, name); else drawSetup();
    });
  }
  // one card of a finished test, read-only: its words with the result colours (spec 7.9.2)
  function cardSheet(c) {
    const cls = { given: 'hz-given', bad: 'hz-bad', fixed: 'hz-ok', ok: 'hz-ok', plain: '' };
    const text = cardWords(c).map((w) => `<span class="${cls[w.status]}">${esc(w.text)}</span>${w.end ? ` <span class="hz-end">${esc(ctx.endMark(c.s, w.a))}</span> ` : ' '}`).join('');
    const ml = (c.mistakes ?? []).map((m) => `<div class="ml-row"><div class="hz-ar ml-w"><b>${esc(m.word)}</b></div><div class="ml-m">${esc(t('r.ayahRef', { a: bn(m.a) }))} · ${esc(t(`r.kind.${m.kind}`))}${m.removed ? ' · ✓' : ''}</div></div>`).join('');
    const sp = span(c.a1, c.a2);
    const sh = sheet(`<div class="tq-card ${c.result ?? ''}" style="margin:0 0 12px"><div class="tq-head"><span class="tq-ref">${esc(t('t.ref', { n: bn(c.s), english: quran.surahInfo(c.s).english, span: sp }))}</span></div><div class="hz-text">${text}</div></div>${ml}<div class="btn-row"><button class="btn btn-primary" data-ok>${esc(t('t.done'))}</button></div>`, { cls: 'tq-res' });
    sh.el.querySelector('[data-ok]').addEventListener('click', () => sh.close());
  }
  async function reopen() { toast(t('t.continue')); T.phase = 'card'; T.gate = false; ctx.setLive(true); T.mic = await ctx.openMicSource((x) => { if (!T.gate && T.cur && !T.paused) T.cur.fol.addAudio(x); }, () => {}); timer.resume(); nextCard(); tick = setInterval(onTick, 150); }
  async function finalize(run) { // write the history when the results are left (spec 7.9.5)
    if (run.temporary) return;
    const stamp = isoLocal(run.startedAt).replace(/[-:]/g, '').replace('T', '_');
    const keep = get('history.saveRecordings');
    const cardsForHistory = [];
    for (const [i, c] of run.cards.entries()) {
      let name = null;
      if (keep && c.fol?.len > SAMPLE_RATE) { name = `${stamp}_t${i + 1}.wav`; await S.store.putBlob('recordings', name, c.fol.audio.slice()); S.recNames.add(name); }
      c.rec = name;
      if (c.fol) cardsForHistory.push({ words: c.fol.words.filter((w) => w.status !== 'given'), rec: name });
    }
    S.history.recordTest(cardsForHistory, run.startedAt, Math.round(timer.elapsedMs() / 1000), { countInHistory: get('test.countInHistory') });
    await S.store.set('sessions', S.history.data.sessions); await S.store.set('weak', S.history.data.weak);
    const l = (S.store.get('tests', []) ?? []).filter((x) => x.id !== run.id);
    await S.store.set('tests', [...l, serialize('done')].slice(-500));
    ctx.refreshProgress();
  }
  function resume(rec) {
    if (!rec) return;
    sel = { spec: rec.rangeSpec, name: rec.rangeName, saved: false };
    startRun(rec.rangeSpec, rec.rangeName);
    if (T) { T.cards = []; T.seed = rec.seed + rec.cards.length; T.gen = createGenerator(T.runs, T.opts, T.seed, weakScore); T.id = rec.id; }
  }

  // ---------------------------------------------------------------- drawing a running test
  const cardSpans = (v) => v.items.map((it, idx) => {
    const cls = [];
    if (it.status === null) { cls.push('hz-hid'); if (it.here) cls.push('hz-next'); } else cls.push({ correct: 'hz-ok', missed: 'hz-bad hz-err', hint: 'hz-hint', pending: 'hz-pend', given: 'hz-given' }[it.status]);
    if (it.weak) cls.push(`hz-w${it.weak}`);
    return `<span class="${cls.join(' ')}"${it.status === 'missed' ? ` data-err="${idx}"` : ''}>${esc(it.text)}</span>${it.ayahEnd && it.status !== null ? ` <span class="hz-end">${esc(quran.surahInfo(it.ayahEnd.surah) && ctx.endMark(it.ayahEnd.surah, it.ayahEnd.ayah))}</span> ` : ' '}`;
  }).join('');
  let lastDraw = '';
  function drawRun(fromTick = false) {
    if (!T || T.phase === 'results') return;
    const sc = tally(T.cards.filter((c) => c.result), get('test.skipCounts'));
    const sh = T.shown ?? T.cur;
    const total = T.opts.endBy === 'count' ? T.opts.questions : null;
    const i = T.cards.length;
    const q = T.opts.endBy === 'count' ? t('t.qOfN', { i: bn(Math.min(i, total)), n: bn(total) }) : T.opts.endBy === 'time' ? t('t.qTime', { i: bn(i), mm: formatTime(Math.max(0, T.opts.minutes * 60000 - timer.elapsedMs())).slice(0, 5) }) : t('t.qOpen', { i: bn(i) });
    const mist = T.cards.reduce((n, c) => n + cardMistakes(c), 0);
    const slips = T.cards.map((c, k) => `<i class="slip ${c.result ?? ''} ${sh && c === sh.card ? 'cur' : ''}"></i>`).join('') + (total ? Array.from({ length: Math.max(0, total - T.cards.length) }, () => '<i class="slip"></i>').join('') : '');
    let body = '';
    if (sh) {
      const v = sh.fol.view();
      const st = sh.card.result && sh.status !== 'listening' ? sh.card.result : '';
      const first = sh.fol.words[0];
      const ref = T.showRef ? t('t.ref', { n: bn(first.surah), english: quran.surahInfo(first.surah).english, span: span(sh.card.a1, sh.card.a2) }) : t('t.refHidden');
      const stamp = st === 'pass' ? '<span class="stamp ok">✓</span>' : st === 'fail' ? '<span class="stamp bad">✗</span>' : '';
      const status = sh.status === 'checking' ? t('t.checking') : sh.status === 'skipped' ? t('t.skipped') : st === 'pass' ? t('t.pass') : st === 'fail' ? t('t.failN', { m: bn(cardMistakes(sh.card)) }) : T.opts.endBy === 'time' && over() ? t('t.timeUp') : t('t.listening');
      body = `<div class="tq-card ${st} ${sh.status === 'listening' ? 'listening' : ''}">${stamp}<div class="tq-head"><span class="tq-ref">${esc(ref)}</span></div><div class="hz-text" data-live="${T.paused ? 0 : 1}">${cardSpans(v)}</div>
        ${v.stray ? `<div class="hz-banner hz-stray">${esc(t('t.kind.stray'))}</div>` : ''}${v.block ? `<div class="hz-banner hz-block">${esc(t('r.blockBanner'))}</div>` : ''}
        <div class="tq-status">${esc(status)}</div><div class="tq-foot"><button class="btn" data-tt="word">${esc(t('t.peekWord'))}</button><button class="btn" data-tt="rest">${esc(t('t.peekRest'))}</button><button class="btn" data-tt="next">${esc(t('t.next'))}</button></div></div>`;
    }
    const out = `<div class="tq-run"><div class="tq-top"><span>${esc(q)}</span><button class="hz-stat hz-bad" data-tt="mlist">${esc(t('t.mistakesN', { m: bn(mist) }))}</button><span>${esc(t('t.score', { p: sc.score === null ? '—' : bn(sc.score) }))}</span>${sc.streak >= get('test.streakAt') ? `<span class="tq-flame">${ICONS.flame}${esc(t('t.streak', { s: bn(sc.streak) }))}</span>` : ''}</div><div class="slips">${slips}</div>${body}
      ${T.paused ? `<div class="hz-banner hz-paused">${esc(t('t.paused'))}<div class="btn-row"><button class="btn btn-primary" data-tt="continue">${esc(t('t.continue'))}</button><button class="btn btn-red" data-tt="end">${esc(t('t.end'))}</button></div></div>` : ''}</div>`;
    if (fromTick && out === lastDraw) return;
    lastDraw = out;
    const keep = el.querySelector('.tq-count');
    const swap = sh && T.lastShown !== sh.card;
    T.lastShown = sh?.card;
    el.innerHTML = out;
    if (swap) el.querySelector('.tq-card')?.classList.add('swap');
    if (keep) el.append(keep);
  }
  el?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tt]');
    if (b && T) {
      const a = b.dataset.tt;
      if (a === 'word') peek(false); else if (a === 'rest') peek(true); else if (a === 'next') skip(); else if (a === 'continue') pause(); else if (a === 'end') end();
      else if (a === 'mlist') showResults({ ...T, early: true, startedAt: T.startedAt }, false);
      return;
    }
    const err = e.target.closest('[data-err]');
    if (err && T) { const sh = T.shown; if (sh) ctx.errorPopup(sh.fol.view().items[Number(err.dataset.err)], sh.fol); }
  });
  el?.addEventListener('dblclick', () => { if (T?.phase === 'card' && get('test.doubleTapPeek')) peek(false); });
  let sx = null;
  el?.addEventListener('pointerdown', (e) => { sx = e.clientX; });
  el?.addEventListener('pointerup', (e) => { if (sx !== null && T?.phase === 'card' && Math.abs(e.clientX - sx) > 60 && e.target.closest('.tq-card')) skip(); sx = null; });

  return {
    show() { if (!T) drawSetup(); else drawRun(); },
    live: () => !!T && T.phase === 'card' && !T.paused,
    active: () => !!T,
    onTool(name) {
      if (name === 'rec') { if (!T) { if (sel.spec) startRun(); } else if (T.phase === 'card') end(); }
      else if (name === 'pause') pause();
      else if (name === 'eye') { if (T) { T.showRef = !T.showRef; drawRun(); } }
      else if (name === 'hint') peek(false);
      else if (name === 'rest') peek(true);
      else if (name === 'next') skip();
    },
    setSpec(spec, name = '') { sel = { spec, name, saved: false }; if (!T) drawSetup(); },
    startFromHook(spec) { sel = { spec: spec ?? { parts: [{ k: 'surah', s: 93 }] }, name: '', saved: false }; return startRun(); },
    state: () => (T ? { phase: T.phase, cards: T.cards.map((c) => ({ result: c.result, mistakes: cardMistakes(c), a1: c.a1, a2: c.a2 })), paused: T.paused, temporary: T.temporary, ...tally(T.cards, true) } : { phase: 'setup' }),
    pending,
    showStored(rec) { showResults(rec, true); },
    openStored(id) { const r = (S.store.get('tests', []) ?? []).find((x) => x.id === id); if (r) showResults(r, true); },
  };
}
