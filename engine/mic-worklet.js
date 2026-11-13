// Runs on the audio thread: collects the microphone signal and hands it to the page in 100 ms pieces.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.piece = new Float32Array(Math.round(sampleRate / 10));
    this.n = 0;
  }

  process(inputs) {
    const ch = inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.piece[this.n++] = ch[i];
        if (this.n === this.piece.length) {
          this.port.postMessage(this.piece.slice());
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('capture', Capture);
