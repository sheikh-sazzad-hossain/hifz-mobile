/* Start-up animation "মুসহাফ খোলা" (C17, হিফজুন নূর look): a closed mushaf (the app icon's cover) opens from the RIGHT, then the
   pages turn ONE BY ONE and slowly (about 1.2 s each) and keep turning while the app is still loading. When the app is ready, the page
   that is turning finishes, and the visible right-hand page morphs into the Home tab's “আজকের আয়াত” card (C20; on the মুখস্থ tab: its Quran-text area .hz-text); then the
   overlay is gone. Every page is blank (no Quran text). A CLASSIC script (not a module) loaded in <head>, so the overlay is on screen
   before the first paint of the app. All its CSS is injected from here. Transform / opacity only (plus the page colour of the morph).
   Public: globalThis.HifzIntro = { decide, nextStep, morphRect, localDay, resolveMotion, start, ready, label, gone, skip, freeze, resume }.
   Settings: view.intro (every | daily | off) and view.motion (full -> full intro; gentle / off -> 300 ms fade only), both read from the
   localStorage mirror 'hifz-view' (written by app/view.js). 'daily' remembers the last day in 'hifz-introday' (and kv ui.introDay).
   Timing rules: the first move waits until the page is visible, the overlay has painted (2 animation frames) and the fonts are ready
   (or 600 ms); a hidden page pauses the turns; at least 2 page turns; no new turn after 12 s of visible time. */
