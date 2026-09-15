// AudioWorkletGlobalScope is not included in the standard DOM TypeScript lib.
// @ts-nocheck
const CAPTURE_SIZE = 1024;

class PageAskVrmAudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(CAPTURE_SIZE);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    let inputOffset = 0;
    while (inputOffset < input.length) {
      const copyLength = Math.min(input.length - inputOffset, CAPTURE_SIZE - this.offset);
      this.buffer.set(input.subarray(inputOffset, inputOffset + copyLength), this.offset);
      this.offset += copyLength;
      inputOffset += copyLength;
      if (this.offset === CAPTURE_SIZE) {
        const samples = this.buffer;
        this.port.postMessage(samples, [samples.buffer]);
        this.buffer = new Float32Array(CAPTURE_SIZE);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("pageask-vrm-audio-capture", PageAskVrmAudioCaptureProcessor);
