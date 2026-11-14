/* Start-up animation "মুসহাফ খোলা": a closed mushaf (the app icon's cover) opens from the RIGHT, the pages turn one by one and the
   last page stays blank; then the open book dissolves into the app. A CLASSIC script (not a module) loaded in <head>, so the overlay is on
   screen before the first paint of the app. All its CSS is injected from here. Transform / opacity only.
   Public: globalThis.HifzIntro = { decide, start, ready, label, gone, skip }.
   Settings: view.intro (every | daily | off) and view.motion (full -> full intro; gentle / off -> 300 ms fade only), both read from the
   localStorage mirror 'hifz-view' (written by app/view.js). 'daily' remembers the last day in 'hifz-introday' (and kv ui.introDay). */
(function () {
  'use strict';
  var G = typeof globalThis !== 'undefined' ? globalThis : window;

  /* pure decision: returns 'full' | 'fade' | 'none'. intro = every|daily|off; motion = resolved full|gentle|off */
  function decide(o) {
    var intro = o.intro || 'every';
    if (intro === 'off') return 'none';
    if (intro === 'daily' && o.lastDay && o.lastDay === o.today) return 'none';
    return o.motion === 'full' ? 'full' : 'fade';
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

  var api = { decide: decide, localDay: localDay, resolveMotion: resolveMotion, active: false };
  G.HifzIntro = api;
  if (typeof document === 'undefined') return; // node (tests): only the pure functions

  var goneResolve = null;
  api.gone = new Promise(function (r) { goneResolve = r; });
  api.ready = function () {};
  api.label = function () {};
  api.skip = function () {};

  var TH = {
    paper: { bg: '#F6F1E6', page: '#FFFCF5', page2: '#EFE7D6', gold: '#A8803A', ink: '#5A6170' },
    night: { bg: '#11151B', page: '#232A35', page2: '#181D25', gold: '#C7A257', ink: '#A3A9B4' },
    sepia: { bg: '#EADFC6', page: '#F4EAD3', page2: '#E3D5B6', gold: '#94702E', ink: '#5C4E3E' }
  };
  var CSS =
    '#hz-intro{position:fixed;inset:0;z-index:99999;overflow:hidden;display:grid;place-items:center;touch-action:none;cursor:pointer}' +
    '#hz-intro .hi-scene{position:relative;perspective:1200px;width:0;height:0}' +
    '#hz-intro .hi-shift,#hz-intro .hi-book{position:absolute;transform-style:preserve-3d}' +
    '#hz-intro .hi-shift{left:0;top:0;will-change:transform}' +
    '#hz-intro .hi-book{left:calc(var(--w) / -2);top:calc(var(--h) / -2);width:var(--w);height:var(--h)}' +
    '#hz-intro .hi-base,#hz-intro .hi-leaf{position:absolute;inset:0}' +
    '#hz-intro .hi-base{left:-8px;bottom:-6px;top:6px;transform:translateZ(-12px);border-radius:6px;background:var(--page);box-shadow:0 10px 24px rgba(0,0,0,.22)}' +
    '#hz-intro .hi-leaf{transform-origin:100% 50%;transform-style:preserve-3d;will-change:transform}' +
    '#hz-intro .hi-f{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;border-radius:6px}' +
    '#hz-intro .hi-back{transform:rotateY(180deg)}' +
    '#hz-intro .hi-page,#hz-intro .hi-base{background:linear-gradient(to left,rgba(0,0,0,.09),rgba(0,0,0,0) 20%),var(--page)}' +
    '#hz-intro .hi-page:after,#hz-intro .hi-base:after{content:"";position:absolute;inset:9% 8% 9% 11%;border:1px solid var(--gold);opacity:.55}' +
    '#hz-intro .hi-page{border:1px solid rgba(0,0,0,.08)}' +
    '#hz-intro .hi-inside{background:linear-gradient(to right,rgba(0,0,0,.1),rgba(0,0,0,0) 22%),var(--page2)}' +
    '#hz-intro .hi-cover svg{display:block;width:100%;height:100%;border-radius:12px}' +
    '#hz-intro .hi-label{position:absolute;left:0;right:0;top:calc(50% + var(--h) / 2 + 28px);text-align:center;color:var(--ink);font:600 1rem/1.4 "Hind Siliguri",system-ui,sans-serif;opacity:0;transition:opacity .2s}' +
    '#hz-intro .hi-label.on{opacity:1}' +
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

  var PAGES = 4;
  var E_PAGE = 'cubic-bezier(.22,.8,.24,1)', E_EXIT = 'cubic-bezier(.4,0,1,1)';

  function read(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }

  /* start(opts): opts.force (ignore the setting), opts.mode ('full'|'fade'), opts.at (ms: build paused at this time, for screenshots) */
  function start(opts) {
    opts = opts || {};
    var h = document.documentElement;
    var v = read('hifz-view') || {};
    var today = localDay();
    var mode = opts.mode || decide({ intro: v['view.intro'], motion: resolveMotion(v['view.motion']), today: today, lastDay: localStorage.getItem('hifz-introday') });
    if (opts.force && mode === 'none') mode = 'full';
    if (mode === 'none') { goneResolve(); return null; }
    try { localStorage.setItem('hifz-introday', today); } catch (e) { /* private mode */ }
    var old = document.getElementById('hz-intro'); if (old) old.remove();
    var oldCss = document.getElementById('hz-intro-css'); if (oldCss) oldCss.remove();

    var theme = TH[h.dataset.theme] || TH.paper;
    var W = Math.round(Math.min(innerWidth * 0.44, innerHeight * 0.5 / 1.305, 260));
    var H = Math.round(W * 1.305);
    var st = document.createElement('style'); st.id = 'hz-intro-css'; st.textContent = CSS;
    var o = document.createElement('div');
    o.id = 'hz-intro'; o.setAttribute('aria-hidden', 'true');
    o.style.cssText = 'background:' + theme.bg + ';--w:' + W + 'px;--h:' + H + 'px;--page:' + theme.page + ';--page2:' + theme.page2 + ';--gold:' + theme.gold + ';--ink:' + theme.ink;
    var leaves = '<div class="hi-leaf hi-cover" style="transform:translateZ(8px)"><div class="hi-f hi-front">' + coverSvg() + '</div><div class="hi-f hi-back hi-inside"></div></div>';
    for (var i = 1; i <= PAGES; i++) leaves += '<div class="hi-leaf hi-p" data-i="' + i + '" style="transform:translateZ(' + (8 - 2 * i) + 'px)"><div class="hi-f hi-front hi-page"></div><div class="hi-f hi-back hi-page"></div></div>';
    o.innerHTML = '<div class="hi-scene"><div class="hi-shift"><div class="hi-book"><div class="hi-base"></div>' + leaves + '</div></div></div><div class="hi-label" role="status"></div>';
    (document.head || h).appendChild(st);
    h.appendChild(o);

    var shift = o.querySelector('.hi-shift'), cover = o.querySelector('.hi-cover'), pages = o.querySelectorAll('.hi-p'), lab = o.querySelector('.hi-label');
    var anims = [];
    var openAt = 0, endTimer = 0, failsafe = 0;
    var T_COVER = 200, D_COVER = 640, P0 = 640, STAG = 150, D_PAGE = 480;
    function leafKeys(z0, z1, deg) { return [{ transform: 'translateZ(' + z0 + 'px) rotateY(0deg)' }, { transform: 'translateZ(' + z1 + 'px) rotateY(' + deg + 'deg)' }]; }
    var finalPose = function () {
      shift.style.transform = 'translateX(' + (-W / 2) + 'px)';
      cover.style.transform = 'translateZ(-8px) rotateY(180deg)';
      pages.forEach(function (p, k) { var i = k + 1; p.style.transform = 'translateZ(' + (-(8 - 2 * i)) + 'px) rotateY(180deg)'; });
    };
    if (mode === 'full') {
      anims.push(shift.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(' + (-W / 2) + 'px)' }], { duration: D_COVER, delay: T_COVER, easing: E_PAGE, fill: 'both' }));
      anims.push(cover.animate(leafKeys(8, -8, 180), { duration: D_COVER, delay: T_COVER, easing: E_PAGE, fill: 'both' }));
      pages.forEach(function (p, k) { var i = k + 1; anims.push(p.animate(leafKeys(8 - 2 * i, -(8 - 2 * i), 180), { duration: D_PAGE, delay: P0 + k * STAG, easing: E_PAGE, fill: 'both' })); });
      openAt = P0 + (PAGES - 1) * STAG + D_PAGE + 130; // the book rests open on the blank page for ~130 ms
    } else {
      finalPose();
    }

    var state = 'run'; // run -> fading -> gone
    function remove() {
      if (state === 'gone') return; state = 'gone';
      clearTimeout(endTimer); clearTimeout(failsafe);
      o.remove(); st.remove(); api.active = false; goneResolve();
      document.removeEventListener('keydown', onKey, true);
    }
    function dissolve(ms) {
      if (state !== 'run') return;
      state = 'fading';
      clearTimeout(endTimer);
      var card = document.getElementById('hz-live');
      var dx = 0, dy = 0, sc = 1.06;
      if (card && ms > 200) {
        var r = card.getBoundingClientRect(), br = o.querySelector('.hi-book').getBoundingClientRect();
        if (r.width && r.bottom > 0 && r.top < innerHeight) { // the card is on screen: the book sinks towards it
          dx = ((r.left + r.width / 2) - innerWidth / 2) * 0.5;
          dy = (Math.min(Math.max(r.top + r.height / 2, 80), innerHeight - 80) - innerHeight / 2) * 0.5;
          sc = Math.min(1, r.width / (br.width * 2));
        }
      }
      o.querySelector('.hi-scene').animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sc + ')', opacity: 0 }], { duration: ms, easing: ms > 200 ? E_EXIT : 'linear', fill: 'forwards' });
      lab.classList.remove('on');
      var bg = o.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'linear', fill: 'forwards' });
      bg.finished.then(remove, remove);
    }
    var readyFlag = false, openDone = false;
    function tryDissolve() { if (state !== 'run' || !openDone) return; if (readyFlag) dissolve(300); else lab.classList.add('on'); }
    if (opts.at != null) { // screenshot mode: freeze the timeline at this time, no auto end
      anims.forEach(function (a) { a.pause(); a.currentTime = opts.at; });
    } else {
      endTimer = setTimeout(function () { openDone = true; tryDissolve(); }, openAt);
    }
    api.ready = function () { readyFlag = true; tryDissolve(); };
    api.label = function (text) { lab.textContent = text; };
    api.skip = function () { dissolve(150); };
    function onKey() { api.skip(); }
    o.addEventListener('pointerdown', function (e) { e.preventDefault(); api.skip(); });
    o.addEventListener('click', function () { api.skip(); });
    document.addEventListener('keydown', onKey, true);
    failsafe = setTimeout(function () { dissolve(150); }, 25000);
    api.active = true;
    api.heldBoot = h.classList.contains('st-boot'); // the app's own opening beat waits until the book is gone (see main.js)
    h.classList.remove('st-boot');
    api.root = o;
    api.element = o;
    // text for the "preparing" line is set by main.js (api.label) once the strings are loaded; Bengali until then
    lab.textContent = 'প্রস্তুত হচ্ছে…';
    return o;
  }
  api.start = start;

  // kicked off at once from <head>, unless ?nointro=1 (test runs)
  if (!/[?&]nointro=1/.test(location.search)) start();
  else goneResolve();
})();
