// The settings store (spec C3 §2.3-2.4): sparse values (only those that differ from the schema default), validation,
// migration of the old ad-hoc keys, export / import. The schema (data/settings-schema.json) is the single source of
// ids, defaults, ranges and Bengali labels.
//   const settings = createSettings({ store, schema, platform: 'M' })
//   get(id) set(id, v) -> { ok, value, reason } · setMany(obj) -> { applied, rejected } · reset(group | null) · all()
//   exportObj() importObj(obj) -> { ok, applied, skipped, wrong } · onChange(fn(ids)) · isChanged(id) · changedCount(group)
//   presetMatch(group) -> preset id | null · applyPreset(group, id) -> previous values (for undo)
const CROSS = [
  // [id that must be smaller, the larger id, strict]
  ['history.fair', 'history.good', true], ['adv.lostReds', 'adv.lostOf', false], ['adv.verifyWindowS', 'adv.verifyMaxS', false], ['adv.cellMid', 'adv.cellDark', true],
];
const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// C17 (হিফজুন নূর): the Rehal page colours paper / sepia / night became নূর লাইট (light) and নূর ডার্ক (dark).
// An old saved or imported value is moved to the new one, so nobody lands on a theme that is gone.
export const THEMES = ['light', 'dark'];
const THEME_ALIAS = { paper: 'light', sepia: 'light', night: 'dark' };
export const migrateTheme = (v) => THEME_ALIAS[v] ?? v;
export function migrateColors(m) { // view.customColors { paper|sepia|night|light|dark: {...} } -> { light, dark }
  if (!m || typeof m !== 'object') return m;
  const out = {};
  for (const k of ['sepia', 'paper', 'night', 'light', 'dark']) { // later keys win: paper over sepia, a new key over an old one
    if (!m[k] || typeof m[k] !== 'object') continue;
    const to = migrateTheme(k);
    out[to] = { ...(out[to] ?? {}), ...m[k] };
  }
  for (const k of Object.keys(m)) if (!(k in THEME_ALIAS) && !THEMES.includes(k)) out[k] = m[k]; // unknown keys stay, so validation can refuse them
  return out;
}
export function migrateValues(v) { // only the values that changed shape; everything else is passed through
  if (!v || typeof v !== 'object') return v;
  const out = { ...v };
  if ('view.theme' in out) out['view.theme'] = migrateTheme(out['view.theme']);
  if ('view.customColors' in out) out['view.customColors'] = migrateColors(out['view.customColors']);
  return out;
}

export function migrate(raw) {
  const out = migrateValues({ ...(raw ?? {}) });
  if ('theme' in out) { out['view.theme'] = out.theme === 'dark' ? 'dark' : out.theme === 'light' ? 'light' : undefined; delete out.theme; }
  if ('waitS' in out) { out['recite.waitS'] = out.waitS; delete out.waitS; }
  if ('look' in out) { out['recite.look'] = out.look; delete out.look; }
  if ('wait_s' in out) { out['recite.waitS'] = out.wait_s; delete out.wait_s; }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  out._v = 2;
  return out;
}

