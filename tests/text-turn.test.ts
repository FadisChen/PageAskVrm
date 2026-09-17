import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AudioCallbacks } from "../src/audio/audio-engine";
import type { LiveServerMessage } from "@google/genai";

const fake = vi.hoisted(() => ({
  connect: vi.fn(),
  sendRealtimeInput: vi.fn(),
  sendClientContent: vi.fn(),
  close: vi.fn(),
  audioCallbacks: {} as AudioCallbacks,
  playing: false,
  paused: false,
  muted: false,
}));
vi.mock("@google/genai", async (original) => ({
  ...await original<typeof import("@google/genai")>(),
  GoogleGenAI: class { live = { connect: fake.connect }; },
}));
vi.mock("../src/audio/audio-engine", () => ({
  AudioEngine: class {
    constructor(callbacks: AudioCallbacks) { fake.audioCallbacks = callbacks; }
    async start() {}
    async stop() { fake.paused = false; }
    setMuted(value: boolean) { fake.muted = value; }
    pauseMicrophone() { fake.paused = true; }
    async resumeMicrophone() { fake.paused = false; }
    playPcm() { fake.playing = true; fake.audioCallbacks.onOutputStarted?.(); }
    isPlaying() { return fake.playing; }
    flushPlayback() { fake.playing = false; }
  },
}));
vi.mock("../src/avatar/vrm-avatar-controller", () => ({
  VrmAvatarController: class {
    async load() {}
    finishTurn() {}
    resetAnimation() {}
  },
}));
vi.mock("../src/shared/knowledge", () => ({ loadKnowledge: async () => null }));
vi.mock("../src/shared/traditional-chinese", () => ({ toTraditionalChinese: (text: string) => text }));

class Element extends EventTarget {
  value = "";
  textContent = "";
  dataset: Record<string, string> = {};
  classList = { add() {}, remove() {}, toggle() {} };
  setAttribute() {}
}
let elements: Map<string, Element>;
let server: (message: Partial<LiveServerMessage>) => void;
let connected: (setupComplete?: boolean) => void;
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const element = (id: string) => elements.get(id)!;
function sendText(value = "第一則問題") {
  element("textInputField").value = value;
  const event = new Event("keydown", { cancelable: true });
  Object.assign(event, { key: "Enter", isComposing: false, keyCode: 13 });
  element("textInputField").dispatchEvent(event);
}
function sendMicChunk() {
  if (!fake.paused && !fake.muted) fake.audioCallbacks.onInputChunk?.(new Uint8Array([0, 0]));
}
function reply() {
  server({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAA=", mimeType: "audio/pcm;rate=24000" } }] } } });
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  fake.playing = fake.paused = fake.muted = false;
  elements = new Map();
  vi.stubGlobal("document", {
    referrer: "",
    querySelector(selector: string) {
      const target = new Element();
      elements.set(selector.slice(1), target);
      return target;
    },
  });
  const windowMock = Object.assign(new EventTarget(), {
    setTimeout, clearTimeout, parent: { postMessage() {} },
  });
  vi.stubGlobal("window", windowMock);
  vi.stubGlobal("requestAnimationFrame", vi.fn());
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => path },
    storage: {
      local: { get: async () => ({ pageAskVrmSettings: { apiKey: "test-key", showText: true } }) },
      onChanged: { addListener() {} },
    },
  });
  fake.connect.mockImplementation(({ callbacks }) => {
    server = callbacks.onmessage;
    callbacks.onopen?.();
    return new Promise((resolve) => {
      connected = (setupComplete = true) => {
        resolve({
          sendRealtimeInput: fake.sendRealtimeInput,
          sendClientContent: fake.sendClientContent,
          close: fake.close,
        });
        if (setupComplete) server({ setupComplete: {} });
      };
    });
  });
  await import("../src/overlay/overlay");
  await settle();
  const context = new Event("message");
  Object.assign(context, { source: windowMock.parent, data: {
    type: "PAGE_CONTEXT",
    context: { title: "Test", url: "https://example.com", text: "Test", originalChars: 4, retainedChars: 4, truncated: false },
  } });
  windowMock.dispatchEvent(context);
  element("connectButton").dispatchEvent(new Event("click"));
  await settle();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("does not advertise CONNECTED or discard the first text before the session is ready", () => {
  expect(element("statusText").textContent).not.toBe("CONNECTED");
  sendText();
  expect(element("textInputField").value).toBe("第一則問題");
  expect(fake.sendClientContent).not.toHaveBeenCalled();
});

