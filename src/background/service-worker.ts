const SETTINGS_KEY = "pageAskVrmSettings";
const AUTO_INJECT_ORIGINS = ["http://*/*", "https://*/*"];

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setTitle({ title: "顯示或關閉 PageAsk VRM Avatar" }).catch(() => {});
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content-bridge.js"],
    });
  } catch (error) {
    console.warn("PageAsk VRM 無法注入目前頁面：", error);
  }
});

chrome.tabs?.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;

  try {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    if (stored[SETTINGS_KEY]?.autoInject !== true) return;
    if (!await chrome.permissions.contains({ origins: AUTO_INJECT_ORIGINS })) return;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-bridge.js"],
    });
  } catch (error) {
    console.warn("PageAsk VRM 無法自動注入目前頁面：", error);
  }
});