(function () {
  'use strict';
  var G = typeof globalThis !== 'undefined' ? globalThis : window;

  var T_COVER = 1100, T_TURN = 1200, T_PAUSE = 260, T_MORPH = 820, MIN_TURNS = 2, CAP = 12000;

  /* pure decision: returns 'full' | 'fade' | 'none'. intro = every|daily|off; motion = resolved full|gentle|off */
  function decide(o) {
    var intro = o.intro || 'every';
    if (o.live) return 'none';
    if (intro === 'off') return 'none';
    if (intro === 'daily' && o.lastDay && o.lastDay === o.today) return 'none';
    return o.motion === 'full' ? 'full' : 'fade';
  }
  /* pure: after a page has landed, turn the next one or finish? turns = pages turned so far, elapsed = visible ms since start */
  function nextStep(o) {
    if (o.turns < MIN_TURNS) return 'turn'; // at least 2 full page turns, even when the app is ready at once
    if (o.ready) return 'finish';
    return o.elapsed + T_PAUSE + T_TURN > CAP ? 'finish' : 'turn';
  }
  /* pure: where the morph goes. src / tgt = {left, top, width, height}; vw / vh = viewport. Returns null when the target is not on screen
     (then the caller fades), else { box (the target clipped to the screen), dx, dy, sx, sy } for transform-origin 0 0 */
  function morphRect(src, tgt, vw, vh) {
    if (!tgt || !(tgt.width > 0) || !(tgt.height > 0)) return null;
    var top = Math.max(tgt.top, 0), bottom = Math.min(tgt.top + tgt.height, vh);
    var left = Math.max(tgt.left, 0), right = Math.min(tgt.left + tgt.width, vw);
    if (bottom - top < 48 || right - left < 48) return null; // not (enough of it) on screen
    var box = { left: left, top: top, width: right - left, height: bottom - top };
    return { box: box, dx: src.left - box.left, dy: src.top - box.top, sx: src.width / box.width, sy: src.height / box.height };
  }
  function localDay(d) {
    d = d || new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function resolveMotion(m) {
    if (!m || m === 'auto') return (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'gentle' : 'full';
    return m;
  }

  var api = { decide: decide, nextStep: nextStep, morphRect: morphRect, localDay: localDay, resolveMotion: resolveMotion, active: false,
    T: { cover: T_COVER, turn: T_TURN, pause: T_PAUSE, morph: T_MORPH, minTurns: MIN_TURNS, cap: CAP } };
  G.HifzIntro = api;
  if (typeof document === 'undefined') return; // node (tests): only the pure functions

  var goneResolve = null;
  api.gone = new Promise(function (r) { goneResolve = r; });
  api.ready = function () {};
  api.label = function () {};
  api.skip = function () {};
  api.freeze = function () {};
  api.resume = function () {};

  /* the হিফজুন নূর palette: white / very light navy pages with green lines (light), navy pages (dark); the cover stays the icon's */
  var TH = {
    light: { bg: '#F6F9F5', page: '#FFFFFF', page2: '#EEF5EC', edge: '#DEE8DB', line: '#A8D5A2', lineO: '.9', ink: '#4A5E50', shade: 'rgba(20,60,30,.10)', drop: 'rgba(20,60,30,.18)', surface: '#E8F2FB' },
    dark: { bg: '#173F22', page: '#285A34', page2: '#1F4D2B', edge: '#2F6239', line: '#93EEAC', lineO: '.45', ink: '#BFD5C3', shade: 'rgba(0,0,0,.22)', drop: 'rgba(0,0,0,.40)', surface: '#285A34' }
  };
  var CSS =
    '#hz-intro{position:fixed;inset:0;z-index:99999;overflow:hidden;display:grid;place-items:center;touch-action:none;cursor:pointer;contain:strict}' +
    '#hz-intro .hi-bg{position:absolute;inset:0;background:var(--bg)}' +
    '#hz-intro .hi-scene{position:relative;perspective:1400px;width:0;height:0}' +
    '#hz-intro .hi-shift,#hz-intro .hi-book{position:absolute;transform-style:preserve-3d}' +
    '#hz-intro .hi-shift{left:0;top:0;will-change:transform}' +
    '#hz-intro .hi-book{left:calc(var(--w) / -2);top:calc(var(--h) / -2);width:var(--w);height:var(--h)}' +
    '#hz-intro .hi-base,#hz-intro .hi-rbase,#hz-intro .hi-leaf{position:absolute;top:0;bottom:0;width:var(--w)}' +
    '#hz-intro .hi-base{left:0;transform:translateZ(-4px);border-radius:6px 2px 2px 6px;box-shadow:-3px 4px 0 -1px var(--edge),-6px 8px 0 -2px var(--edge),0 12px 26px var(--drop)}' +
    '#hz-intro .hi-rbase{left:var(--w);transform:translateZ(-4px);border-radius:2px 6px 6px 2px;box-shadow:3px 4px 0 -1px var(--edge),6px 8px 0 -2px var(--edge),0 12px 26px var(--drop);visibility:hidden}' +
    '#hz-intro .hi-leaf{left:0;transform-origin:100% 50%;transform-style:preserve-3d;will-change:transform}' +
    '#hz-intro .hi-f{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;border-radius:6px 2px 2px 6px}' +
    '#hz-intro .hi-back{transform:rotateY(180deg);border-radius:2px 6px 6px 2px}' +
    '#hz-intro .hi-page,#hz-intro .hi-base{background:linear-gradient(to left,var(--shade),rgba(0,0,0,0) 18%),var(--page)}' +
    '#hz-intro .hi-turned,#hz-intro .hi-rbase{background:linear-gradient(to right,var(--shade),rgba(0,0,0,0) 18%),var(--page)}' +
    '#hz-intro .hi-page:after,#hz-intro .hi-base:after,#hz-intro .hi-turned:after,#hz-intro .hi-rbase:after{content:"";position:absolute;inset:9% 9% 9% 10%;border:1px solid var(--line);border-radius:3px;opacity:var(--lineO)}' +
    '#hz-intro .hi-inside{background:linear-gradient(to right,var(--shade),rgba(0,0,0,0) 22%),var(--page2)}' +
    '#hz-intro .hi-cover svg{display:block;width:100%;height:100%;border-radius:12px}' +
    '#hz-intro .hi-morph{position:fixed;transform-origin:0 0;will-change:transform,opacity;pointer-events:none}' +
    '#hz-intro .hi-label{position:absolute;left:0;right:0;top:calc(50% + var(--h) / 2 + 28px);text-align:center;color:var(--ink);font:600 1rem/1.4 "Hind Siliguri",system-ui,sans-serif;opacity:0;transition:opacity .2s}' +
    '#hz-intro .hi-label.on{opacity:1}#hz-intro .hi-tick{position:absolute;width:0;height:0}' +
    '@media (prefers-reduced-motion:reduce){#hz-intro .hi-label{transition:none}}';

  function coverSvg() { // the same drawing as the app icon (shared/icon/mushaf-icon.svg #cover): no letters, no Quran text
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="116 68 282 368" preserveAspectRatio="none" aria-hidden="true"><defs>' +
      '<linearGradient id="hiL" x1="0" y1="0" x2="1" y2="1"><stop offset=".12" stop-color="#0B5D3B"/><stop offset=".88" stop-color="#5B2A86"/></linearGradient>' +
      '<linearGradient id="hiS" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#094A30"/><stop offset="1" stop-color="#3C1B5C"/></linearGradient>' +
      '<linearGradient id="hiG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F1D77A"/><stop offset="1" stop-color="#C9A227"/></linearGradient></defs>' +
      '<rect x="116" y="68" width="282" height="368" rx="12" fill="url(#hiL)"/><rect x="116" y="68" width="282" height="368" rx="12" fill="none" stroke="#E6C85E" stroke-width="3"/>' +
      '<path d="M358 68H386a12 12 0 0 1 12 12V424a12 12 0 0 1-12 12H358Z" fill="url(#hiS)"/><path d="M358 68V436" stroke="#E6C85E" stroke-width="3"/>' +
      '<path d="M358 128H398M358 256H398M358 384H398" stroke="url(#hiG)" stroke-width="6"/>' +
      '<rect x="138" y="90" width="198" height="324" rx="6" fill="none" stroke="url(#hiG)" stroke-width="5"/><rect x="150" y="102" width="174" height="300" rx="3" fill="none" stroke="url(#hiG)" stroke-width="2"/>' +
      '<g transform="translate(237 252)" fill="none" stroke="url(#hiG)"><circle r="62" stroke-width="5"/><circle r="54" stroke-width="2"/><rect x="-38" y="-38" width="76" height="76" stroke-width="5"/>' +
      '<rect x="-38" y="-38" width="76" height="76" stroke-width="5" transform="rotate(45)"/><circle r="16" fill="url(#hiG)" stroke="none"/></g></svg>';
  }

  var E_TURN = 'cubic-bezier(.45,.05,.35,1)', E_MORPH = 'cubic-bezier(.4,0,.2,1)';

  function read(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function rectOf(el) { var r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }

  /* start(opts): opts.force (ignore the setting), opts.mode ('full'|'fade') */
  function start(opts) {
    opts = opts || {};
    var h = document.documentElement;
    var v = read('hifz-view') || {};
    var today = localDay();
    var live = h.dataset.live === '1';
    var mode = opts.mode || decide({ intro: v['view.intro'], motion: resolveMotion(v['view.motion']), today: today, lastDay: localStorage.getItem('hifz-introday'), live: live });
    if (opts.force && mode === 'none' && !live) mode = 'full';
    if (mode === 'none') { goneResolve(); return null; }
    try { localStorage.setItem('hifz-introday', today); } catch (e) { /* private mode */ }
    var old = document.getElementById('hz-intro'); if (old) old.remove();
    var oldCss = document.getElementById('hz-intro-css'); if (oldCss) oldCss.remove();

    var th = TH[h.dataset.theme] || (h.classList.contains('dark') ? TH.dark : TH.light);
    var W = Math.round(Math.min(innerWidth * 0.42, innerHeight * 0.5 / 1.305, 250));
    var H = Math.round(W * 1.305);
    var st = document.createElement('style'); st.id = 'hz-intro-css'; st.textContent = CSS;
    var o = document.createElement('div');
    o.id = 'hz-intro'; o.setAttribute('aria-hidden', 'true');
    o.style.cssText = '--bg:' + th.bg + ';--w:' + W + 'px;--h:' + H + 'px;--page:' + th.page + ';--page2:' + th.page2 + ';--edge:' + th.edge + ';--line:' + th.line +
      ';--lineO:' + th.lineO + ';--ink:' + th.ink + ';--shade:' + th.shade + ';--drop:' + th.drop;
    o.innerHTML = '<div class="hi-bg"></div><div class="hi-scene"><div class="hi-shift"><div class="hi-book"><div class="hi-base"></div><div class="hi-rbase"></div>' +
      '<div class="hi-leaf hi-p" style="transform:translateZ(2px)"><div class="hi-f hi-front hi-page"></div><div class="hi-f hi-back hi-turned"></div></div>' +
      '<div class="hi-leaf hi-cover" style="transform:translateZ(5px)"><div class="hi-f hi-front">' + coverSvg() + '</div><div class="hi-f hi-back hi-inside"></div></div>' +
      '</div></div></div><div class="hi-label" role="status"></div><i class="hi-tick"></i>';
    (document.head || h).appendChild(st);
    h.appendChild(o);

    var bg = o.querySelector('.hi-bg'), scene = o.querySelector('.hi-scene'), shift = o.querySelector('.hi-shift'), cover = o.querySelector('.hi-cover');
    var leaf = o.querySelector('.hi-p'), rbase = o.querySelector('.hi-rbase'), lab = o.querySelector('.hi-label'), tick = o.querySelector('.hi-tick');

    /* ---- visible-time clock + pausable steps (every step is a Web Animation, so a hidden page pauses all of it) ---- */
    var running = [];
    var t0 = 0, hiddenSince = 0, hiddenMs = 0, frozen = false;
    function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }
    function elapsed() { return t0 ? now() - t0 - hiddenMs - (hiddenSince ? now() - hiddenSince : 0) : 0; }
    function track(a) { running.push(a); var drop = function () { var i = running.indexOf(a); if (i >= 0) running.splice(i, 1); }; a.finished.then(drop, drop); return a; }
    function wait(ms) { return track(tick.animate([{ opacity: 1 }, { opacity: 1 }], { duration: ms })).finished; } // a pausable pause
    function onVis() {
      if (state === 'gone') return;
      if (document.visibilityState === 'hidden') { if (!hiddenSince) hiddenSince = now(); running.forEach(function (a) { a.pause(); }); }
      else { if (hiddenSince) { hiddenMs += now() - hiddenSince; hiddenSince = 0; } if (!frozen) running.forEach(function (a) { a.play(); }); }
    }
    document.addEventListener('visibilitychange', onVis);

    var state = 'wait'; // wait -> run -> ending -> gone
    var readyFlag = false, turns = 0;
    function remove() {
      if (state === 'gone') return; state = 'gone';
      clearInterval(guard);
      o.remove(); st.remove(); api.active = false; goneResolve();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('visibilitychange', onVis);
    }
    function openPose() { // the cover lies open on the right, the spread is centred
      shift.style.transform = 'translateX(' + (-W / 2) + 'px)';
      cover.style.transform = 'translateZ(-6px) rotateY(180deg)';
    }
    function fade(ms) {
      if (state === 'ending' || state === 'gone') return;
      state = 'ending';
      running.forEach(function (a) { a.pause(); });
      lab.classList.remove('on');
      var a = o.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'linear', fill: 'forwards' });
      a.finished.then(remove, remove);
    }
    function morph() { // the visible right-hand page becomes the Quran-text area of the তিলাওয়াত tab
      if (state !== 'run') return;
      // C20: the Home tab's "আজকের আয়াত" card; on the মুখস্থ tab (a #recite link) the Quran text (.hz-text), else its card #hz-live
      var tgtEl = document.querySelector('#panel-home:not([hidden]) #hm-ayah') || document.querySelector('#panel-recite:not([hidden]) #hz-live .hz-text') || document.querySelector('#panel-recite:not([hidden]) #hz-live');
      var rad = tgtEl && (tgtEl.id === 'hz-live' || tgtEl.id === 'hm-ayah') ? '20px' : '16px';
      var src = rectOf(rbase.style.visibility === 'visible' ? rbase : o.querySelector('.hi-inside'));
      var m = tgtEl && morphRect(src, rectOf(tgtEl), innerWidth, innerHeight);
      if (!m) { fade(300); return; }
      state = 'ending';
      lab.classList.remove('on');
      var b = m.box, k = document.createElement('div');
      k.className = 'hi-morph';
      k.style.cssText = 'left:' + b.left + 'px;top:' + b.top + 'px;width:' + b.width + 'px;height:' + b.height + 'px;background:' + th.page;
      o.appendChild(k);
      rbase.style.visibility = 'hidden'; // the morph sits exactly on it: no jump
      var from = 'translate(' + m.dx + 'px,' + m.dy + 'px) scale(' + m.sx + ',' + m.sy + ')';
      var r0 = (2 / m.sx) + 'px ' + (6 / m.sx) + 'px ' + (6 / m.sx) + 'px ' + (2 / m.sx) + 'px / ' + (2 / m.sy) + 'px ' + (6 / m.sy) + 'px ' + (6 / m.sy) + 'px ' + (2 / m.sy) + 'px';
      var a = k.animate([
        { offset: 0, transform: from, borderRadius: r0, backgroundColor: th.page, opacity: 1 },
        { offset: 0.72, transform: 'none', borderRadius: rad, backgroundColor: th.surface, opacity: 1 },
        { offset: 1, transform: 'none', borderRadius: rad, backgroundColor: th.surface, opacity: 0 }
      ], { duration: T_MORPH, easing: E_MORPH, fill: 'forwards' });
      track(scene.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T_MORPH * 0.3, easing: 'linear', fill: 'forwards' }));
      track(bg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T_MORPH * 0.65, delay: T_MORPH * 0.1, easing: 'linear', fill: 'forwards' }));
      track(a).finished.then(remove, remove);
    }
    function afterLanding() {
      if (state !== 'run') return;
      var step = nextStep({ turns: turns, ready: readyFlag, elapsed: elapsed() });
      if (step === 'finish') { if (mode === 'full') morph(); else fade(300); return; }
      if (turns >= MIN_TURNS && !readyFlag) lab.classList.add('on'); // still loading: "প্রস্তুত হচ্ছে…" under the book
      wait(T_PAUSE).then(turnOne, function () {});
    }
    function turnOne() { // one page, right to left over the spine; it lands on the right-hand stack and the leaf is reused
      if (state !== 'run') return;
      if (readyFlag && turns >= MIN_TURNS) { morph(); return; }
      var a = track(leaf.animate([{ transform: 'translateZ(2px) rotateY(0deg)' }, { transform: 'translateZ(-2px) rotateY(180deg)' }], { duration: T_TURN, easing: E_TURN }));
      a.finished.then(function () {
        turns++;
        rbase.style.visibility = 'visible'; // the turned page now lies on the right
        leaf.style.transform = 'translateZ(2px)'; // and the leaf is back on the left stack, looking like the next page
        afterLanding();
      }, function () {});
    }
    function begin() { // the overlay is on screen and painted: open the cover, then the pages
      if (state !== 'wait') return;
      state = 'run'; t0 = now();
      if (mode !== 'full') { // gentle / off: the book is shown open and still; when ready, a 300 ms fade
        openPose(); rbase.style.visibility = 'visible';
        var poll = function () { if (state !== 'run') return; if (readyFlag || elapsed() >= CAP) fade(300); else { lab.classList.add('on'); wait(200).then(poll, function () {}); } };
        poll();
        return;
      }
      track(shift.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(' + (-W / 2) + 'px)' }], { duration: T_COVER, easing: E_TURN, fill: 'forwards' }));
      var c = track(cover.animate([{ transform: 'translateZ(5px) rotateY(0deg)' }, { transform: 'translateZ(-6px) rotateY(180deg)' }], { duration: T_COVER, easing: E_TURN, fill: 'forwards' }));
      c.finished.then(function () { openPose(); wait(T_PAUSE).then(turnOne, function () {}); }, function () {});
    }
    function gate() { // visible + painted (2 frames) + fonts ready (or 600 ms)
      if (state !== 'wait') return;
      if (document.visibilityState !== 'visible') { document.addEventListener('visibilitychange', function once() { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', once); gate(); } }); return; }
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
        Promise.race([fonts, new Promise(function (r) { setTimeout(r, 600); })]).then(begin, begin);
      }); });
    }

    api.ready = function () { readyFlag = true; }; // the page that is turning finishes first: afterLanding / turnOne pick the flag up
    api.label = function (text) { lab.textContent = text; };
    api.skip = function () { if (state === 'wait' || state === 'run') fade(150); };
    api.freeze = function () { frozen = true; running.forEach(function (a) { a.pause(); }); }; // QA screenshots only
    api.resume = function () { frozen = false; running.forEach(function (a) { a.play(); }); };
    function onKey() { api.skip(); }
    o.addEventListener('pointerdown', function (e) { e.preventDefault(); api.skip(); });
    o.addEventListener('click', function () { api.skip(); });
    document.addEventListener('keydown', onKey, true);
    var born = now();
    var guard = setInterval(function () {
      if (frozen) return;
      if (state === 'wait' ? (document.visibilityState === 'visible' && now() - born > CAP + 8000) : elapsed() > CAP + 8000) remove();
    }, 1000); // a page that never paints (no animation frames) or a stuck step cannot keep the app covered
    api.active = true;
    api.mode = mode;
    api.heldBoot = h.classList.contains('st-boot'); // the app's own opening beat waits until the book is gone (see main.js)
    h.classList.remove('st-boot');
    api.root = o;
    api.element = o;
    api.state = function () { return { state: state, turns: turns, ready: readyFlag, elapsed: Math.round(elapsed()) }; };
    // text for the "preparing" line is set by main.js (api.label) once the strings are loaded; Bengali until then
    lab.textContent = 'প্রস্তুত হচ্ছে…';
    gate();
    return o;
  }
  api.start = start;

  // kicked off at once from <head>, unless ?nointro=1 (test runs)
  if (!/[?&]nointro=1/.test(location.search)) start();
  else goneResolve();
})();
