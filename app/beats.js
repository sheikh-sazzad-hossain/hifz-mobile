// Rehal motion beats that are not CSS-only (spec C4 §3 beats 5 and 7). Every function is a no-op that shows the final state at once unless the
// resolved motion is `full` (gentle / off / reduced motion) and never runs while the microphone is live. Transform / opacity only.
import { countAt, COUNT_MS } from '../core/fmt.js';

const full = () => document.documentElement.dataset.motion === 'full' && document.documentElement.dataset.live !== '1';
const E_SETTLE = 'cubic-bezier(.16,1,.3,1)';

// Beat 5: a stack of 3 paper slips rises from the bottom; returns { top, setNumber(text, animate), go(text), remove() }.
export function slipStack(host) {
  const box = document.createElement('div');
  box.className = 'tq-count';
  box.innerHTML = '<div class="tq-stack"><i class="tq-slip s2"></i><i class="tq-slip s1"></i><div class="tq-slip s0"><span class="tq-num"></span></div></div>';
  host.append(box);
  const slips = [...box.querySelectorAll('.tq-slip')]; // back, middle, top
  const num = box.querySelector('.tq-num');
  if (full()) {
    const rest = [[12, 0.8], [6, -0.6], [0, 0]]; // back slips sit 12 / 6 px lower, tilted +0.8 / -0.6 deg (static after the rise)
    slips.forEach((s, i) => { const [y, r] = rest[i]; s.animate([{ transform: `translateY(${y + 48}px) rotate(${r}deg)`, opacity: 0 }, { transform: `translateY(${y}px) rotate(${r}deg)`, opacity: 1 }], { duration: 420, delay: i * 60, easing: E_SETTLE, fill: 'backwards' }); });
  }
  return {
    box,
    setNumber(text) { // ৩ · ২ · ১: scale .92 -> 1 with fade, 1 s each
      num.textContent = text;
      if (full()) num.animate([{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'scale(1)', offset: 0.24 }, { opacity: 1, transform: 'scale(1)', offset: 0.84 }, { opacity: 0, transform: 'scale(1)' }], { duration: 1000, easing: 'linear', fill: 'both' });
    },
    go(text) { num.getAnimations().forEach((a) => a.cancel()); num.textContent = text; },
    remove() { box.remove(); },
  };
}

// Beat 7: the score counts up (Bengali digits through fmt(n)); resolves when done. gentle / off: the final number at once.
export function countUp(el, target, fmt) {
  if (!full() || target == null) { el.textContent = fmt(target); return Promise.resolve(); }
  return new Promise((res) => {
    const t0 = performance.now();
    const step = (now) => {
      const k = (now - t0) / COUNT_MS;
      el.textContent = fmt(countAt(target, k));
      if (k >= 1 || !el.isConnected || document.documentElement.dataset.live === '1') { el.textContent = fmt(target); res(); } else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// the mini-slips appear with 30 ms stagger; only the first 20 animate, the rest are there at once
export function staggerSlips(container) {
  if (!full()) return;
  [...container.children].slice(0, 20).forEach((s, i) => s.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, delay: i * 30, easing: E_SETTLE, fill: 'backwards' }));
}

// 100 %: the gold rosette seal draws itself (rotate -20deg -> 0, scale .9 -> 1, 600 ms)
export function rosette(host) {
  const s = document.createElement('span');
  s.className = 'tq-seal';
  s.setAttribute('aria-hidden', 'true');
  let pts = '';
  for (let i = 0; i < 24; i++) { const a = (i * Math.PI) / 12, r = i % 2 ? 17 : 24; pts += `${(28 + r * Math.sin(a)).toFixed(1)},${(28 - r * Math.cos(a)).toFixed(1)} `; }
  s.innerHTML = `<svg viewBox="0 0 56 56" width="48" height="48"><polygon points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="28" cy="28" r="12" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="28" cy="28" r="4.5" fill="currentColor"/></svg>`;
  host.append(s);
  if (full()) s.animate([{ transform: 'rotate(-20deg) scale(.9)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 600, easing: E_SETTLE, fill: 'backwards' });
  return s;
}
