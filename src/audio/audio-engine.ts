export type AudioCallbacks = {
  onInputChunk?: (bytes: Uint8Array) => void;
  onInputLevel?: (level: number) => void;
  onOutputStarted?: () => void;
  onOutputDrained?: () => void;
};

export class AudioEngine {
  private readonly callbacks: AudioCallbacks;
  private context: AudioContext | null = null;
  private inputStream: MediaStream | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private processor: AudioWorkletNode | null = null;
  private silentGain: GainNode | null = null;
  private outputGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private readonly activeSources = new Set<AudioBufferSourceNode>();
  private nextPlayTime = 0;
  private running = false;
  private muted = false;
  private microphonePaused = false;

  constructor(callbacks: AudioCallbacks = {}) { this.callbacks = callbacks; }

  async start(captureMicrophone = true): Promise<void> {
    if (this.running) return;
    const AudioContextClass = globalThis.AudioContext
      || (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) throw new Error("此瀏覽器不支援 Web Audio API。");
    this.context = new AudioContextClass({ latencyHint: "interactive" });
    await this.context.resume();
    this.outputGain = this.context.createGain();
    this.outputGain.gain.value = .92;
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = .55;
    this.outputGain.connect(this.analyser);
    this.analyser.connect(this.context.destination);

    if (captureMicrophone) await this.setupMicrophone();
    this.nextPlayTime = this.context.currentTime;
    this.running = true;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.callbacks.onInputLevel?.(0);
  }

  private async setupMicrophone(): Promise<void> {
    if (!this.context) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("此瀏覽器不支援麥克風擷取。");
    this.inputStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    this.inputSource = this.context.createMediaStreamSource(this.inputStream);
    await this.context.audioWorklet.addModule(chrome.runtime.getURL("pcm-capture.worklet.js"));
    this.processor = new AudioWorkletNode(this.context, "pageask-vrm-audio-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
    });
    this.silentGain = this.context.createGain();
    this.silentGain.gain.value = 0;
    this.processor.port.onmessage = (event: MessageEvent<Float32Array>) => this.capture(event.data);
    this.inputSource.connect(this.processor);
    this.processor.connect(this.silentGain);
    this.silentGain.connect(this.context.destination);
  }

  // Keep the capture graph ready; the Live client signals audioStreamEnd to the server.
  pauseMicrophone(): void {
    this.microphonePaused = true;
    this.callbacks.onInputLevel?.(0);
  }

  resumeMicrophone(): void {
    this.microphonePaused = false;
  }

  playPcm(bytes: Uint8Array, sampleRate = 24000): void {
    if (!this.context || !this.outputGain || !bytes.byteLength) return;
    const sampleCount = Math.floor(bytes.byteLength / 2);
    if (!sampleCount) return;
    const buffer = this.context.createBuffer(1, sampleCount, sampleRate);
    const channel = buffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < sampleCount; index += 1) channel[index] = view.getInt16(index * 2, true) / 32768;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.outputGain);
    const startAt = Math.max(this.context.currentTime + (this.activeSources.size ? 0 : .08), this.nextPlayTime);
    source.start(startAt);
    this.nextPlayTime = startAt + buffer.duration;
    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      try { source.disconnect(); } catch { /* already disconnected */ }
      if (!this.activeSources.size) this.callbacks.onOutputDrained?.();
    };
    this.callbacks.onOutputStarted?.();
  }

  isPlaying(): boolean {
    return Boolean(this.context && this.activeSources.size && this.nextPlayTime > this.context.currentTime + .018);
  }

  getAnalyser(): AnalyserNode | null { return this.analyser; }

  flushPlayback(): void {
    for (const source of this.activeSources) {
      source.onended = null;
      try { source.stop(); source.disconnect(); } catch { /* already stopped */ }
    }
    this.activeSources.clear();
    if (this.context) this.nextPlayTime = this.context.currentTime;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.microphonePaused = false;
    this.flushPlayback();
    if (this.processor) {
      this.processor.port.onmessage = null;
      try { this.processor.disconnect(); } catch { /* already disconnected */ }
    }
    try { this.inputSource?.disconnect(); } catch { /* already disconnected */ }
    try { this.silentGain?.disconnect(); } catch { /* already disconnected */ }
    try { this.outputGain?.disconnect(); } catch { /* already disconnected */ }
    try { this.analyser?.disconnect(); } catch { /* already disconnected */ }
    this.inputStream?.getTracks().forEach((track) => track.stop());
    const context = this.context;
    this.context = null;
    this.inputStream = null;
    this.inputSource = null;
    this.processor = null;
    this.silentGain = null;
    this.outputGain = null;
    this.analyser = null;
    this.callbacks.onInputLevel?.(0);
    if (context && context.state !== "closed") await context.close();
  }

  private capture(samples: Float32Array): void {
    if (!this.running || !this.context || this.muted || this.microphonePaused) return;
    const pcm = floatToPcm16(resample(samples, this.context.sampleRate, 16000));
    this.callbacks.onInputChunk?.(pcm);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    this.callbacks.onInputLevel?.(Math.min(1, Math.sqrt(sum / Math.max(1, samples.length)) * 3.5));
  }
}

export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) sum += input[sourceIndex];
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
}

export function floatToPcm16(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytes;
}

export function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const output = new Float32Array(Math.floor(bytes.byteLength / 2));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < output.length; index += 1) output[index] = view.getInt16(index * 2, true) / 32768;
  return output;
}
