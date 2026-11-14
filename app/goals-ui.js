// Progress > লক্ষ্য / টেস্ট / অর্জন, the streak card + heatmap + off-app sessions + merged recent list (summary), and the Today card.
import * as quran from '../core/quran.js';
import * as G from '../core/goals.js';
import { resolve, countAyahs } from '../core/ranges.js';
import { openPicker, specLabel } from './picker.js';
import { t, esc, toast, confirmDlg, sheet } from './ui.js';
import { bn, when, duration, isoLocal, dateOnly } from '../core/bn.js';
import { num, fill } from '../core/fmt.js';
import { ICONS } from './icons.js';

export function createGoalsUi({ S, onFilter }) {
  const get = (id) => S.settings.get(id);
  const cfg = () => ({ dayStart: get('goals.dayStart'), weekStart: get('goals.weekStart'), streakMin: get('goals.streakMin'), countLook: get('goals.countLook'), countListen: get('goals.countListen'), countTests: get('goals.countTests'), countManual: get('goals.countManual') });
  const kv = (k, d) => S.store.get(k, d) ?? d;
  const mem = () => kv('memorized', { ranges: [] });
  const today = () => G.dayKey(isoLocal(new Date()), get('goals.dayStart'));
  let cache = { key: '', v: null };
  let filter = 'all';

  function data() {
    const key = [S.history.sessions().length, kv('tests', []).length, kv('manual', []).length, kv('listens', []).length, kv('goals', []).length, JSON.stringify(cfg())].join('|');
    if (cache.key === key) return cache.v;
    const tests = kv('tests', []);
    const recs = G.buildRecords({ sessions: S.history.sessions(), manual: kv('manual', []), listens: kv('listens', []), tests }, cfg());
    // test goals count test cards: one record per finished test
    for (const x of tests) if (x.state !== 'paused') recs.push({ start: x.start, kind: 'test', countsHifz: true, questions: x.cards.length, seconds: 0, surah: null, ayahs: [], cards: x.cards });
    recs.sort((a, b) => (a.start < b.start ? -1 : 1));
    const goals = kv('goals', []).map((g) => ({ g, p: G.goalProgress(g, recs, cfg(), mem()) }));
    const doneDay = (d) => { const act = goals.filter(({ g, p }) => !g.paused && G.targetOf(g, d, p, cfg()) > 0); return act.length > 0 && act.every(({ g, p }) => (p.byDay[d] ?? 0) >= G.targetOf(g, d, p, cfg())); };
    const v = { recs, goals, doneDay, streak: G.streakInfo(recs, cfg(), today(), doneDay), tests };
    cache = { key, v };
    return v;
  }

  // ---- today card (recite tab)
  function todayHtml() {
    if (!get('goals.showToday')) return '';
    const d = data();
    const act = d.goals.filter(({ g }) => !g.paused);
    if (!act.length) return '';
    const dd = today();
    return `<div class="card gl-today" data-go="goals"><b>${esc(t('g.today'))}</b>${act.map(({ g, p }) => { const tg = G.targetOf(g, dd, p, cfg()); if (!tg) return ''; const done = p.byDay[dd] ?? 0; return `<div>${done >= tg ? '✓ ' : ''}${esc(t('g.todayLine', { name: goalName(g), done: num(Math.round(done * 10) / 10), target: num(Math.round(tg * 10) / 10), unit: t(`g.unit.${g.unit}`) }))}</div>`; }).join('')}</div>`;
  }
  const typeName = (g) => t(`g.type.${g.type}`).split(' (')[0];
  const goalName = (g) => g.name || t('g.autoName', { type: typeName(g), range: (g.spec?.parts?.length ?? 0) > 2 ? t('g.nParts', { n: bn(g.spec.parts.length) }) : specLabel(g.spec) });

  // ---- goals screen
  function goalsHtml() {
    const d = data();
    const dd = today();
    const cards = d.goals.map(({ g, p }) => {
      const week = Array.from({ length: 7 }, (_, i) => { const day = G.addDays(G.addDays(dd, -((G.weekday(dd) - cfg().weekStart + 7) % 7)), i); return `<i class="wk ${G.dayStatus(g, day, p, cfg(), dd)}"></i>`; }).join('');
      const tg = G.targetOf(g, dd, p, cfg());
      return `<div class="card gl-card"><div class="gl-head"><b>${esc(goalName(g))}</b><button class="btn" data-gm="${g.id}">⋯</button></div>
        <div>${esc(t('g.todayLine', { name: '', done: num(Math.round((p.byDay[dd] ?? 0) * 10) / 10), target: num(Math.round(tg * 10) / 10), unit: t(`g.unit.${g.unit}`) }).replace(/^:\s*/, ''))}</div><div class="wks">${week}</div>
        ${p.total ? `<div class="hp-bar"><i style="width:${Math.min(100, Math.round((100 * p.done) / p.total))}%"></i></div><small>${esc(t('g.progressLine', { done: num(Math.round(p.done * 10) / 10), total: num(Math.round(p.total * 10) / 10), unit: t(`g.unit.${g.unit}`), date: g.deadline ?? '—' }))}</small>` : ''}
        ${p.complete ? `<div class="hz-done">${esc(t('g.completed'))}</div>` : ''}${g.paused ? '<small>⏸</small>' : ''}</div>`;
    }).join('');
    return `<div class="btn-row"><button class="btn btn-primary" data-gn>${esc(t('g.new'))}</button></div>${cards || ''}`;
  }
  function menu(id) {
    const g = kv('goals', []).find((x) => x.id === id);
    const sh = sheet(`<h2>${esc(goalName(g))}</h2><div class="btn-row"><button class="btn" data-m="pause">${esc(g.paused ? t('g.resumeGoal') : t('g.pause'))}</button><button class="btn" data-m="edit">${esc(t('g.edit'))}</button><button class="btn btn-red" data-m="del">${esc(t('g.delete'))}</button></div>`);
    sh.el.addEventListener('click', async (e) => {
      const m = e.target.closest('[data-m]')?.dataset.m;
      if (!m) return;
      if (m === 'pause') { await S.store.set('goals', kv('goals', []).map((x) => (x.id === id ? { ...x, paused: !x.paused } : x))); sh.close(); refresh(); }
      else if (m === 'del') { sh.close(); if (await confirmDlg(t('g.deleteQ', { name: goalName(g) }))) { await S.store.set('goals', kv('goals', []).filter((x) => x.id !== id)); refresh(); } }
      else if (m === 'edit') { sh.close(); wizard(g); }
    });
  }
  // the 5-step creation flow (spec 9.3)
  function wizard(edit = null) {
    const g = edit ? { ...edit } : { id: `g${Date.now().toString(36)}`, type: 'memorize', spec: { parts: [] }, reverse: false, strict: false, plan: 'daily', unit: 'ayah', amount: 5, deadline: null, days: null, perWeek: null, rounding: 'none', cycle: 'auto', name: '', created: today(), cycleStart: today(), paused: false };
    let step = 1;
    const sh = sheet('<div class="wz"></div>');
    const root = sh.el.querySelector('.wz');
    const radio = (name, list, cur) => `<div class="chips" style="flex-direction:column;align-items:stretch">${list.map(([v, label]) => `<button class="chip" style="text-align:start;height:auto;padding:8px 14px" aria-pressed="${cur === v}" data-set="${name}" data-v="${v}">${esc(label)}</button>`).join('')}</div>`;
    const tpl = [['manzil', { type: 'recite', plan: 'manzil', unit: 'ayah', cycle: 'auto', spec: { parts: [{ k: 'ayahs', s: 1, from: 1, to: 7 }, ...Array.from({ length: 113 }, (_, i) => ({ k: 'surah', s: i + 2 }))] } }], ['page', { type: 'memorize', plan: 'daily', unit: 'page', amount: 1 }], ['juz', { type: 'review', plan: 'daily', unit: 'juz', amount: 1, spec: { parts: [{ k: 'memorized' }] } }], ['minutes', { type: 'recite', plan: 'daily', unit: 'minute', amount: 15, spec: { parts: [{ k: 'juz', n: 1 }, ...Array.from({ length: 29 }, (_, i) => ({ k: 'juz', n: i + 2 }))] } }]];
    function draw() {
      const nav = `<div class="btn-row">${step > 1 ? `<button class="btn" data-w="back">←</button>` : ''}${step < 5 ? `<button class="btn btn-primary" data-w="next" ${step === 2 && !g.spec.parts.length ? 'disabled' : ''}>→</button>` : `<button class="btn btn-primary" data-w="create">${esc(t('g.create'))}</button>`}</div>`;
      let body = '';
      if (step === 1) body = `${edit ? '' : `<div class="chips">${tpl.map(([k]) => `<button class="chip" data-tpl="${k}">${esc(t(`g.tpl.${k}`))}</button>`).join('')}</div>`}${radio('type', ['memorize', 'review', 'recite', 'test'].map((k) => [k, t(`g.type.${k}`)]), g.type)}`;
      if (step === 2) body = `<button class="btn" data-w="pick">${esc(t('l.pick'))}</button> <span class="hp-note">${esc(specLabel(g.spec) || '—')}</span>${radio('reverse', [[false, t('g.order.normal')], [true, t('g.order.reverse')]], g.reverse)}<label class="pk-q"><input type="checkbox" data-strict ${g.strict ? 'checked' : ''}> ${esc(t('g.strict'))}</label>`;
      if (step === 3) body = `${radio('plan', [['daily', t('g.plan.daily')], ['bydate', t('g.plan.bydate')], ['flexible', t('g.plan.flexible')]].concat(g.plan === 'manzil' ? [['manzil', t('g.tpl.manzil')]] : []), g.plan)}
        ${g.plan !== 'manzil' ? `<div class="pk-step"><select class="fld" data-f="unit">${['ayah', 'page', 'juz', 'minute', 'word', 'question'].map((u) => `<option value="${u}" ${g.unit === u ? 'selected' : ''}>${esc(t(`g.unit.${u}`))}</option>`).join('')}</select>${g.plan === 'bydate' ? `<input class="fld" type="date" data-f="deadline" value="${g.deadline ?? ''}" style="width:auto">` : `<input class="fld" type="number" min="0.5" step="0.5" data-f="amount" value="${g.amount}">`}</div>` : ''}
        ${['page', 'juz'].includes(g.unit) ? radio('rounding', ['none', 'up', 'down', 'nearest'].map((r) => [r, t(`g.round.${r}`)]), g.rounding) : ''}`;
      if (step === 4) body = `${radio('sched', [['daily', t('g.sch.daily')], ['days', t('g.sch.days')], ['perWeek', t('g.sch.perWeek', { n: bn(g.perWeek ?? 3) })]], g.perWeek ? 'perWeek' : g.days ? 'days' : 'daily')}${g.days ? `<div class="chips">${[0, 1, 2, 3, 4, 5, 6].map((i) => [t(`d.${i}`), i]).map(([n, i]) => `<button class="chip" aria-pressed="${g.days.includes(i)}" data-day="${i}">${n}</button>`).join('')}</div>` : ''}`;
      if (step === 5) body = `${radio('cycle', ['auto', 'manual', 'off'].map((c) => [c, t(`g.cycle.${c}`)]), g.cycle)}<input class="fld" style="width:100%;margin-top:10px" data-f="name" value="${esc(g.name ?? '')}" placeholder="${esc(t('g.autoName', { type: typeName(g), range: specLabel(g.spec) || '…' }))}">`;
      root.innerHTML = `<h2>${esc(t(`g.s${step}`))}</h2>${body}${nav}`;
    }
    draw();
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tpl) { Object.assign(g, tpl.find(([k]) => k === b.dataset.tpl)[1], { name: t(`g.tpl.${b.dataset.tpl}`) }); step = g.spec.parts.length ? 5 : 2; draw(); return; }
      if (b.dataset.set) { const v = b.dataset.v === 'true' ? true : b.dataset.v === 'false' ? false : b.dataset.v; const n = b.dataset.set; if (n === 'sched') { g.days = v === 'days' ? [] : null; g.perWeek = v === 'perWeek' ? 3 : null; } else { g[n] = v; if (n === 'type' && v === 'review') g.spec = { parts: [{ k: 'memorized' }] }; } draw(); return; }
      if (b.dataset.day !== undefined) { const i = Number(b.dataset.day); g.days = g.days.includes(i) ? g.days.filter((x) => x !== i) : [...g.days, i]; draw(); return; }
      const w = b.dataset.w;
      if (w === 'next') { step++; draw(); } else if (w === 'back') { step--; draw(); }
      else if (w === 'pick') openPicker({ spec: g.spec, memorized: mem(), onUse: (s) => { g.spec = s; draw(); } });
      else if (w === 'create') { const l = kv('goals', []); await S.store.set('goals', edit ? l.map((x) => (x.id === g.id ? g : x)) : [...l, g]); sh.close(); refresh(); }
    });
    root.addEventListener('change', (e) => { const el = e.target; if (el.dataset.strict !== undefined) g.strict = el.checked; else if (el.dataset.f) g[el.dataset.f] = ['amount'].includes(el.dataset.f) ? Number(el.value) : el.value; });
  }

  // ---- summary additions: streak, heatmap, manual sessions, merged recent list
  function summaryHtml() {
    const d = data();
    const st = d.streak;
    const hm = get('history.heatmap') ? G.heatmap(d.recs, cfg(), today()) : null;
    return `<div class="hp-cards"><div class="hp-card"><div class="hp-num">${ICONS.flame} ${bn(st.current)}</div><div class="hp-lbl">${esc(t('st.current', { n: bn(st.current) }))}</div>${st.keep ? `<small>${esc(t('st.keep'))}</small>` : ''}</div>
      <div class="hp-card"><div class="hp-num">${bn(st.best)}</div><div class="hp-lbl">${esc(t('st.best', { n: bn(st.best) }))}</div></div></div>
      ${hm ? `<div class="heat">${hm.map((w) => `<div>${w.map((c) => `<i class="lv${c.level} ${c.future ? 'fut' : ''}" title="${esc(t('st.cellTip', { date: c.day, m: bn(c.minutes) }))}"></i>`).join('')}</div>`).join('')}</div>` : ''}
      <div class="btn-row"><button class="btn" data-xadd>${esc(t('x.add'))}</button></div>`;
  }
  function recentHtml() {
    const cfgv = get('history.recent');
    const items = [];
    for (const s of S.history.sessions()) items.push({ at: s.start, kind: s.kind === 'test' ? 'test' : s.mode === 'look' ? 'look' : 'hifz', s });
    for (const m of kv('manual', [])) items.push({ at: `${m.date}T12:00:00`, kind: 'manual', m });
    for (const l of kv('listens', [])) items.push({ at: l.start, kind: 'listen', l });
    let list = items.sort((a, b) => (a.at < b.at ? 1 : -1));
    if (filter !== 'all') list = list.filter((x) => (filter === 'hifz' ? ['hifz'].includes(x.kind) || x.kind === 'test' && false : x.kind === filter));
    if (cfgv) list = list.slice(0, cfgv);
    const rows = list.map((x) => {
      if (x.s) { const s = x.s; const info = quran.surahInfo(s.surah); const hasRec = s.recording && S.recNames.has(s.recording);
        return `<tr class="hp-go" data-surah="${s.surah}"><td>${when(s.start)}</td><td>${esc(info.english)}</td><td><span class="hp-mode hp-m-${x.kind === 'test' ? 'test' : s.mode}">${esc(x.kind === 'test' ? t('h.chip.test') : t(`g.mode.${s.mode}`))}</span></td><td class="hp-n">${bn(s.words)}</td><td class="hp-n">${bn(s.accuracy)}%</td><td class="hp-n hp-red">${bn(s.missed)}</td><td>${duration(s.seconds)}</td><td>${hasRec ? `<button class="btn" data-hplay="${esc(s.recording)}">${esc(t('h.play'))}</button>` : ''}</td></tr>`; }
      if (x.m) return `<tr><td>${when(x.at)}</td><td colspan="2"><span class="hp-mode hp-m-test">${esc(t('h.chip.manual'))}</span> ${esc(t(`x.int.${x.m.intent}`))}</td><td colspan="3">${esc(t('g.minutesNote', { n: bn(x.m.minutes), note: x.m.note ?? '' }))}</td><td colspan="2"><button class="btn btn-red" data-xdel="${x.m.id}">${esc(t('x.delete'))}</button></td></tr>`;
      return `<tr><td>${when(x.at)}</td><td colspan="2"><span class="hp-mode hp-m-look">${esc(t('h.chip.listen'))}</span></td><td colspan="5">${duration(x.l.seconds)}</td></tr>`;
    }).join('');
    return `<h3 class="hp-h">${esc(t('p.recent'))}</h3><div class="chips" style="margin-bottom:8px">${['all', 'hifz', 'look', 'test', 'manual', 'listen'].map((f) => `<button class="chip" aria-pressed="${filter === f}" data-hf="${f}">${esc(t(`h.f.${f}`))}</button>`).join('')}</div>
      <div class="hp-scroll"><table class="hp-table"><tbody>${rows}</tbody></table></div>`;
  }
  function manualSheet() {
    const sh = sheet(`<h2>${esc(t('x.title'))}</h2><label class="pk-q">${esc(t('x.date'))} <input class="fld" type="date" data-x="date" value="${today()}"></label>
      <label class="pk-q">${esc(t('x.minutes'))} <input class="fld" type="number" min="1" max="600" data-x="minutes" value="15"></label>
      <div class="seg" role="radiogroup">${['memorize', 'review', 'recite'].map((i, k) => `<button role="radio" aria-checked="${k === 2}" data-i="${i}">${esc(t(`x.int.${i}`))}</button>`).join('')}</div>
      <div style="margin:8px 0"><button class="btn" data-xr>${esc(t('x.range'))}</button> <span class="hp-note" data-xrl></span></div><input class="fld" style="width:100%" data-x="note" placeholder="${esc(t('x.note'))}">
      <div class="btn-row"><button class="btn btn-primary" data-xs>${esc(t('x.save'))}</button></div>`);
    let intent = 'recite'; let spec = null;
    sh.el.addEventListener('click', async (e) => {
      const i = e.target.closest('[data-i]'); if (i) { intent = i.dataset.i; sh.el.querySelectorAll('[data-i]').forEach((b) => b.setAttribute('aria-checked', String(b === i))); return; }
      if (e.target.closest('[data-xr]')) { openPicker({ spec, memorized: mem(), onUse: (s) => { spec = s; sh.el.querySelector('[data-xrl]').textContent = specLabel(s); } }); return; }
      if (e.target.closest('[data-xs]')) {
        const v = (k) => sh.el.querySelector(`[data-x=${k}]`).value;
        const minutes = Math.max(1, Math.min(600, Number(v('minutes')) || 1));
        await S.store.set('manual', [...kv('manual', []), { id: `m${Date.now().toString(36)}`, date: v('date'), minutes, intent, spec, note: v('note') }]);
        sh.close(); refresh(); afterSave();
      }
    });
  }

  // ---- tests list and badges
  function testsHtml() {
    const l = [...kv('tests', [])].reverse();
    if (!l.length) return `<p class="hp-empty">${esc(t('t.resNone'))}</p>`;
    return l.map((x) => `<button class="mm-row hp-tr" data-tid="${esc(x.id)}"><div class="mm-main">${esc(t('h.testRow', { date: when(x.start), range: x.rangeName, p: x.score === null ? '—' : bn(x.score), c: bn(x.pass), n: bn(x.answered) }))}${x.state === 'paused' ? ' ⏸' : ''}</div></button>`).join('') + `<p class="hp-note">${esc(t('h.testEditNote'))}</p>`;
  }
  function badgesHtml() {
    const got = kv('badges', {});
    return `<h3 class="hp-h">${esc(t('bd.title'))}</h3><div class="badges">${G.BADGES.map(([id]) => [id, t(`bd.n.${id}`), t(`bd.r.${id}`)]).map(([id, name, req]) => `<div class="badge ${got[id] ? 'on' : ''}"><b>${esc(name)}</b><small>${got[id] ? esc(dateOnly(got[id])) : esc(t('bd.locked', { req }))}</small></div>`).join('')}</div>`;
  }
  async function afterSave() { // new badges after each save
    const d = data();
    const stats = S.history.surahStats();
    const goodSurahs = stats.filter((s) => s.accuracy !== null && s.accuracy >= get('history.good')).length;
    const goalDayDone = d.goals.some(({ g, p }) => Object.keys(p.byDay).some((day) => G.targetOf(g, day, p, cfg()) > 0 && p.byDay[day] >= G.targetOf(g, day, p, cfg())));
    const ids = G.earnedBadges({ sessions: S.history.sessions(), tests: d.tests, weak: S.history.data.weak, memorized: mem(), streak: d.streak, goalDayDone, goodSurahs });
    const got = { ...kv('badges', {}) };
    let changed = false;
    for (const id of ids) if (!got[id]) { got[id] = today(); changed = true; toast(t('bd.new', { name: t(`bd.n.${id}`) })); }
    if (changed) await S.store.set('badges', got);
  }
  function refresh() { cache.key = ''; S.progressRefresh?.(); S.drawToday?.(); }

  return { cfg, todayHtml, goalsHtml, testsHtml, badgesHtml, summaryHtml, recentHtml, wizard, menu, manualSheet, afterSave, refresh, setFilter: (f) => { filter = f; }, data,
    onClick(e) {
      const b = e.target.closest('button');
      if (e.target.closest('[data-go]') && !b) return 'goals';
      if (!b) return null;
      if (b.dataset.tid) S.testUi.openStored(b.dataset.tid); else if ('gn' in b.dataset) wizard(); else if (b.dataset.gm) menu(b.dataset.gm); else if ('xadd' in b.dataset) manualSheet();
      else if (b.dataset.hf) { filter = b.dataset.hf; return 'recent'; }
      else if (b.dataset.xdel) { confirmDlg(t('x.deleteQ')).then(async (ok) => { if (ok) { await S.store.set('manual', kv('manual', []).filter((m) => m.id !== b.dataset.xdel)); refresh(); } }); }
      return null;
    },
    fill, resolve, countAyahs };
}
