import "./overlay.css";
import { isPageContext, WINDOW_MESSAGE_TYPES, type PageContext } from "../shared/messages";
import { cleanSettings, loadSettings, saveSettings, type Settings } from "../shared/settings";
import { loadKnowledge, type KnowledgeDocument } from "../shared/knowledge";
import { toTraditionalChinese } from "../shared/traditional-chinese";
import { AudioEngine } from "../audio/audio-engine";
import { LipSyncAnalyzer } from "../audio/lip-sync";
import { VrmAvatarController } from "../avatar/vrm-avatar-controller";
import { AvatarStateMachine } from "../avatar/state-machine";
import { GeminiLiveClient, buildSystemInstruction, resolveApiKey } from "../live/gemini-live-client";
import type { AvatarEmotion } from "../avatar/emotions";
import type { AvatarGesture } from "../avatar/gestures";

const MAX_BUBBLE_CHARS = 180;

const appRoot = document.querySelector<HTMLElement>("#app")!;
const canvas = document.querySelector<HTMLCanvasElement>("#avatarCanvas")!;
const bubble = document.querySelector<HTMLElement>("#bubble")!;
const bubbleText = document.querySelector<HTMLParagraphElement>("#bubbleText")!;
const status = document.querySelector<HTMLElement>("#status")!;
const statusText = document.querySelector<HTMLElement>("#statusText")!;
const connectButton = document.querySelector<HTMLButtonElement>("#connectButton")!;
const connectButtonText = document.querySelector<HTMLElement>("#connectButtonText")!;
const muteButton = document.querySelector<HTMLButtonElement>("#muteButton")!;
const textButton = document.querySelector<HTMLButtonElement>("#textButton")!;
const textInputRow = document.querySelector<HTMLElement>("#textInputRow")!;
const textInputField = document.querySelector<HTMLInputElement>("#textInputField")!;
const leftButton = document.querySelector<HTMLButtonElement>("#leftButton")!;
const rightButton = document.querySelector<HTMLButtonElement>("#rightButton")!;
const settingsButton = document.querySelector<HTMLButtonElement>("#settingsButton")!;
const closeButton = document.querySelector<HTMLButtonElement>("#closeButton")!;

let settings: Settings = cleanSettings(null);
let knowledge: KnowledgeDocument | null = null;
let context: PageContext | null = null;
let sessionActive = false;
let starting = false;
let muted = false;
let modelTranscript = "";
let transcriptTurnOpen = false;
let bubbleFadeTimer = 0;
let previousFrame = performance.now();

const stateMachine = new AvatarStateMachine();
const audio = new AudioEngine({
  onInputChunk: (bytes) => live.sendAudio(bytes),
  onInputLevel: () => {},
  onOutputStarted: () => {
    stateMachine.toSpeaking();
    avatar.finishTurn();
  },
  onOutputDrained: () => {
    lipSync?.reset();
    avatar.resetAnimation();
    if (!sessionActive) return;
    if (stateMachine.state === "speaking") stateMachine.toListening();
  },
});
const live = new GeminiLiveClient({
  onStatus: (next) => {
    if (next === "connected") {
      stateMachine.toListening();
      setStatus("connected", "CONNECTED");
    } else if (next === "connecting") setStatus("connecting", "CONNECTING");
    else if (next === "reconnecting") setStatus("reconnecting", "RECONNECTING");
    else if (next === "failed") setStatus("failed", "FAILED");
    else setStatus("stopped", "READY");
  },
  onAudio: (bytes, sampleRate) => audio.playPcm(bytes, sampleRate),
  onUserTranscript: () => { stateMachine.toThinking(); },
  onModelTranscript: (text) => updateBubble(text),
  onInterrupted: () => {
    audio.flushPlayback();
    lipSync?.reset();
    avatar.resetAnimation();
    stateMachine.toListening();
    clearBubble();
  },
  onTurnComplete: () => {
    transcriptTurnOpen = false;
    avatar.finishTurn();
    if (!audio.isPlaying()) {
      lipSync?.reset();
      avatar.resetAnimation();
    }
    window.clearTimeout(bubbleFadeTimer);
    bubbleFadeTimer = window.setTimeout(() => { if (!audio.isPlaying()) clearBubble(); }, 2600);
  },
  onEmotion: (emotion: AvatarEmotion) => avatar.setEmotion(emotion),
  onGesture: (gesture: AvatarGesture) => avatar.playGesture(gesture),
  onError: (error) => showStatusError(error.message),
});
const avatar = new VrmAvatarController(canvas, {
  onLoading: (progress) => setStatus("loading", `VRM ${Math.round(progress * 100)}%`),
  onReady: () => { if (!sessionActive) setStatus("ready", "READY"); },
  onError: (error) => showStatusError(`VRM 載入失敗：${error.message}`),
});

