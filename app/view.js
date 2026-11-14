// Turns the view.* / hide.* settings into <html> attributes and CSS variables (spec C3 §2.5, §4.7). The before-paint
// script in index.html reads the same mirror (localStorage 'hifz-view') so there is no flash of the wrong theme.
import { setDigits } from '../core/bn.js';
import { mix } from '../core/contrast.js';

const MIRROR = 'hifz-view';
const BG = { paper: '#F6F1E6', night: '#11151B', sepia: '#EADFC6' };
const SURFACE = { paper: '#FFFCF5', night: '#181D25', sepia: '#F4EAD3' };
const VIEW_IDS = ['view.theme', 'view.wordSet', 'view.wordStyle', 'view.customColors', 'view.arabicScale', 'view.lineGap', 'view.wordGap', 'view.uiScale', 'view.uiFont',
  'view.motion', 'view.timer', 'view.headStats', 'view.bnDigits', 'hide.style', 'hide.weakTint', 'hide.nextWord', 'hide.head', 'hide.ayahMarks', 'view.legend'];
export const COLOR_KEYS = ['ok', 'bad', 'peek', 'pend', 'next', 'weak', 'listen'];

export function resolveTheme(v) {
  if (v === 'auto') return matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'paper';
  return v;
}
export function resolveMotion(v) {
  if (v === 'auto') return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'gentle' : 'full';
  return v;
}

// custom colour values of the current theme as CSS variables
export function customVars(theme, colors) {
  const c = colors?.[theme] ?? {};
  const out = {};
  if (c.ok) out['--w-ok'] = c.ok;
  if (c.bad) out['--w-bad'] = c.bad;
  if (c.peek) out['--w-peek'] = c.peek;
  if (c.pend) out['--w-pend'] = c.pend;
  if (c.next) { out['--w-next-ring'] = c.next; out['--w-next-bg'] = mix(c.next, SURFACE[theme], 0.18); }
  if (c.listen) out['--w-listen'] = c.listen;
  if (c.weak) {
    out['--w-3'] = c.weak; out['--w-2'] = mix(c.weak, SURFACE[theme], 0.6); out['--w-1'] = mix(c.weak, SURFACE[theme], 0.3);
    out['--w-3s'] = mix(c.weak, SURFACE[theme], 0.2); out['--w-2s'] = mix(c.weak, SURFACE[theme], 0.13); out['--w-1s'] = mix(c.weak, SURFACE[theme], 0.07);
  }
  return out;
}

export function applyView(get) {
  const h = document.documentElement;
  const theme = resolveTheme(get('view.theme'));
  const set = (k, v) => { h.dataset[k] = String(v); };
  set('theme', theme);
  set('words', get('view.wordSet'));
  set('wordstyle', get('view.wordStyle'));
  set('motion', resolveMotion(get('view.motion')));
  set('uifont', get('view.uiFont'));
  set('hidestyle', get('hide.style'));
  set('weaktint', get('hide.weakTint') ? 1 : 0);
  set('hideNext', get('hide.nextWord') ? 1 : 0);
  set('hideHead', get('hide.head') ? 1 : 0);
  set('hideMarks', get('hide.ayahMarks') ? 1 : 0);
  set('headstats', get('view.headStats') ? 1 : 0);
  set('timer', get('view.timer') ? 1 : 0);
  h.classList.toggle('dark', theme === 'night');
  const st = h.style;
  st.setProperty('--ar-scale', get('view.arabicScale') / 100);
  st.setProperty('--lh-scale', get('view.lineGap') / 100);
  st.setProperty('--word-gap', `${get('view.wordGap') / 100}em`);
  st.setProperty('--ui-scale', get('view.uiScale') / 100);
  for (const k of ['--w-ok', '--w-bad', '--w-peek', '--w-pend', '--w-next-ring', '--w-next-bg', '--w-listen', '--w-1', '--w-2', '--w-3', '--w-1s', '--w-2s', '--w-3s']) st.removeProperty(k);
  if (get('view.wordSet') === 'custom') for (const [k, v] of Object.entries(customVars(theme, get('view.customColors')))) st.setProperty(k, v);
  setDigits(get('view.bnDigits'));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BG[theme]);
  const mirror = {};
  for (const id of VIEW_IDS) mirror[id] = get(id);
  try { localStorage.setItem(MIRROR, JSON.stringify(mirror)); } catch { /* private mode */ }
}
export const isViewId = (id) => VIEW_IDS.includes(id);
