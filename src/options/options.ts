import "./options.css";
import { cleanSettings, loadSettings, saveSettings, VOICES } from "../shared/settings";

const form = document.querySelector<HTMLFormElement>("#settingsForm")!;
const apiKey = document.querySelector<HTMLInputElement>("#apiKey")!;
const voiceName = document.querySelector<HTMLSelectElement>("#voiceName")!;
const showText = document.querySelector<HTMLInputElement>("#showText")!;
const saveStatus = document.querySelector<HTMLElement>("#saveStatus")!;

for (const voice of VOICES) {
  const option = document.createElement("option");
  option.value = voice;
  option.textContent = voice;
  voiceName.appendChild(option);
}

const settings = await loadSettings();
apiKey.value = settings.apiKey;
voiceName.value = settings.voiceName;
showText.checked = settings.showText;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const next = await saveSettings({
    ...cleanSettings(settings),
    apiKey: apiKey.value,
    voiceName: voiceName.value,
    showText: showText.checked,
  });
  settings.apiKey = next.apiKey;
  settings.voiceName = next.voiceName;
  settings.showText = next.showText;
  saveStatus.textContent = "設定已儲存。";
  window.setTimeout(() => { saveStatus.textContent = ""; }, 3500);
});