void initialize();
updateConnectionButton();

async function initialize(): Promise<void> {
  settings = await loadSettings();
  updateTextButton();
  updateTextInputVisibility();
  await avatar.load(chrome.runtime.getURL("avatars/sha.vrm"));
  window.parent.postMessage({ type: WINDOW_MESSAGE_TYPES.REQUEST_PAGE_CONTEXT }, parentOrigin());
}

connectButton.addEventListener("click", (event) => {
  event.stopPropagation();
  if (starting || sessionActive) void endSession();
  else void startSession();
});

muteButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setMuted(!muted);
});

textButton.addEventListener("click", async (event) => {
  event.stopPropagation();
  settings = await saveSettings({ ...settings, showText: !settings.showText });
  updateTextButton();
  if (!settings.showText) clearBubble();
});

textInputField.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  const value = textInputField.value.trim();
  if (!value) return;
  if (!sessionActive) {
    showStatusError("請先點擊 CONNECT 連線。");
    return;
  }
  if (!live.isConnected()) {
    showStatusError("連線尚未就緒，請稍後再送出。");
    return;
  }
  try {
    if (live.sendText(value)) {
      stateMachine.toThinking();
      textInputField.value = "";
    }
  } catch (error) {
    showStatusError(error instanceof Error ? error.message : String(error));
  }
});

leftButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setOverlaySide("left");
});

rightButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setOverlaySide("right");
});

settingsButton.addEventListener("click", (event) => {
  event.stopPropagation();
  void chrome.runtime.openOptionsPage();
});

closeButton.addEventListener("click", (event) => {
  event.stopPropagation();
  void endSession(false);
  window.parent.postMessage({ type: WINDOW_MESSAGE_TYPES.CLOSE_OVERLAY }, parentOrigin());
});

window.addEventListener("message", (event) => {
  const allowedOrigin = parentOrigin();
  if (event.source !== window.parent || (allowedOrigin !== "*" && event.origin !== allowedOrigin)) return;
  const data = event.data as { type?: string; context?: unknown } | null;
  if (!data || (data.type !== WINDOW_MESSAGE_TYPES.PAGE_CONTEXT && data.type !== WINDOW_MESSAGE_TYPES.PAGE_CONTEXT_UPDATED)) return;
  if (!isPageContext(data.context)) return;
  const wasActive = sessionActive;
  context = data.context;
  if (data.type === WINDOW_MESSAGE_TYPES.PAGE_CONTEXT_UPDATED && wasActive) {
    void restartForPageChange();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.pageAskVrmSettings?.newValue) return;
  settings = cleanSettings(changes.pageAskVrmSettings.newValue);
  updateTextButton();
  if (!settings.showText) clearBubble();
});

function parentOrigin(): string {
  if (!document.referrer) return "*";
  try {
    return new URL(document.referrer).origin;
  } catch {
    return "*";
  }
}

async function startSession(): Promise<void> {
  if (starting || sessionActive) return;
  starting = true;
  updateConnectionButton();
  try {
    if (!context) {
      window.parent.postMessage({ type: WINDOW_MESSAGE_TYPES.REQUEST_PAGE_CONTEXT }, parentOrigin());
      throw new Error("正在讀取目前頁面內容，請再點擊一次 Avatar。 ");
    }
    settings = await loadSettings();
    knowledge = await loadKnowledge();
    const apiKey = await resolveApiKey(settings);
    sessionActive = true;
    stateMachine.toListening();
    setStatus("connecting", "CONNECTING");
    await audio.start(true);
    await live.start({
      apiKey,
      voiceName: settings.voiceName,
      systemInstruction: buildSystemInstruction(context, knowledge),
    });
  } catch (error) {
    sessionActive = false;
    await audio.stop();
    live.stop(false);
    stateMachine.toIdle();
    showStatusError(error instanceof Error ? error.message : String(error));
  } finally {
    starting = false;
    updateConnectionButton();
  }
}

async function endSession(showReady = true): Promise<void> {
  if (!sessionActive && !starting) return;
  sessionActive = false;
  starting = false;
  updateConnectionButton();
  live.stop(false);
  await audio.stop();
  lipSync?.reset();
  avatar.resetAnimation();
  stateMachine.toIdle();
  clearBubble();
  if (showReady) setStatus("ready", "READY");
}

async function restartForPageChange(): Promise<void> {
  await endSession(false);
  setStatus("ready", "PAGE UPDATED");
}

