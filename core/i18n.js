// App language: string lookup, language packs, number digits and dates by language (spec C §2, §5).
//   t(id, vars)   selected language pack -> Bengali source (data/ui-strings.json, loaded by setBase) -> the id itself
//   Pack shape (i18n/<code>.json): { strings: {id: text}, settings: {settingId: {label, help, sub, options: {value: label}}}, groups: {groupId: label | {name, help}}, presets: {...} }
//   every key is optional; a missing key falls back to Bengali. Only the selected language is loaded (lazy, by the page).
// This file has no imports (core/bn.js and core/fmt.js import it), and in Node it reads data/ui-strings.json itself so the unit tests see the Bengali text.

export const LANGS = [
  ['bn', 'বাংলা'], ['en', 'English'], ['ar', 'العربية'], ['ur', 'اردو'], ['hi', 'हिन्दी'], ['id', 'Bahasa Indonesia'], ['ms', 'Bahasa Melayu'], ['tr', 'Türkçe'],
  ['fa', 'فارسی'], ['fr', 'Français'], ['es', 'Español'], ['pt', 'Português'], ['de', 'Deutsch'], ['ru', 'Русский'], ['zh', '中文（简体）'], ['sw', 'Kiswahili'],
];
export const LANG_CODES = LANGS.map((l) => l[0]);
export const RTL = new Set(['ar', 'ur', 'fa']);

let BASE = {};
let PACK = {};
let LANG = 'bn';

export const fill = (text, vars) => (vars ? String(text).replace(/\{(\w+(?::\w+)?)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : String(text));
export const setBase = (json) => { BASE = json; };
export const getBase = () => BASE;
export function setPack(code, pack) { LANG = LANG_CODES.includes(code) ? code : 'bn'; PACK = LANG === 'bn' ? {} : (pack ?? {}); }
export const lang = () => LANG;
export const dir = (code = LANG) => (RTL.has(code) ? 'rtl' : 'ltr');
export const t = (id, vars) => { const s = PACK.strings?.[id] ?? BASE[id]; return s === undefined ? id : fill(s, vars); };
export const hasString = (id) => PACK.strings?.[id] !== undefined || BASE[id] !== undefined;

// ---- settings schema texts: the schema objects are rewritten in place (originals kept in `_bn`), so every screen and the search see the language --------
export function localizeSchema(schema, pack = PACK) {
  const sp = pack?.settings ?? {}; const gp = pack?.groups ?? {}; const pp = pack?.presets ?? {};
  for (const g of schema.groups) {
    g._bn ??= { name: g.name, help: g.help };
    const o = gp[g.id];
    g.name = (typeof o === 'string' ? o : o?.name) ?? g._bn.name;
    g.help = (typeof o === 'object' ? o?.help : undefined) ?? g._bn.help;
  }
  for (const d of schema.settings) {
    d._bn ??= { label: d.label, help: d.help, sub: d.sub, options: d.options?.map((x) => x.label) };
    const o = sp[d.id] ?? {};
    d.label = d.id === 'view.lang' ? d._bn.label : (o.label ?? d._bn.label);
    d.help = o.help ?? d._bn.help;
    d.sub = o.sub ?? d._bn.sub;
    d.options?.forEach((x, i) => { x.label = d.id === 'view.lang' ? d._bn.options[i] : ((o.options?.[String(x.v)]) ?? d._bn.options[i]); });
  }
  for (const [gid, p] of Object.entries(schema.presets ?? {})) {
    p._bn ??= { label: p.label, items: p.items.map((i) => ({ label: i.label, help: i.help })) };
    const o = pp[gid] ?? {};
    p.label = o.label ?? p._bn.label;
    p.items.forEach((i, k) => { const io = o.items?.[i.id] ?? {}; i.label = io.label ?? p._bn.items[k].label; i.help = io.help ?? p._bn.items[k].help; });
  }
}

// ---- digits and dates by language ----------------------------------------------------------------------------------------------------------------
const DIGITS = { bn: '০১২৩৪৫৬৭৮৯', ar: '٠١٢٣٤٥٦٧٨٩', fa: '۰۱۲۳۴۵۶۷۸۹' }; // all other languages: Latin 0-9
export const digitSet = (code = LANG) => DIGITS[code] ?? null;
const LOCALE = { ar: 'ar-u-nu-arab', fa: 'fa-u-nu-arabext', ur: 'ur-u-nu-latn', hi: 'hi-u-nu-latn', zh: 'zh-Hans-u-nu-latn' };
export const intlLocale = (code = LANG) => LOCALE[code] ?? `${code}-u-nu-latn`;
export function dateText(d, { time = false, code = LANG } = {}) { // 14 Nov, 10:05 in the language (Intl); Bengali is drawn by core/bn.js
  const o = { day: 'numeric', month: 'short', ...(time ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) };
  try { return new Intl.DateTimeFormat(intlLocale(code), o).format(d); } catch { return d.toDateString(); }
}

// ---- Node (unit tests): load the Bengali source synchronously -----------------------------------------------------------------------------------
if (typeof process !== 'undefined' && process.versions?.node && typeof document === 'undefined') {
  try {
    const fs = process.getBuiltinModule('node:fs');
    BASE = JSON.parse(fs.readFileSync(new URL('../data/ui-strings.json', import.meta.url), 'utf8'));
  } catch { /* no file: ids are shown */ }
}