export function createSettings({ store, schema, platform = 'M' }) {
  const defs = new Map(schema.settings.map((d) => [d.id, d]));
  const values = migrate(store?.get('settings', {}));
  const listeners = new Set();
  const persist = () => store?.set('settings', values);
  const def = (id) => defs.get(id);
  const defaultOf = (d) => (d.platformDefault ? (d.platformDefault[platform] ?? d.default) : d.default);
  // a stored value that does not fit the schema any more is dropped quietly
  for (const id of Object.keys(values)) if (id !== '_v' && !defs.has(id)) delete values[id];

  // Check one value against its definition: returns the cleaned value or undefined when it is not allowed.
  function clean(d, v, strict = false) {
    if (d.control === 'tog') return typeof v === 'boolean' ? v : undefined;
    if (d.control === 'info') return undefined;
    if (d.control === 'txt') { // C20: free text (view.name): control characters and markup brackets dropped, trimmed, cut to max
      if (typeof v !== 'string') return undefined;
      return v.replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, d.max ?? 40);
    }
    if (d.control === 'col') {
      if (!v || typeof v !== 'object') return undefined;
      const out = {};
      for (const [theme, m] of Object.entries(v)) {
        if (!THEMES.includes(theme) || !m || typeof m !== 'object') return undefined;
        out[theme] = {};
        for (const [k, c] of Object.entries(m)) { if (!/^#[0-9a-fA-F]{6}$/.test(c)) return undefined; out[theme][k] = c.toUpperCase(); }
      }
      return out;
    }
    if (d.control === 'sld') {
      if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
      const { min, max, step } = d.range;
      if (strict && (v < min || v > max)) return undefined; // an imported value outside the range is skipped, not clamped
      const n = Math.round((Math.min(max, Math.max(min, v)) - min) / step) * step + min;
      return Math.round(n * 1000) / 1000;
    }
    if (d.control === 'sel' || d.control === 'seg' || d.control === 'chips') {
      if (d.options.some((o) => sameValue(o.v, v))) return v;
      if (d.custom && typeof v === 'number') {
        const { min, max, step } = d.custom;
        if (v < min || v > max) return undefined;
        return Math.round((Math.round((v - min) / step) * step + min) * 1000) / 1000;
      }
      return d.id === 'device.micId' && typeof v === 'string' ? v : undefined; // mic ids come from the device
    }
    return undefined;
  }

  const get = (id) => { const d = def(id); if (!d) return undefined; return id in values ? values[id] : defaultOf(d); };
  const crossOk = (id, v) => {
    for (const [lo, hi, strict] of CROSS) {
      if (id === lo && (strict ? v >= get(hi) : v > get(hi))) return false;
      if (id === hi && (strict ? get(lo) >= v : get(lo) > v)) return false;
    }
    return true;
  };

  function put(id, v, strict = false) { // no persist / notify
    const d = def(id);
    if (!d) return { ok: false, reason: 'unknown' };
    if (id === 'view.theme' || id === 'view.customColors') v = migrateValues({ [id]: v })[id]; // an old theme name still works
    const c = clean(d, v, strict);
    if (c === undefined) return { ok: false, reason: 'invalid' };
    if (!crossOk(id, c)) return { ok: false, reason: 'cross' };
    if (sameValue(c, defaultOf(d))) delete values[id]; else values[id] = c;
    return { ok: true, value: c };
  }
  const notify = (ids) => { for (const fn of listeners) fn(ids); };

  const api = {
    schema, values: () => values, def, get,
    set(id, v) { const r = put(id, v); if (r.ok) { persist(); notify([id]); } return r; },
    setMany(obj, strict = false) {
      const applied = [];
      const rejected = [];
      for (const [id, v] of Object.entries(obj)) { if (put(id, v, strict).ok) applied.push(id); else rejected.push(id); }
      if (applied.length) { persist(); notify(applied); }
      return { applied, rejected };
    },
    reset(group = null) {
      const ids = [];
      for (const [id, d] of defs) if ((group === null || d.group === group) && id in values) { delete values[id]; ids.push(id); }
      if (ids.length) { persist(); notify(ids); }
      return ids;
    },
    resetIds(ids) {
      const done = ids.filter((id) => id in values);
      for (const id of done) delete values[id];
      if (done.length) { persist(); notify(done); }
      return done;
    },
    all() { const o = {}; for (const [id, d] of defs) o[id] = id in values ? values[id] : defaultOf(d); return o; },
    isChanged: (id) => id in values,
    changedCount: (group) => [...defs.values()].filter((d) => d.group === group && d.id in values && (d.plat === 'both' || d.plat === platform)).length,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    isActive: (d) => d.plat === 'both' || d.plat === platform,
    visible(d) { // a row is shown unless its showIf says no
      if (!d.showIf) return true;
      const v = get(d.showIf.id);
      if ('eq' in d.showIf) return v === d.showIf.eq;
      if ('ne' in d.showIf) return v !== d.showIf.ne;
      return true;
    },
    presetMatch(group) {
      const p = schema.presets?.[group];
      if (!p) return null;
      for (const it of p.items) if (Object.entries(it.values).every(([id, v]) => sameValue(get(id), v))) return it.id;
      return null;
    },
    applyPreset(group, id) {
      const it = schema.presets[group].items.find((x) => x.id === id);
      const before = {};
      for (const k of Object.keys(it.values)) before[k] = get(k);
      api.setMany(it.values);
      return before;
    },
    exportObj() {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const exported = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      const v = { ...values };
      delete v._v;
      return { app: 'hifz-settings', schema: 2, exported, from: platform === 'M' ? 'mobile' : 'laptop', values: v };
    },
    importObj(obj) {
      if (!obj || obj.app !== 'hifz-settings' || typeof obj.values !== 'object') return { ok: false, wrong: true, applied: 0, skipped: 0 };
      let applied = 0;
      let skipped = 0;
      for (const [id, v] of Object.entries(migrateValues(obj.values))) { if (api.setMany({ [id]: v }, true).applied.length) applied++; else skipped++; }
      return { ok: true, applied, skipped };
    },
    migrate,
  };
  persist();
  return api;
}
