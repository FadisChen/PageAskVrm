export type Settings = {
  apiKey: string;
  voiceName: string;
  showText: boolean;
};

export const SETTINGS_KEY = "pageAskVrmSettings";
export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  voiceName: "Aoede",
  showText: false,
};

export const VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede",
  "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
  "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
] as const;

export function cleanSettings(value: unknown): Settings {
  const settings = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const voiceName = typeof settings.voiceName === "string" && VOICES.includes(settings.voiceName as typeof VOICES[number])
    ? settings.voiceName
    : DEFAULT_SETTINGS.voiceName;
  return {
    apiKey: typeof settings.apiKey === "string" ? settings.apiKey.trim() : "",
    voiceName,
    showText: settings.showText === true,
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return cleanSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(value: unknown): Promise<Settings> {
  const settings = cleanSettings(value);
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}
