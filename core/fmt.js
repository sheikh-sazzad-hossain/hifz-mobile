// Number and unit formats of the settings pages and the new modes (spec C3 §11.2). Digits go through bn().
import { bn } from './bn.js';

export const num = (v) => bn(String(Math.round(v * 100) / 100)); // ১.৫  ০.৭৫  (at most 2 decimals)
const UNITS = { s: ' সেকেন্ড', min: ' মিনিট', pct: '%', x: '×', words: ' শব্দ', ayah: 'টা আয়াত', n: '', MB: ' MB', px: '' };
const COMPACT = { s: ' সে', min: ' মি' };
export function withUnit(v, unit, { scale = 1, compact = false } = {}) {
  if (unit === 'pct') return `${num(v * scale)}%`;
  if (unit === 'x') return `${num(v)}×`;
  const u = (compact ? COMPACT[unit] : null) ?? UNITS[unit] ?? '';
  return `${num(v * scale)}${u}`;
}
export const span = (a, b) => (a === b ? `আয়াত ${bn(a)}` : `আয়াত ${bn(a)}–${bn(b)}`);
export const size = (bytes) => `${bn((bytes / 1048576).toFixed(1))} MB`;
export const contrast = (r) => `${bn(r.toFixed(1))}:${bn(1)}`;
// {n} placeholders: fill('s.changedN text', { n: 3 }); numbers are formatted by the caller
export const fill = (text, vars = {}) => text.replace(/\{(\w+(?::\w+)?)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
