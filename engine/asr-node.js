// Node twin of the recogniser: the same createCore on onnxruntime-node. Used by tests and replay tools.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wavTo16k } from './audio-util.js';
import { createCore, parseTokens, spellingTable } from './asr-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_DIR = path.join(ROOT, 'models', 'quran-asr-tiny');

let ortPromise;
const sessions = new Map(); // one model session per thread count

async function getSession(threads) {
  ortPromise ??= import('onnxruntime-node');
  const ort = await ortPromise;
  if (!sessions.has(threads)) {
    sessions.set(threads, ort.InferenceSession.create(path.join(MODEL_DIR, 'model.int8.onnx'), {
      intraOpNumThreads: threads, interOpNumThreads: 1, graphOptimizationLevel: 'all' }));
  }
  return { ort, session: await sessions.get(threads) };
}

export async function createRecognizer({ threads = 1, slow = 1, spelling } = {}) {
  const { ort, session } = await getSession(threads);
  const tokens = parseTokens(fs.readFileSync(path.join(MODEL_DIR, 'tokens.txt'), 'utf8'));
  if (spelling === undefined) spelling = spellingTable(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'spelling.json'), 'utf8')));
  const run = async (feat, frames) => {
    const out = await session.run({
      x: new ort.Tensor('float32', feat, [1, frames, 80]),
      x_lens: new ort.Tensor('int64', BigInt64Array.from([BigInt(frames)]), [1]),
    });
    const [, f, vocab] = out.log_probs.dims;
    return { data: out.log_probs.data, frames: Number(out.log_probs_len.data[0] ?? f), vocab };
  };
  const core = createCore({ run, tokens, spelling, slow });
  return { hear: core.hear, info: { backend: 'onnxruntime-node', threads, slow } };
}

// 16-bit PCM WAV file → Float32 at 16 kHz (mono, first channel).
export function readWav(file, { start = 0, dur } = {}) {
  const b = fs.readFileSync(file);
  const x = wavTo16k(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  const a = Math.round(start * 16000);
  return x.slice(a, dur ? a + Math.round(dur * 16000) : undefined);
}
