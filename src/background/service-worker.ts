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
