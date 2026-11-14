// WCAG 2.x contrast ratio of two #RRGGBB colours (the custom word colours show it live, spec C3 §4.7.1).
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
export function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
// mix hex colour a over b by fraction f of a (weak levels 2 and 1 are mixes with the surface)
export function mix(a, b, f) {
  const p = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v * f + y[i] * (1 - f)).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
