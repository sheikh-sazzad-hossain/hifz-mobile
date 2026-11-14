// The settings screen (ফিহরিস্ত): a full-screen page drawn from data/settings-schema.json (spec C3 §3.2).
//   const ui = createSettingsUi({ root, settings, ctx })   ctx: { t, toast, confirmDlg, isLive(), reload(), previewWords(), mics() }
//   ui.open(groupId?)  ui.close()  ui.isOpen()
import { ICONS } from './icons.js';
import { esc } from './ui.js';
import { withUnit, num } from '../core/fmt.js';
import { bn } from '../core/bn.js';
import { ratio } from '../core/contrast.js';
import { resolveTheme, COLOR_KEYS } from './view.js';

const COLOR_INFO = { ok: ['সঠিক', '--w-ok', 'text'], bad: ['ভুল', '--w-bad', 'text'], peek: ['উঁকি', '--w-peek', 'text'], pend: ['যাচাই হচ্ছে', '--w-pend', 'text'],
  next: ['পরের শব্দ', '--w-next-ring', 'bg'], weak: ['পুরোনো দুর্বলতা', '--w-3', 'bg'], listen: ['শোনার আলো', '--w-listen', 'bg'] };
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const ico = (n) => ICONS[n] ?? ICONS.sliders;

export function createSettingsUi({ root, settings, ctx }) {
  const { t } = ctx;
  const schema = settings.schema;
  const groups = schema.groups;
  const byGroup = (g) => schema.settings.filter((d) => d.group === g && settings.isActive(d));
  const touched = new Set();
  let page = { name: 'toc' };
  let customOpen = null;
  let opened = false;

  const valueLabel = (d, v) => {
    if (d.control === 'tog') return v ? 'চালু' : 'বন্ধ';
    if (d.control === 'sld') return withUnit(v, d.unit, { scale: d.scale ?? 1 }) .replace(/^(\d|[০-৯])/, '$1');
    const o = d.options?.find((x) => JSON.stringify(x.v) === JSON.stringify(v));
    return o ? (o.label ?? withUnit(o.v, d.unit)) : withUnit(v, d.unit);
  };
  const sliderText = (d, v) => (d.unit ? withUnit(v, d.unit, { scale: d.scale ?? 1 }) : num(v * (d.scale ?? 1)));

  // ---- controls ------------------------------------------------------------------------------------------------
  function control(d) {
    const v = settings.get(d.id);
    const id = esc(d.id);
    if (d.control === 'tog') return `<button class="sw" role="switch" aria-checked="${v}" data-act="tog" data-id="${id}" aria-label="${esc(d.label)}"></button>`;
    if (d.control === 'info') return '';
    if (d.control === 'seg') {
      return `<div class="seg" role="radiogroup" aria-label="${esc(d.label)}">${d.options.map((o) => `<button role="radio" aria-checked="${JSON.stringify(o.v) === JSON.stringify(v)}" data-act="opt" data-id="${id}" data-v='${esc(JSON.stringify(o.v))}'>${esc(o.label ?? withUnit(o.v, d.unit))}</button>`).join('')}</div>`;
    }
    if (d.control === 'chips') {
      const inOpts = d.options.some((o) => JSON.stringify(o.v) === JSON.stringify(v));
      const list = d.options.map((o) => `<button class="chip" aria-pressed="${JSON.stringify(o.v) === JSON.stringify(v)}" data-act="opt" data-id="${id}" data-v='${esc(JSON.stringify(o.v))}'>${esc(o.label ?? withUnit(o.v, d.unit))}</button>`);
      if (d.custom) {
        if (!inOpts) list.push(`<button class="chip" aria-pressed="true" data-act="custom" data-id="${id}">${esc(withUnit(v, d.unit))}</button>`);
        list.push(`<button class="chip" aria-pressed="false" data-act="custom" data-id="${id}">${esc(t('s.custom'))}</button>`);
      }
      const slider = d.custom && customOpen === d.id ? sliderHtml({ ...d, range: d.custom }, typeof v === 'number' ? v : d.custom.min) : '';
      return `<div class="chips">${list.join('')}</div>${slider}`;
    }
    if (d.control === 'sld') return sliderHtml(d, v);
    if (d.control === 'sel') {
      const opts = d.id === 'device.micId' ? ctx.mics() : d.options;
      return `<select class="st-select" data-act="sel" data-id="${id}">${opts.map((o) => `<option value='${esc(JSON.stringify(o.v))}'${JSON.stringify(o.v) === JSON.stringify(v) ? ' selected' : ''}>${esc(o.label ?? o.v)}</option>`).join('')}</select>`;
    }
    if (d.control === 'col') return colorEditor();
    return '';
  }
  function sliderHtml(d, v) {
    const { min, max, step } = d.range;
    return `<div class="sldw"><button class="step" data-act="step" data-id="${esc(d.id)}" data-d="-1" aria-label="−">−</button>`
      + `<input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-act="sld" data-id="${esc(d.id)}" aria-label="${esc(d.label)}">`
      + `<button class="step" data-act="step" data-id="${esc(d.id)}" data-d="1" aria-label="+">+</button><span class="val">${esc(sliderText(d, v))}</span></div>`;
  }
  function colorEditor() {
    const theme = resolveTheme(settings.get('view.theme'));
    const cur = settings.get('view.customColors')?.[theme] ?? {};
    const surface = cssVar('--surface');
    const ink = cssVar('--ink');
    const style = settings.get('view.wordStyle');
    return COLOR_KEYS.map((k) => {
      const [name, varName, kind] = COLOR_INFO[k];
      const val = (cur[k] ?? cssVar(varName)).toUpperCase();
      const ok = /^#[0-9A-F]{6}$/.test(val);
      const r = ok ? (kind === 'text' && style === 'text' ? ratio(val, surface) : ratio(ink, val)) : 21;
      return `<div class="st-colrow"><span class="nm">${esc(name)}</span><input type="color" value="${ok ? val.toLowerCase() : '#000000'}" data-act="col" data-k="${k}" aria-label="${esc(name)}">`
        + `<span class="cr">${bn(r.toFixed(1))}:${bn(1)}</span>${cur[k] ? `<button class="st-reset" data-act="colreset" data-k="${k}">${esc(t('s.rowReset'))}</button>` : ''}`
        + `${r < 4.5 ? `<span class="warn">${esc(t('s.contrast', { r: bn(r.toFixed(1)) }))}</span>` : ''}</div>`;
    }).join('');
  }

  function rowHtml(d) {
    const changed = settings.isChanged(d.id);
    const off = !settings.visible(d);
    if (off) return '';
    const inline = d.control === 'tog';
    const notes = [];
    if (d.when === 'reload' && touched.has(d.id)) notes.push(`${esc(t('s.whenReload'))} <button class="st-reset" data-act="reload">${esc(t('s.reloadNow'))}</button>`);
    else if (d.when === 'next' && touched.has(d.id) && ctx.isLive()) notes.push(esc(t('s.live')));
    else if (d.when === 'next' && touched.has(d.id)) notes.push(esc(t('s.whenNext')));
    return `<div class="st-row${inline ? ' inline tap' : ''}" data-row="${esc(d.id)}" ${inline ? `data-act="rowtog" data-id="${esc(d.id)}"` : ''}>`
      + `<div class="st-lab"><div class="st-label">${changed ? '<span class="st-dot"></span>' : ''}${esc(d.label)}${changed && d.control !== 'col' ? `<button class="st-reset" data-act="rowreset" data-id="${esc(d.id)}" aria-label="${esc(t('s.rowReset'))}" title="${esc(t('s.rowReset'))}">↺ ${esc(t('s.rowReset'))}</button>` : ''}</div>`
      + `${d.help ? `<div class="st-help">${esc(d.help)}</div>` : ''}${notes.map((n) => `<div class="st-note">${n}</div>`).join('')}</div>`
      + `<div class="st-ctl">${control(d)}</div></div>`;
  }

  function rowsHtml(list, { grouped = false } = {}) {
    let lastSub;
    let lastGroup;
    let out = '';
    let open = false;
    for (const d of list) {
      const html = rowHtml(d);
      if (!html) continue;
      if (grouped && d.group !== lastGroup) {
        if (open) out += '</div>';
        out += `<div class="st-group">${esc(groups.find((g) => g.id === d.group).name)}</div><div class="st-rows">`;
        open = true; lastGroup = d.group;
      } else if (!grouped && d.sub !== lastSub) {
        if (open) out += '</div>';
        if (d.sub) out += `<div class="st-sub">${esc(d.sub)}</div>`;
        out += '<div class="st-rows">';
        open = true; lastSub = d.sub;
      } else if (!open) { out += '<div class="st-rows">'; open = true; }
      out += html;
    }
    return open ? `${out}</div>` : out;
  }

  // ---- pages ---------------------------------------------------------------------------------------------------
  function presetCard(gid, title) {
    const p = schema.presets?.[gid];
    if (!p) return '';
    const cur = settings.presetMatch(gid);
    const item = p.items.find((i) => i.id === cur);
    const opts = [...p.items.map((i) => ({ id: i.id, label: i.label })), ...(cur ? [] : [{ id: '_c', label: t('s.presetCustom') }])];
    return `<div class="st-preset"><h3>${esc(title ?? p.label)}</h3><div class="seg" role="radiogroup" aria-label="${esc(p.label)}">${opts.map((o) => `<button role="radio" aria-checked="${o.id === (cur ?? '_c')}" data-act="preset" data-g="${gid}" data-p="${o.id}">${esc(o.label)}</button>`).join('')}</div>${item?.help ? `<p>${esc(item.help)}</p>` : ''}</div>`;
  }

  function summary(g) {
    const G = (id) => settings.get(id);
    const lab = (id) => valueLabel(settings.def(id), G(id));
    const s = {
      recite: () => [`আলাফাসি ${G('recite.waitS') ? withUnit(G('recite.waitS'), 's') : 'বন্ধ'}`, G('detect.added') ? 'বাড়তি শব্দ ধরো' : 'বাড়তি শব্দ ধরা বন্ধ', ({ easy: 'সহজ', normal: 'স্বাভাবিক', strict: 'কড়া' })[settings.presetMatch('recite')] ?? t('s.presetCustom')],
      hide: () => [lab('hide.style'), G('peek.countsAsMistake') ? 'উঁকি = ভুল' : 'উঁকি ভুল নয়'],
      test: () => [`${lab('test.endBy')}`, `হিন্ট ${lab('test.hintWords')}`],
      listen: () => [`গতি ${lab('listen.speed')}`, `প্রতি আয়াত ×${num(G('listen.repeatAyah'))}`],
      goals: () => [`সপ্তাহ শুরু ${lab('goals.weekStart')}`, G('goals.countTests') ? 'টেস্টও গোনা' : 'টেস্ট গোনা নয়'],
      history: () => [`ভালো মুখস্থ ${withUnit(G('history.good'), 'pct')}`, `পরপর ${num(G('history.clearStreak'))} সেশনে দাগ মোছে`],
      view: () => [lab('view.theme'), `আরবি ${withUnit(G('view.arabicScale'), 'pct')}`, `নড়াচড়া ${lab('view.motion')}`],
      device: () => [lab('device.sensitivity'), G('device.keepAwake') ? 'স্ক্রিন জ্বলে থাকবে' : 'স্ক্রিন নিজের মতো'],
      adv: () => [t('s.advSummary')],
    };
    return s[g]().join(' · ');
  }

  function previewHtml() {
    const w = ctx.previewWords();
    const states = ['hz-ok', 'hz-ok', 'hz-bad', 'hz-hint', 'hz-pend', 'hz-hid hz-next', 'hz-hid hz-w1', 'hz-hid hz-w2', 'hz-hid hz-w3', 'hz-listen'];
    return `<div class="st-preview" aria-hidden="true">${w.slice(0, states.length).map((x, i) => `<span class="${states[i]}">${esc(x)}</span>`).join(' ')}</div>`;
  }

  function bar(title, back) {
    return `<div class="st-bar">${back ? `<button class="hz-mini" data-act="back" aria-label="${esc(t('s.back'))}">${ICONS.back}</button>` : `<button class="hz-mini" data-act="close" aria-label="${esc(t('s.back'))}">${ICONS.back}</button>`}`
      + `<h1>${esc(title)}</h1>${page.name === 'toc' ? `<button class="hz-mini" data-act="focus-search" aria-label="${esc(t('s.search'))}">${ICONS.search}</button>` : ''}</div>`;
  }

  function tocHtml() {
    const rows = groups.map((g) => {
      const n = settings.changedCount(g.id);
      return `<button class="st-toc-row" data-act="section" data-g="${g.id}"><span class="st-ico">${ico(g.icon)}</span><span class="st-toc-main"><span class="st-toc-name">${esc(g.name)}</span><br><span class="st-toc-sum">${esc(summary(g.id))}</span></span>`
        + `${n ? `<span class="st-badge">${esc(t('s.changedN', { n: bn(n) }))}</span>` : ''}<span class="st-chev">${ICONS.chevron}</span></button>`;
    }).join('');
    return `${bar(t('s.title'))}<div class="st-body"><input class="st-search" type="search" placeholder="${esc(t('s.search'))}" data-act="search" aria-label="${esc(t('s.search'))}">`
      + `<div id="st-results" hidden></div><div id="st-main">${presetCard('recite', schema.presets.recite.label)}<div class="st-toc">${rows}</div>`
      + `<div class="st-foot"><button class="btn" data-act="export">${esc(t('s.export'))}</button><button class="btn" data-act="import">${esc(t('s.import'))}</button><button class="btn btn-red" data-act="resetall">${esc(t('s.allReset'))}</button></div>`
      + `<div class="st-where">${esc(t('s.where'))}</div></div><input type="file" accept="application/json,.json" id="st-file" hidden></div>`;
  }

  function sectionHtml(gid) {
    const g = groups.find((x) => x.id === gid);
    return `${bar(g.name, true)}<div class="st-body">${gid === 'adv' ? `<div class="st-adv">${esc(t('s.advWarn'))}</div>` : ''}${gid === 'view' ? previewHtml() : ''}`
      + `${gid !== 'recite' || true ? presetCard(gid) : ''}<div id="st-rows">${rowsHtml(byGroup(gid))}</div>`
      + `${gid === 'listen' ? `<button class="btn" style="margin-top:12px" data-act="offline">${esc(t('l.offTitle'))}</button>` : ''}<button class="btn btn-red st-sect-reset" data-act="sectreset" data-g="${gid}">${esc(t('s.sectionReset'))}</button></div>`;
  }

  function render(dir) {
    if (page.name === 'section') root.innerHTML = `<div class="st-pg">${sectionHtml(page.g)}</div>`;
    else root.innerHTML = `<div class="st-pg">${tocHtml()}</div>`;
    const body = root.querySelector('.st-body');
    if (dir && body) { body.classList.add(dir === 'back' ? 'st-back' : 'st-enter'); body.addEventListener('animationend', () => body.classList.remove('st-back', 'st-enter'), { once: true }); }
  }
  const rerenderRows = () => {
    if (page.name !== 'section') return;
    const box = root.querySelector('#st-rows');
    if (box) box.innerHTML = rowsHtml(byGroup(page.g));
    const pv = root.querySelector('.st-preview');
    if (pv && page.g === 'view') pv.outerHTML = previewHtml();
  };

  function doSearch(q) {
    const main = root.querySelector('#st-main');
    const res = root.querySelector('#st-results');
    q = q.trim().toLowerCase();
    if (!q) { res.hidden = true; main.hidden = false; return; }
    const list = schema.settings.filter((d) => settings.isActive(d) && d.control !== 'info' && `${d.label} ${d.help ?? ''}`.toLowerCase().includes(q));
    res.innerHTML = list.length ? rowsHtml(list, { grouped: true }) : `<div class="st-empty">${esc(t('s.searchEmpty'))}</div>`;
    res.hidden = false; main.hidden = true;
  }

  // ---- events --------------------------------------------------------------------------------------------------
  const parse = (s) => JSON.parse(s);
  function change(id, v) {
    const r = settings.set(id, v);
    if (!r.ok) { ctx.toast(t('s.invalid')); return false; }
    touched.add(id);
    return true;
  }
  const doSearchKeep = () => { const q = root.querySelector('.st-search'); if (q) doSearch(q.value); };
  function afterChange() { if (page.name === 'toc') doSearchKeep(); else rerenderRows(); }

  root.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const id = el.dataset.id;
    if (act === 'tog' || act === 'rowtog') { if (e.target.closest('.st-reset')) return; const v = !settings.get(id); if (change(id, v)) afterChange(); return; }
    if (act === 'opt') { if (change(id, parse(el.dataset.v))) { customOpen = null; afterChange(); } return; }
    if (act === 'custom') { customOpen = customOpen === id ? null : id; rerenderRows(); doSearchKeep(); return; }
    if (act === 'step') {
      const d = settings.def(id);
      const rng = d.control === 'chips' ? d.custom : d.range;
      const v = Math.round((settings.get(id) + el.dataset.d * rng.step) * 1000) / 1000;
      if (change(id, Math.min(rng.max, Math.max(rng.min, v)))) afterChange();
      return;
    }
    if (act === 'rowreset') { settings.resetIds([id]); afterChange(); return; }
    if (act === 'section') { page = { name: 'section', g: el.dataset.g }; render('push'); root.scrollTop = 0; return; }
    if (act === 'back') { page = { name: 'toc' }; render('back'); return; }
    if (act === 'close') { api.close(); return; }
    if (act === 'focus-search') { root.querySelector('.st-search')?.focus(); return; }
    if (act === 'preset') {
      if (el.dataset.p === '_c') return;
      const item = schema.presets[el.dataset.g].items.find((i) => i.id === el.dataset.p);
      const before = settings.applyPreset(el.dataset.g, el.dataset.p);
      ctx.toast(t('s.presetApplied', { name: item.label }), { action: t('s.undo'), onAction: () => { settings.setMany(before); render(); } });
      render();
      return;
    }
    if (act === 'sectreset') {
      const g = groups.find((x) => x.id === el.dataset.g);
      if (await ctx.confirmDlg(t('s.sectionResetQ', { group: g.name }))) { settings.reset(g.id); ctx.toast(t('s.resetDone')); render(); }
      return;
    }
    if (act === 'resetall') { if (await ctx.confirmDlg(t('s.allResetQ'))) { settings.reset(null); ctx.toast(t('s.resetDone')); render(); } return; }
    if (act === 'export') {
      const blob = new Blob([JSON.stringify(settings.exportObj(), null, 1)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `hifz-settings-${settings.exportObj().exported.slice(0, 10)}.json` });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      return;
    }
    if (act === 'import') { root.querySelector('#st-file').click(); return; }
    if (act === 'reload') { ctx.reload(); return; }
    if (act === 'offline') { ctx.openOffline?.(); return; }
    if (act === 'colreset') {
      const theme = resolveTheme(settings.get('view.theme'));
      const all = JSON.parse(JSON.stringify(settings.get('view.customColors') ?? {}));
      delete all[theme]?.[el.dataset.k];
      settings.set('view.customColors', all);
      rerenderRows();
    }
  });
  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.act === 'sld') {
      const d = settings.def(el.dataset.id);
      const v = Number(el.value);
      if (change(el.dataset.id, v)) {
        const val = el.closest('.sldw').querySelector('.val');
        const dd = d.control === 'chips' ? { ...d, range: d.custom } : d;
        val.textContent = sliderText(dd, settings.get(el.dataset.id));
      }
    } else if (el.dataset.act === 'search') doSearch(el.value);
    else if (el.dataset.act === 'col') {
      const theme = resolveTheme(settings.get('view.theme'));
      const all = JSON.parse(JSON.stringify(settings.get('view.customColors') ?? {}));
      (all[theme] ??= {})[el.dataset.k] = el.value.toUpperCase();
      settings.setMany({ 'view.customColors': all, 'view.wordSet': 'custom' });
    }
  });
  root.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.dataset?.act === 'sld') { afterChange(); }
    else if (el.dataset?.act === 'sel') { if (change(el.dataset.id, parse(el.value))) afterChange(); }
    else if (el.dataset?.act === 'col') rerenderRows();
    else if (el.id === 'st-file' && el.files[0]) {
      try {
        const r = settings.importObj(JSON.parse(await el.files[0].text()));
        ctx.toast(r.wrong ? t('s.importWrong') : r.skipped ? t('s.importSkip', { n: bn(r.applied), m: bn(r.skipped) }) : t('s.importOk', { n: bn(r.applied) }));
      } catch (err) { ctx.toast(t('s.importBad', { err: err.message ?? err })); }
      el.value = '';
      render();
    }
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { page.name === 'section' ? (page = { name: 'toc' }, render('back')) : api.close(); } });

  const api = {
    isOpen: () => opened,
    open(gid) {
      page = gid ? { name: 'section', g: gid } : { name: 'toc' };
      render();
      opened = true;
      root.classList.add('open');
      root.removeAttribute('inert');
      document.body.classList.add('st-open');
      history.pushState({ st: 1 }, '');
      root.scrollTop = 0;
      root.querySelector('.hz-mini')?.focus({ preventScroll: true });
    },
    close(fromPop = false) {
      if (!opened) return;
      opened = false;
      root.classList.remove('open');
      root.setAttribute('inert', '');
      document.body.classList.remove('st-open');
      if (!fromPop && history.state?.st) history.back();
      touched.clear();
    },
    refresh() { if (opened) render(); },
  };
  root.setAttribute('inert', '');
  addEventListener('popstate', () => { if (opened) api.close(true); });
  return api;
}
