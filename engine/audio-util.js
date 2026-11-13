// Audio helpers with no DOM and no Node API: WAV parsing and resampling. Shared by the page, workers and tests.
export function parseWav(buffer) {
  const v = new DataView(buffer);
  let p = 12;
  let fmt;
  let at;
  let len;
  while (p + 8 <= v.byteLength) {
    const id = String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3));
    const size = v.getUint32(p + 4, true);
    if (id === 'fmt ') fmt = { ch: v.getUint16(p + 10, true), rate: v.getUint32(p + 12, true), bits: v.getUint16(p + 22, true) };
    if (id === 'data') { at = p + 8; len = Math.min(size, v.byteLength - at); break; }
    p += 8 + size + (size & 1);
  }
  if (!fmt || fmt.bits !== 16) throw new Error('only 16-bit PCM wav');
  const n = Math.floor(len / 2 / fmt.ch);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = v.getInt16(at + i * fmt.ch * 2, true) / 32768; // first channel
  return { samples: x, rate: fmt.rate };
}

// Windowed-sinc resampler (low-pass at the new Nyquist).
export function resample(x, from, to) {
  if (from === to) return x;
  const ratio = from / to;
  const n = Math.floor(x.length / ratio);
  const y = new Float32Array(n);
  const half = Math.ceil(ratio * 4);
  const cut = Math.min(1, to / from);
  for (let i = 0; i < n; i++) {
    const c = i * ratio;
    let s = 0;
    let w = 0;
    for (let j = Math.max(0, Math.ceil(c - half)); j <= Math.min(x.length - 1, Math.floor(c + half)); j++) {
      const d = j - c;
      const sinc = d === 0 ? 1 : Math.sin(Math.PI * d * cut) / (Math.PI * d * cut);
      const k = (0.5 + 0.5 * Math.cos((Math.PI * d) / half)) * sinc * cut;
      s += x[j] * k;
      w += k;
    }
    y[i] = w ? s / w : 0;
  }
  return y;
}

export function wavTo16k(buffer) {
  const { samples, rate } = parseWav(buffer);
  return resample(samples, rate, 16000);
}
