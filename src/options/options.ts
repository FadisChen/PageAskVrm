import "./options.css";
import { AUTO_INJECT_ORIGINS, cleanSettings, loadSettings, saveSettings, VOICES } from "../shared/settings";
import { clearKnowledge, loadKnowledge, saveKnowledgeFile } from "../shared/knowledge";

const form = document.querySelector<HTMLFormElement>("#settingsForm")!;
const apiKey = document.querySelector<HTMLInputElement>("#apiKey")!;
const voiceName = document.querySelector<HTMLSelectElement>("#voiceName")!;
const showText = document.querySelector<HTMLInputElement>("#showText")!;
const autoInject = document.querySelector<HTMLInputElement>("#autoInject")!;
const showInput = document.querySelector<HTMLInputElement>("#showInput")!;
const knowledgeFile = document.querySelector<HTMLInputElement>("#knowledgeFile")!;
const knowledgeStatus = document.querySelector<HTMLElement>("#knowledgeStatus")!;
const clearKnowledgeButton = document.querySelector<HTMLButtonElement>("#clearKnowledge")!;
const saveStatus = document.querySelector<HTMLElement>("#saveStatus")!;

for (const voice of VOICES) {
  const option = document.createElement("option");
  option.value = voice;
  option.textContent = voice;
  voiceName.appendChild(option);
}

const settings = await loadSettings();
const knowledge = await loadKnowledge();
const autoInjectPermission = await chrome.permissions.contains({ origins: AUTO_INJECT_ORIGINS });
apiKey.value = settings.apiKey;
voiceName.value = settings.voiceName;
showText.checked = settings.showText;
autoInject.checked = settings.autoInject && autoInjectPermission;
showInput.checked = settings.showInput;
renderKnowledgeStatus(knowledge);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (autoInject.checked) {
    const granted = await chrome.permissions.request({ origins: AUTO_INJECT_ORIGINS });
    if (!granted) {
      autoInject.checked = false;
      saveStatus.textContent = "未取得網站存取權，自動注入未啟用。";
      return;
    }
  }

  const next = await saveSettings({
    ...cleanSettings(settings),
    apiKey: apiKey.value,
    voiceName: voiceName.value,
    showText: showText.checked,
    autoInject: autoInject.checked,
    showInput: showInput.checked,
  });
  settings.apiKey = next.apiKey;
  settings.voiceName = next.voiceName;
  settings.showText = next.showText;
  settings.autoInject = next.autoInject;
  settings.showInput = next.showInput;
  saveStatus.textContent = "設定已儲存。";
  window.setTimeout(() => { saveStatus.textContent = ""; }, 3500);
});

knowledgeFile.addEventListener("change", async () => {
  const file = knowledgeFile.files?.[0];
  if (!file) return;
  try {
    const document = await saveKnowledgeFile(file);
    renderKnowledgeStatus(document);
    saveStatus.textContent = "知識庫已匯入。";
  } catch (error) {
    saveStatus.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    knowledgeFile.value = "";
  }
});

clearKnowledgeButton.addEventListener("click", async () => {
  await clearKnowledge();
  renderKnowledgeStatus(null);
  saveStatus.textContent = "知識庫已清除。";
});

function renderKnowledgeStatus(document: { fileName: string; retainedChars: number; truncated: boolean } | null): void {
  if (!document) {
    knowledgeStatus.textContent = "尚未匯入知識庫。";
    clearKnowledgeButton.disabled = true;
    return;
  }
  knowledgeStatus.textContent = `${document.fileName} · ${document.retainedChars.toLocaleString()} 字元${document.truncated ? "（已截斷）" : ""}`;
  clearKnowledgeButton.disabled = false;
}
