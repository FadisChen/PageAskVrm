export type PageContext = {
  title: string;
  url: string;
  text: string;
  originalChars: number;
  retainedChars: number;
  truncated: boolean;
};

export const WINDOW_MESSAGE_TYPES = Object.freeze({
  PAGE_CONTEXT: "PAGE_CONTEXT",
  PAGE_CONTEXT_UPDATED: "PAGE_CONTEXT_UPDATED",
  REQUEST_PAGE_CONTEXT: "REQUEST_PAGE_CONTEXT",
  OVERLAY_READY: "OVERLAY_READY",
  OVERLAY_STATUS: "OVERLAY_STATUS",
  SET_OVERLAY_SIDE: "SET_OVERLAY_SIDE",
  CLOSE_OVERLAY: "CLOSE_OVERLAY",
});

export function isPageContext(value: unknown): value is PageContext {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.title === "string"
    && typeof item.url === "string"
    && typeof item.text === "string"
    && Number.isInteger(item.originalChars)
    && Number.isInteger(item.retainedChars)
    && typeof item.truncated === "boolean";
}

export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+\n/g, "\n")
    .replace(/\n[\t\f\v ]+/g, "\n")
    .replace(/[\t\f\v ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function safePageUrl(value: unknown): string {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}
