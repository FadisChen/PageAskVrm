import { normalizeText, safePageUrl, type PageContext } from "../shared/messages";

export const MAX_PAGE_CONTEXT_CHARS = 24_000;

const SKIP_SELECTOR = [
  "script",
  "style",
  "noscript",
  "template",
  "nav",
  "footer",
  "form",
  "[aria-hidden=\"true\"]",
  "[data-pageask-vrm-root]",
  "[data-pageask-vrm-ui]",
  "[role=\"navigation\"]",
  "[role=\"contentinfo\"]",
].join(",");

function readCandidate(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll(SKIP_SELECTOR).forEach((child) => child.remove());
  return normalizeText((clone as HTMLElement).innerText || clone.textContent || "");
}

export function extractPageContext(documentObject: Document = document): PageContext {
  const candidates = [
    ...Array.from(documentObject.querySelectorAll("main, article, [role=\"main\"]")),
  ];
  const candidateText = candidates
    .map((element) => readCandidate(element))
    .sort((left, right) => right.length - left.length)[0] || "";
  const bodyText = documentObject.body ? readCandidate(documentObject.body) : "";
  const normalized = candidateText.length >= 160 ? candidateText : bodyText;
  const characters = Array.from(normalized);
  const retained = characters.slice(0, MAX_PAGE_CONTEXT_CHARS).join("");

  return {
    title: normalizeText(documentObject.title).slice(0, 240) || "目前網頁",
    url: safePageUrl(documentObject.location?.href),
    text: retained,
    originalChars: characters.length,
    retainedChars: Array.from(retained).length,
    truncated: characters.length > MAX_PAGE_CONTEXT_CHARS,
  };
}