function updateBubble(text: string): void {
  if (!settings.showText) return;
  const isNewTurn = !transcriptTurnOpen;
  if (isNewTurn) {
    modelTranscript = "";
    transcriptTurnOpen = true;
  }
  modelTranscript = mergePartial(modelTranscript, text);
  const clipped = clipBubble(toTraditionalChinese(modelTranscript));
  bubbleText.textContent = clipped;
  if (isNewTurn) {
    bubble.classList.remove("is-hidden");
    bubble.classList.add("is-speaking");
  }
}

function clearBubble(): void {
  modelTranscript = "";
  transcriptTurnOpen = false;
  window.clearTimeout(bubbleFadeTimer);
  bubble.classList.add("is-hidden");
  bubble.classList.remove("is-speaking");
  bubbleText.textContent = "";
}

function clipBubble(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(normalized);
  return characters.length > MAX_BUBBLE_CHARS ? `${characters.slice(0, MAX_BUBBLE_CHARS).join("")}…` : normalized;
}

function mergePartial(current: string, incoming: string): string {
  const next = incoming.trim();
  if (!next) return current;
  if (!current) return next;
  if (next.startsWith(current)) return next;
  if (current.endsWith(next)) return current;
  return `${current}${next}`;
}

function updateTextButton(): void {
  textButton.textContent = "💬";
  textButton.dataset.active = String(settings.showText);
  textButton.setAttribute("aria-label", settings.showText ? "關閉文字顯示" : "顯示文字回覆");
  textButton.title = settings.showText ? "關閉文字顯示" : "顯示文字回覆";
}

// Muting the microphone is what switches the Avatar into typing mode.
function setMuted(next: boolean): void {
  muted = next;
  audio.setMuted(muted);
  if (muted) live.endAudioStream();
  muteButton.textContent = muted ? "🔇" : "🎙️";
  muteButton.setAttribute("aria-label", muted ? "解除麥克風靜音" : "麥克風靜音");
  muteButton.title = muted ? "解除麥克風靜音" : "麥克風靜音";
  updateTextInputVisibility();
  if (muted) textInputField.focus();
}

function updateTextInputVisibility(): void {
  textInputRow.classList.toggle("is-hidden", !muted);
  appRoot.dataset.textInput = String(muted);
}

function setOverlaySide(side: "left" | "right"): void {
  avatar.setPlacement(side);
  leftButton.dataset.active = String(side === "left");
  rightButton.dataset.active = String(side === "right");
  window.parent.postMessage({ type: WINDOW_MESSAGE_TYPES.SET_OVERLAY_SIDE, side }, parentOrigin());
}

function updateConnectionButton(): void {
  const active = starting || sessionActive;
  const state = active ? (live.isConnected() ? "connected" : "connecting") : "ready";
  connectButtonText.textContent = active ? "DISCONNECT" : "CONNECT";
  connectButton.dataset.state = state;
  connectButton.setAttribute("aria-label", active ? "中斷連線" : "開始連線");
  connectButton.title = active ? "中斷連線" : "開始連線";
}

function setStatus(state: string, label: string): void {
  status.dataset.state = state;
  statusText.textContent = label;
  const connectionState = state === "connected"
    ? "connected"
    : state === "connecting" || state === "reconnecting"
      ? "connecting"
      : state === "failed"
        ? "failed"
        : "ready";
  connectButton.dataset.state = connectionState;
  const isTransient = state === "connecting" || state === "reconnecting" || state === "failed" || state === "loading";
  status.classList.toggle("is-hidden", !isTransient);
}

function showStatusError(message: string): void {
  setStatus("failed", message.slice(0, 48));
}

let lipSync: LipSyncAnalyzer | null = null;
let lipSyncSource: AnalyserNode | null = null;
function updateLipSync(): void {
  const analyser = audio.getAnalyser();
  if (!analyser) {
    lipSync?.reset();
    lipSync = null;
    lipSyncSource = null;
    return;
  }
  if (!lipSync || lipSyncSource !== analyser) {
    lipSync?.reset();
    lipSync = new LipSyncAnalyzer(analyser);
    lipSyncSource = analyser;
  }
}

function renderFixed(now: number): void {
  const delta = Math.min(.05, Math.max(0, (now - previousFrame) / 1000));
  previousFrame = now;
  updateLipSync();
  if (lipSync) {
    const result = lipSync.update(now, audio.isPlaying());
    avatar.setViseme(result.viseme, result.weight, result.rms);
  }
  avatar.setState(stateMachine.state);
  avatar.update(delta, audio.isPlaying());
  requestAnimationFrame(renderFixed);
}

requestAnimationFrame(renderFixed);
