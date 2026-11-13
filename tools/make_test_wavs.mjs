// Makes the fake-microphone recordings for the browser tests in _local/ (git-ignored) from the user's own recordings
// (read-only): node tools/make_test_wavs.mjs
import fs from 'node:fs';
import { readWav } from '../engine/asr-node.js';

const R = 'D:/Claude/Tarteel_Personal/recordings/';
function writeWav(file, x) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  fs.mkdirSync('_local', { recursive: true });
  fs.writeFileSync(file, b);
}
writeWav('_local/s93.wav', readWav(`${R}20261030_081848.wav`));
writeWav('_local/multi.wav', readWav(`${R}20261105_181926.wav`, { start: 95, dur: 75 })); // the end of Surah 78 into Surah 79
const a = readWav(`${R}20261030_081848.wav`);
const out = new Float32Array(a.length + 6 * 16000);
out.set(a.subarray(0, 20 * 16000));
out.set(a.subarray(20 * 16000), 26 * 16000); // 6 s of silence at 20 s: the silence prompt
writeWav('_local/prompt.wav', out);
console.log('ok');
