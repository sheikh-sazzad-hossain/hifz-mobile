// Microphone capture at 16 kHz mono, with no path to the speakers (the stream goes to the worklet only).
//   openMic({ onAudio(float32Array16k), fake }) → { pause(), resume(), stop(), paused }
// `fake` replaces the microphone for tests: { samples (Float32 16 kHz) or url (wav), speed = 1, loop = false,
// onEnd() }. It pushes 100 ms pieces on a timer, nothing is played and no permission is asked.
// While paused, audio is dropped (the session stays open).
import { resample, wavTo16k } from './audio-util.js';

const PIECE = 1600; // 100 ms at 16 kHz

export async function openMic({ onAudio, fake, onEnd, echoCancel = true, noiseSuppress = false, autoGain = 'browser', deviceId = 'default' } = {}) {
  let paused = false;
  const emit = (x) => { if (!paused) onAudio(x); };

  if (fake) {
    let samples = fake.samples;
    if (!samples && fake.url) samples = wavTo16k(await (await fetch(fake.url)).arrayBuffer());
    const speed = fake.speed ?? 1;
    let pos = 0;
    let last = performance.now();
    let carry = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      carry += ((now - last) / 1000) * 16000 * speed;
      last = now;
      while (carry >= PIECE) {
        carry -= PIECE;
        if (pos >= samples.length) {
          if (fake.loop) pos = 0;
          else { clearInterval(timer); (fake.onEnd ?? onEnd)?.(); return; }
        }
        const piece = new Float32Array(PIECE);
        piece.set(samples.subarray(pos, pos + PIECE));
        pos += PIECE;
        emit(piece);
      }
    }, 50);
    return {
      pause() { paused = true; }, resume() { paused = false; last = performance.now(); },
      stop() { clearInterval(timer); }, get paused() { return paused; }, get position() { return pos / 16000; },
    };
  }

  const audioC = { channelCount: 1, echoCancellation: echoCancel, noiseSuppression: noiseSuppress };
  if (autoGain !== 'browser') audioC.autoGainControl = autoGain === 'on';
  if (deviceId && deviceId !== 'default') audioC.deviceId = { exact: deviceId };
  const stream = await navigator.mediaDevices.getUserMedia({ audio: audioC });
  let ctx;
  try { ctx = new AudioContext({ sampleRate: 16000 }); } catch { ctx = new AudioContext(); }
  await ctx.audioWorklet.addModule(new URL('./mic-worklet.js', import.meta.url));
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'capture', { numberOfInputs: 1, numberOfOutputs: 0 }); // no output: nothing reaches the speakers
  node.port.onmessage = ({ data }) => emit(ctx.sampleRate === 16000 ? data : resample(data, ctx.sampleRate, 16000));
  src.connect(node);
  await ctx.resume();
  return {
    pause() { paused = true; }, resume() { paused = false; },
    stop() { node.disconnect(); src.disconnect(); stream.getTracks().forEach((t) => t.stop()); ctx.close(); },
    get paused() { return paused; },
  };
}
