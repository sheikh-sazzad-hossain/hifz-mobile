// Kaldi-compatible streaming log-mel filterbank: the front end the zipformer model was trained with.
// Same numbers as kaldi-native-fbank the way sherpa-onnx sets it up: 16 kHz mono samples in [-1, 1],
// 25 ms povey window, 10 ms shift, 80 mel bins from 20 Hz to 7600 Hz, pre-emphasis 0.97, DC removed,
// no dither, snip_edges = false. (A slaney/librosa mel front end roughly doubles the model's error rate.)
export const SAMPLE_RATE = 16000;
export const NUM_BINS = 80;
const WIN = 400; // 25 ms
const SHIFT = 160; // 10 ms
const LEFT = WIN / 2 - SHIFT / 2; // frame f starts at sample SHIFT * f - LEFT (snip_edges = false)
const NFFT = 512;
const PREEMPH = 0.97;
const LOG_FLOOR = 1.1920928955078125e-7; // float epsilon: Kaldi's floor before the log

const WINDOW = new Float64Array(WIN);
for (let i = 0; i < WIN; i++) WINDOW[i] = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1)), 0.85);

// Triangular filters, evenly spaced on Kaldi's mel scale, over FFT bins 0..255
const BANKS = (() => {
  const mel = (f) => 1127 * Math.log(1 + f / 700);
  const low = mel(20);
  const delta = (mel(SAMPLE_RATE / 2 - 400) - low) / (NUM_BINS + 1);
  const banks = [];
  for (let b = 0; b < NUM_BINS; b++) {
    const left = low + b * delta;
    const center = left + delta;
    const right = center + delta;
    let offset = -1;
    const w = [];
    for (let i = 0; i < NFFT / 2; i++) {
      const m = mel((SAMPLE_RATE / NFFT) * i);
      if (m > left && m < right) {
        if (offset < 0) offset = i;
        w.push(m <= center ? (m - left) / (center - left) : (right - m) / (right - center));
      }
    }
    banks.push({ offset, w: Float64Array.from(w) });
  }
  return banks;
})();

const REV = new Uint16Array(NFFT);
const COS = new Float64Array(NFFT / 2);
const SIN = new Float64Array(NFFT / 2);
for (let i = 0; i < NFFT; i++) {
  let r = 0;
  for (let b = 1, x = i; b < NFFT; b <<= 1, x >>= 1) r = (r << 1) | (x & 1);
  REV[i] = r;
}
for (let k = 0; k < NFFT / 2; k++) {
  COS[k] = Math.cos((2 * Math.PI * k) / NFFT);
  SIN[k] = Math.sin((2 * Math.PI * k) / NFFT);
}

function fft(re, im) {
  for (let i = 0; i < NFFT; i++) {
    const j = REV[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= NFFT; size <<= 1) {
    const half = size >> 1;
    const step = NFFT / size;
    for (let i = 0; i < NFFT; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j;
        const b = a + half;
        const xr = re[b] * COS[k] + im[b] * SIN[k];
        const xi = im[b] * COS[k] - re[b] * SIN[k];
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

// Feed samples as they arrive; frames come out as soon as their whole window has been heard.
// The frames wait in a queue: peek(n) looks at the oldest n, drop(n) removes them.
export class StreamingFbank {
  constructor() {
    this.buf = new Float32Array(SAMPLE_RATE * 2); // samples still needed; buf[0] is sample number `base`
    this.base = 0;
    this.total = 0; // samples received
    this.frames = 0; // frames computed
    this.first = 0; // frame number of the oldest queued frame
    this.done = false;
    this.feat = new Float32Array(NUM_BINS * 256);
    this.re = new Float64Array(NFFT);
    this.im = new Float64Array(NFFT);
  }

  get available() { return this.frames - this.first; }

  accept(samples) {
    const have = this.total - this.base;
    if (have + samples.length > this.buf.length) {
      const bigger = new Float32Array(Math.max(this.buf.length * 2, have + samples.length));
      bigger.set(this.buf.subarray(0, have));
      this.buf = bigger;
    }
    this.buf.set(samples, have);
    this.total += samples.length;
    this.compute();
  }

  // No more audio: the last frames reach past the end and mirror the signal there, as Kaldi does.
  finish() {
    this.done = true;
    this.compute();
  }

  peek(n) { return this.feat.subarray(0, n * NUM_BINS); }

  drop(n) {
    this.feat.copyWithin(0, n * NUM_BINS, this.available * NUM_BINS);
    this.first += n;
  }

  compute() {
    let n = Math.floor((this.total + SHIFT / 2) / SHIFT);
    if (!this.done) while (n > 0 && SHIFT * (n - 1) - LEFT + WIN > this.total) n--;
    while (this.frames < n) this.frame(this.frames++);
    const keep = Math.max(0, SHIFT * this.frames - LEFT); // the next frame starts here
    if (keep - this.base >= SAMPLE_RATE) {
      this.buf.copyWithin(0, keep - this.base, this.total - this.base);
      this.base = keep;
    }
  }

  frame(f) {
    const { re, im, total, base, buf } = this;
    const start = SHIFT * f - LEFT;
    let sum = 0;
    for (let i = 0; i < WIN; i++) {
      let s = start + i;
      while (s < 0 || s >= total) s = s < 0 ? -s - 1 : 2 * total - 1 - s; // mirror at either end
      sum += re[i] = buf[s - base];
    }
    const mean = sum / WIN;
    for (let i = 0; i < WIN; i++) re[i] -= mean;
    for (let i = WIN - 1; i > 0; i--) re[i] -= PREEMPH * re[i - 1];
    re[0] -= PREEMPH * re[0];
    for (let i = 0; i < WIN; i++) re[i] *= WINDOW[i];
    re.fill(0, WIN);
    im.fill(0);
    fft(re, im);
    for (let k = 0; k < NFFT / 2; k++) re[k] = re[k] * re[k] + im[k] * im[k];

    const q = this.available; // this.frames already counts this frame
    if (q * NUM_BINS > this.feat.length) {
      const bigger = new Float32Array(this.feat.length * 2);
      bigger.set(this.feat);
      this.feat = bigger;
    }
    const out = this.feat.subarray((q - 1) * NUM_BINS, q * NUM_BINS);
    for (let b = 0; b < NUM_BINS; b++) {
      const { offset, w } = BANKS[b];
      let e = 0;
      for (let j = 0; j < w.length; j++) e += w[j] * re[offset + j];
      out[b] = Math.log(Math.max(e, LOG_FLOOR));
    }
  }
}
