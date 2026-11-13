// MFCC and DTW as librosa computes them for feedback.py: mfcc(y, sr=16000, n_mfcc=20, hop_length=160, n_fft=400)[1:],
// normalised per coefficient, and librosa.sequence.dtw(metric="cosine") with its path length.
const SR = 16000;
const N_FFT = 400;
const HOP = 160;
const N_MELS = 128;
const BINS = N_FFT / 2 + 1;

// Slaney mel scale (librosa's default, htk=False)
const F_SP = 200 / 3;
const MIN_LOG_HZ = 1000;
const MIN_LOG_MEL = MIN_LOG_HZ / F_SP;
const LOGSTEP = Math.log(6.4) / 27;
const hzToMel = (f) => (f < MIN_LOG_HZ ? f / F_SP : MIN_LOG_MEL + Math.log(f / MIN_LOG_HZ) / LOGSTEP);
const melToHz = (m) => (m < MIN_LOG_MEL ? F_SP * m : MIN_LOG_HZ * Math.exp(LOGSTEP * (m - MIN_LOG_MEL)));

let tables = null;
function init() {
  if (tables) return tables;
  const window = new Float64Array(N_FFT).map((_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT)); // periodic hann
  const cos = new Float64Array(BINS * N_FFT);
  const sin = new Float64Array(BINS * N_FFT);
  for (let k = 0; k < BINS; k++) for (let n = 0; n < N_FFT; n++) {
    const a = (2 * Math.PI * ((k * n) % N_FFT)) / N_FFT;
    cos[k * N_FFT + n] = Math.cos(a) * window[n];
    sin[k * N_FFT + n] = Math.sin(a) * window[n];
  }
  // mel filterbank, slaney-normalised
  const fft = Float64Array.from({ length: BINS }, (_, k) => (k * SR) / N_FFT);
  const lo = hzToMel(0);
  const hi = hzToMel(SR / 2);
  const melF = Float64Array.from({ length: N_MELS + 2 }, (_, i) => melToHz(lo + ((hi - lo) * i) / (N_MELS + 1)));
  const fb = new Float64Array(N_MELS * BINS);
  for (let i = 0; i < N_MELS; i++) {
    const fdiff0 = melF[i + 1] - melF[i];
    const fdiff1 = melF[i + 2] - melF[i + 1];
    const enorm = 2 / (melF[i + 2] - melF[i]);
    for (let k = 0; k < BINS; k++) {
      const lower = -(melF[i] - fft[k]) / fdiff0;
      const upper = (melF[i + 2] - fft[k]) / fdiff1;
      fb[i * BINS + k] = Math.max(0, Math.min(lower, upper)) * enorm;
    }
  }
  // DCT-II, orthonormal, first 20 coefficients
  const dct = new Float64Array(20 * N_MELS);
  for (let k = 0; k < 20; k++) {
    const scale = k === 0 ? Math.sqrt(1 / N_MELS) : Math.sqrt(2 / N_MELS);
    for (let n = 0; n < N_MELS; n++) dct[k * N_MELS + n] = scale * Math.cos((Math.PI * k * (2 * n + 1)) / (2 * N_MELS));
  }
  tables = { cos, sin, fb, dct };
  return tables;
}

// → { data: Float64Array [19 × frames] row-major, rows: 19, cols } the normalised MFCC (coefficient 0 dropped)
export function features(audio) {
  const { cos, sin, fb, dct } = init();
  const frames = 1 + Math.floor(audio.length / HOP);
  const mel = new Float64Array(N_MELS * frames);
  const frame = new Float64Array(N_FFT);
  const power = new Float64Array(BINS);
  for (let f = 0; f < frames; f++) {
    const start = f * HOP - N_FFT / 2; // center = true, zero padding
    for (let n = 0; n < N_FFT; n++) { const i = start + n; frame[n] = i >= 0 && i < audio.length ? audio[i] : 0; }
    for (let k = 0; k < BINS; k++) {
      let re = 0;
      let im = 0;
      const o = k * N_FFT;
      for (let n = 0; n < N_FFT; n++) { re += frame[n] * cos[o + n]; im -= frame[n] * sin[o + n]; }
      power[k] = re * re + im * im;
    }
    for (let m = 0; m < N_MELS; m++) {
      let s = 0;
      for (let k = 0; k < BINS; k++) s += fb[m * BINS + k] * power[k];
      mel[m * frames + f] = s;
    }
  }
  // power_to_db: 10 log10(max(1e-10, S)), floor at max - 80 dB
  let mx = -Infinity;
  for (let i = 0; i < mel.length; i++) { mel[i] = 10 * Math.log10(Math.max(1e-10, mel[i])); if (mel[i] > mx) mx = mel[i]; }
  for (let i = 0; i < mel.length; i++) mel[i] = Math.max(mel[i], mx - 80);
  const rows = 19;
  const out = new Float64Array(rows * frames);
  for (let k = 1; k < 20; k++) {
    for (let f = 0; f < frames; f++) {
      let s = 0;
      for (let m = 0; m < N_MELS; m++) s += dct[k * N_MELS + m] * mel[m * frames + f];
      out[(k - 1) * frames + f] = s;
    }
  }
  for (let r = 0; r < rows; r++) { // (x - mean) / (std + 1e-6) per coefficient over time
    let mean = 0;
    for (let f = 0; f < frames; f++) mean += out[r * frames + f];
    mean /= frames;
    let v = 0;
    for (let f = 0; f < frames; f++) v += (out[r * frames + f] - mean) ** 2;
    const sd = Math.sqrt(v / frames);
    for (let f = 0; f < frames; f++) out[r * frames + f] = (out[r * frames + f] - mean) / (sd + 1e-6);
  }
  return { data: out, rows, cols: frames };
}

// librosa.sequence.dtw(X, Y, metric="cosine") → D[-1,-1] / len(warping path)
export function dtwDistance(X, Y) {
  const n = X.cols;
  const m = Y.cols;
  const dist = (i, j) => {
    let dot = 0;
    let nx = 0;
    let ny = 0;
    for (let r = 0; r < X.rows; r++) { const a = X.data[r * n + i]; const b = Y.data[r * m + j]; dot += a * b; nx += a * a; ny += b * b; }
    return 1 - dot / (Math.sqrt(nx) * Math.sqrt(ny));
  };
  const D = new Float64Array(n * m).fill(Infinity);
  const steps = new Uint8Array(n * m);
  D[0] = dist(0, 0);
  const sigma = [[1, 1], [0, 1], [1, 0]];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (i === 0 && j === 0) continue;
      const c = dist(i, j);
      let best = Infinity;
      let bs = 0;
      for (let s = 0; s < 3; s++) {
        const pi = i - sigma[s][0];
        const pj = j - sigma[s][1];
        if (pi < 0 || pj < 0) continue;
        const cost = D[pi * m + pj] + c;
        if (cost < best) { best = cost; bs = s; }
      }
      D[i * m + j] = best;
      steps[i * m + j] = bs;
    }
  }
  let i = n - 1;
  let j = m - 1;
  let len = 1;
  while (i > 0 || j > 0) {
    const s = steps[i * m + j];
    i -= sigma[s][0];
    j -= sigma[s][1];
    len++;
  }
  return D[n * m - 1] / len;
}

export const audioDistance = (a, b) => dtwDistance(features(a), features(b));