it("waits for server setupComplete before accepting text or audio", async () => {
  connected(false); await settle();
  expect(element("connectButton").dataset.state).toBe("connecting");
  sendText(); sendMicChunk();
  expect(element("textInputField").value).toBe("第一則問題");
  expect(fake.sendClientContent).not.toHaveBeenCalled();
  expect(fake.sendRealtimeInput).not.toHaveBeenCalled();
  server({ setupComplete: {} });
  expect(element("statusText").textContent).toBe("CONNECTED");
  sendText();
  expect(fake.sendClientContent).toHaveBeenCalledOnce();
});

it("keeps capture paused past six seconds without an interruption event", async () => {
  connected(); await settle();
  sendText();
  await vi.advanceTimersByTimeAsync(7000);
  sendMicChunk();
  expect(fake.sendRealtimeInput).not.toHaveBeenCalled();
});

it("waits for turn completion when playback drains between response chunks", async () => {
  connected(); await settle();
  sendText(); reply();
  fake.playing = false; fake.audioCallbacks.onOutputDrained?.();
  sendMicChunk();
  expect(fake.sendRealtimeInput).not.toHaveBeenCalled();
  server({ serverContent: { turnComplete: true } });
  sendMicChunk();
  expect(fake.sendRealtimeInput).toHaveBeenCalledOnce();
});

it("releases suppression after a transcript-only reply", async () => {
  connected(); await settle();
  sendText();
  server({ serverContent: { outputTranscription: { text: "回答" }, turnComplete: true } });
  sendMicChunk();
  expect(fake.sendRealtimeInput).toHaveBeenCalledOnce();
});

it("ends a voice stream on mute without sending a duplicate end for the following text", async () => {
  connected(); await settle();
  sendMicChunk();
  element("muteButton").dispatchEvent(new Event("click"));
  expect(fake.sendRealtimeInput).toHaveBeenLastCalledWith({ audioStreamEnd: true });
  const calls = fake.sendRealtimeInput.mock.calls.length;
  sendText();
  expect(fake.sendRealtimeInput).toHaveBeenCalledTimes(calls);
  expect(fake.sendClientContent).toHaveBeenCalledOnce();
});

it("ends the microphone stream before dispatching the first text turn", async () => {
  connected(); await settle();
  sendMicChunk();
  sendText();
  expect(fake.sendClientContent).toHaveBeenCalledExactlyOnceWith({
    turns: [{ role: "user", parts: [{ text: "第一則問題" }] }], turnComplete: true,
  });
  expect(fake.sendRealtimeInput).toHaveBeenLastCalledWith({ audioStreamEnd: true });
  expect(fake.sendRealtimeInput.mock.invocationCallOrder.at(-1)).toBeLessThan(fake.sendClientContent.mock.invocationCallOrder[0]);
});

it("keeps the microphone suppressed after an old turn is interrupted and while the first reply is pending", async () => {
  connected(); await settle();
  sendMicChunk(); sendText();
  fake.sendRealtimeInput.mockClear();
  server({ serverContent: { interrupted: true, turnComplete: true } });
  await vi.advanceTimersByTimeAsync(7000);
  sendMicChunk();
  expect(fake.sendRealtimeInput).not.toHaveBeenCalled();
  reply();
  server({ serverContent: { turnComplete: true } });
  sendMicChunk();
  expect(fake.sendRealtimeInput).not.toHaveBeenCalled();
  fake.playing = false;
  fake.audioCallbacks.onOutputDrained?.();
  sendMicChunk();
  expect(fake.sendRealtimeInput).toHaveBeenCalledOnce();
});

it("preserves text and restores the microphone when sending fails", async () => {
  connected(); await settle();
  fake.sendClientContent.mockImplementationOnce(() => { throw new Error("socket closed"); });
  sendText();
  expect(element("textInputField").value).toBe("第一則問題");
  expect(fake.paused).toBe(false);
  expect(element("statusText").textContent).toBe("socket closed");
});

it("can unmute after a text reply finishes while muted", async () => {
  connected(); await settle();
  sendText();
  element("muteButton").dispatchEvent(new Event("click"));
  reply(); server({ serverContent: { turnComplete: true } });
  fake.playing = false; fake.audioCallbacks.onOutputDrained?.();
  element("muteButton").dispatchEvent(new Event("click"));
  fake.sendRealtimeInput.mockClear();
  sendMicChunk();
  expect(fake.sendRealtimeInput).toHaveBeenCalledOnce();
});
