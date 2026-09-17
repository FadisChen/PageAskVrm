import { afterEach, expect, it, vi } from "vitest";
import { AudioEngine } from "../src/audio/audio-engine";

afterEach(() => vi.unstubAllGlobals());

it("suppresses queued capture during text replies and resumes without reopening the microphone", async () => {
  let capture: (event: { data: Float32Array }) => void;
  const stopTrack = vi.fn();
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }));
  const node = () => ({ connect() {}, disconnect() {}, gain: { value: 0 } });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("chrome", { runtime: { getURL: (path: string) => path } });
  vi.stubGlobal("AudioContext", class {
    currentTime = 0;
    sampleRate = 16000;
    destination = {};
    state = "running";
    audioWorklet = { async addModule() {} };
    async resume() {}
    async close() {}
    createGain = node;
    createAnalyser = node;
    createMediaStreamSource = node;
  });
  vi.stubGlobal("AudioWorkletNode", class {
    port = {
      set onmessage(callback: typeof capture) { capture = callback; },
    };
    connect() {}
    disconnect() {}
  });
  const onInputChunk = vi.fn();
  const audio = new AudioEngine({ onInputChunk });
  await audio.start();
  const queuedCapture = capture!;
  const samples = { data: new Float32Array([0.2, 0.3]) };
  queuedCapture(samples);
  expect(onInputChunk).toHaveBeenCalledOnce();
  audio.pauseMicrophone();
  queuedCapture(samples);
  expect(onInputChunk).toHaveBeenCalledOnce();
  audio.setMuted(true);
  audio.resumeMicrophone();
  queuedCapture(samples);
  expect(onInputChunk).toHaveBeenCalledOnce();
  audio.setMuted(false);
  queuedCapture(samples);
  expect(onInputChunk).toHaveBeenCalledTimes(2);
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(stopTrack).not.toHaveBeenCalled();
  await audio.stop();
  expect(stopTrack).toHaveBeenCalledOnce();
});
