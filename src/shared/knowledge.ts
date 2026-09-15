import { normalizeText } from "./messages";

export const KNOWLEDGE_KEY = "pageAskVrmKnowledge";
export const MAX_KNOWLEDGE_CHARS = 24_000;
export const SUPPORTED_KNOWLEDGE_EXTENSIONS = [".txt", ".md", ".markdown", ".json", ".csv", ".pdf"] as const;

export type KnowledgeDocument = {
  fileName: string;
  mimeType: string;
  text: string;
  originalChars: number;
  retainedChars: number;
  truncated: boolean;
  importedAt: number;
};

export function isSupportedKnowledgeFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return SUPPORTED_KNOWLEDGE_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

export async function saveKnowledgeFile(file: File): Promise<KnowledgeDocument> {
  if (!isSupportedKnowledgeFile(file)) {
    throw new Error("目前只支援 .txt、.md、.markdown、.json、.csv 或 .pdf 檔案。 ");
  }

  const rawText = file.name.toLowerCase().endsWith(".pdf")
    ? await extractPdfText(file)
    : await file.text();
  const normalized = normalizeText(rawText);
  if (!normalized) {
    throw new Error(file.name.toLowerCase().endsWith(".pdf")
      ? "PDF 沒有可擷取的文字；掃描影像型 PDF 目前需要先做 OCR。 "
      : "指定檔案沒有可讀取的文字內容。 ");
  }

  const characters = Array.from(normalized);
  const retainedText = characters.slice(0, MAX_KNOWLEDGE_CHARS).join("");
  const document: KnowledgeDocument = {
    fileName: file.name,
    mimeType: file.type || "text/plain",
    text: retainedText,
    originalChars: characters.length,
    retainedChars: Array.from(retainedText).length,
    truncated: characters.length > MAX_KNOWLEDGE_CHARS,
    importedAt: Date.now(),
  };

  await chrome.storage.local.set({ [KNOWLEDGE_KEY]: document });
  return document;
}

export function cleanKnowledge(value: unknown): KnowledgeDocument | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.fileName !== "string" || typeof item.text !== "string") return null;
  if (typeof item.mimeType !== "string" || typeof item.importedAt !== "number") return null;

  const text = normalizeText(item.text);
  if (!text) return null;
  const characters = Array.from(text).slice(0, MAX_KNOWLEDGE_CHARS);
  const retainedText = characters.join("");
  return {
    fileName: item.fileName.slice(0, 240),
    mimeType: item.mimeType.slice(0, 120),
    text: retainedText,
    originalChars: Number.isInteger(item.originalChars) ? item.originalChars as number : Array.from(text).length,
    retainedChars: characters.length,
    truncated: item.truncated === true || Array.from(text).length > MAX_KNOWLEDGE_CHARS,
    importedAt: item.importedAt,
  };
}

export async function loadKnowledge(): Promise<KnowledgeDocument | null> {
  const stored = await chrome.storage.local.get(KNOWLEDGE_KEY);
  return cleanKnowledge(stored[KNOWLEDGE_KEY]);
}

export async function clearKnowledge(): Promise<void> {
  await chrome.storage.local.remove(KNOWLEDGE_KEY);
}

async function extractPdfText(file: File): Promise<string> {
  const { extractPdfTextFromFile } = await import("./pdf-text");
  return extractPdfTextFromFile(file);
}
