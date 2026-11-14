// Number and unit formats of the settings pages and the new modes (spec C3 §11.2). Digits go through bn().
import { bn } from './bn.js';
import { t, fill } from './i18n.js';

export const num = (v) => bn(String(Math.round(v * 100) / 100)); // ১.৫  ০.৭৫  (at most 2 decimals)
const UNIT_IDS = { s: 'u.s', min: 'u.min', words: 'u.words', ayah: 'u.ayah' }; // '{n} সেকেন্ড' ...
const COMPACT_IDS = { s: 'u.sC', min: 'u.minC' };
const PLAIN = { pct: '%', x: '×', n: '', MB: ' MB', px: '' };
export function withUnit(v, unit, { scale = 1, compact = false } = {}) {
  if (unit === 'pct') return `${num(v * scale)}%`;
  if (unit === 'x') return `${num(v)}×`;
  const id = (compact ? COMPACT_IDS[unit] : null) ?? UNIT_IDS[unit];
  if (id) return t(id, { n: num(v * scale) });
  return `${num(v * scale)}${PLAIN[unit] ?? ''}`;
}
export const span = (a, b) => (a === b ? t('fmt.ayah1', { a: bn(a) }) : t('fmt.ayahN', { a: bn(a), b: bn(b) }));
export const size = (bytes) => `${bn((bytes / 1048576).toFixed(1))} MB`;
export const contrast = (r) => `${bn(r.toFixed(1))}:${bn(1)}`;
// {n} placeholders: fill('s.changedN text', { n: 3 }); numbers are formatted by the caller
export { fill };

// ---- count-up of the test score (Rehal beat 7): 0 -> N over 700 ms, ease-out; pure, so it is testable --------------------------------
export const easeOut = (k) => 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;
export const countAt = (target, k) => Math.round(target * easeOut(k)); // integer shown at progress k (0..1)
export const COUNT_MS = 700;
