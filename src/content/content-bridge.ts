import { WINDOW_MESSAGE_TYPES, type PageContext } from "../shared/messages";
import { extractPageContext } from "./page-context";

const ROOT_ATTRIBUTE = "data-pageask-vrm-root";
const OVERLAY_WIDTH = 320;
const OVERLAY_HEIGHT = 450;

type BridgeState = {
  iframe: HTMLIFrameElement;
  timer: number;
  lastLocation: string;
  lastTitle: string;
  onLoad: () => void;
  onMessage: (event: MessageEvent) => void;
};

declare global {
  var __pageAskVrmBridge: { toggle: () => void } | undefined;
}

function extensionOrigin(): string {
  return new URL(chrome.runtime.getURL("overlay.html")).origin;
}

function sendContext(state: BridgeState, type: string = WINDOW_MESSAGE_TYPES.PAGE_CONTEXT): void {
  const context = extractPageContext(document);
  state.iframe.contentWindow?.postMessage({ type, context }, extensionOrigin());
}

function removeOverlay(state: BridgeState): void {
  window.clearInterval(state.timer);
  window.removeEventListener("message", state.onMessage, true);
  state.iframe.removeEventListener("load", state.onLoad);
  state.iframe.remove();
  delete globalThis.__pageAskVrmBridge;
}

function setOverlaySide(state: BridgeState, data: { side?: unknown }): void {
  if (data.side !== "left" && data.side !== "right") return;
  state.iframe.style.left = data.side === "left" ? "16px" : "auto";
  state.iframe.style.right = data.side === "right" ? "16px" : "auto";
  state.iframe.style.top = "auto";
  state.iframe.style.bottom = "14px";
}

function mountOverlay(): void {
  if (globalThis.__pageAskVrmBridge) return;
  const existing = document.querySelector<HTMLIFrameElement>(`iframe[${ROOT_ATTRIBUTE}]`);
  if (existing) existing.remove();

  const iframe = document.createElement("iframe");
  iframe.setAttribute(ROOT_ATTRIBUTE, "true");
  iframe.title = "PageAsk VRM Avatar";
  iframe.src = chrome.runtime.getURL("overlay.html");
  iframe.allow = "microphone";
  iframe.setAttribute("aria-label", "PageAsk VRM Avatar");
  Object.assign(iframe.style, {
    position: "fixed",
    right: "16px",
    bottom: "14px",
    width: `${OVERLAY_WIDTH}px`,
    height: `${OVERLAY_HEIGHT}px`,
    border: "0",
    margin: "0",
    padding: "0",
    background: "transparent",
    colorScheme: "normal",
    zIndex: "2147483646",
    overflow: "visible",
    pointerEvents: "auto",
  });

  const state: BridgeState = {
    iframe,
    timer: 0,
    lastLocation: location.href,
    lastTitle: document.title,
    onLoad: () => sendContext(state),
    onMessage: (event) => {
      if (event.source !== iframe.contentWindow || event.origin !== extensionOrigin()) return;
      const data = event.data as { type?: string; side?: unknown } | null;
      if (data?.type === WINDOW_MESSAGE_TYPES.REQUEST_PAGE_CONTEXT) sendContext(state);
      if (data?.type === WINDOW_MESSAGE_TYPES.SET_OVERLAY_SIDE) setOverlaySide(state, data);
      if (data?.type === WINDOW_MESSAGE_TYPES.CLOSE_OVERLAY) removeOverlay(state);
    },
  };

  iframe.addEventListener("load", state.onLoad);
  window.addEventListener("message", state.onMessage, true);
  document.documentElement.appendChild(iframe);
  state.timer = window.setInterval(() => {
    if (location.href === state.lastLocation && document.title === state.lastTitle) return;
    state.lastLocation = location.href;
    state.lastTitle = document.title;
    sendContext(state, WINDOW_MESSAGE_TYPES.PAGE_CONTEXT_UPDATED);
  }, 900);

  globalThis.__pageAskVrmBridge = { toggle: () => removeOverlay(state) };
}

if (globalThis.__pageAskVrmBridge) {
  globalThis.__pageAskVrmBridge.toggle();
} else {
  mountOverlay();
}
