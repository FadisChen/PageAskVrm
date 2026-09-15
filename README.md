# PageAsk VRM

PageAsk VRM 是一個 Chrome Manifest V3 Extension MVP：點擊工具列圖示後，會在目前網頁右下角注入透明的 `sha.vrm` Avatar。也可以在設定中啟用跨頁自動注入，或匯入 TXT、Markdown、JSON、CSV、PDF 作為指定知識庫。Avatar 可以使用 Gemini Live 進行語音對談，依回覆觸發情緒、動作與 lip sync；輸出文字可在設定中切換為 Avatar 上方的漫畫風格對白框。

## 開發環境

- Node.js 20+
- Chrome 116+
- Gemini API key（BYOK）

## 安裝與打包

```powershell
npm install
npm run check
npm test
npm run build
```

1. 開啟 `chrome://extensions/`。
2. 開啟「開發人員模式」。
3. 選擇「載入未封裝項目」，指定 `D:\SideProject\PageAskVrm\dist`。
4. 開啟 Extension 的「詳細資料」並進入設定頁。
5. 在設定頁填入你自己的 Gemini API key（BYOK）。
6. 如需跨頁自動出現，勾選「跨頁自動注入」並儲存，接受 Chrome 的網站存取權請求。
7. 如需指定知識庫，在「指定本機知識庫」選取 TXT、Markdown、JSON、CSV 或 PDF 檔案。
8. 開啟一般 HTTPS 網頁，點擊工具列的 PageAsk VRM 圖示（未啟用自動注入時）。
9. 點擊 Avatar 取得麥克風權限並開始對談。

每次重新 build 後，請在 `chrome://extensions/` 對 PageAsk VRM 按「重新載入」，再重新整理目前網頁；content bridge 是透過 `chrome.scripting.executeScript` 注入，因此 build 後會特別輸出為 classic script，不能直接執行 source 目錄內的 TypeScript/ESM 檔案。

## BYOK 使用方式

本 Extension 只支援 BYOK（Bring Your Own Key）。請在設定頁輸入自己的 Gemini API key；金鑰會以未加密形式保存在此 Chrome 使用者設定檔，並由 Extension 直接連線至 Google Gemini。

## 使用限制

- 頁面內容會在 Avatar 啟用時擷取一次，最多送出 24,000 字元；SPA URL 變更時會結束目前 session。
- 自動注入只適用一般 HTTP／HTTPS 網頁；Chrome 內建頁面、Chrome Web Store 與部分 PDF viewer 不允許注入。
- 匯入的知識庫最多保留 24,000 字元，PDF 會抽取文字；掃描影像型 PDF 目前不支援 OCR。
- `chrome://`、Chrome Web Store 等瀏覽器內建頁面不允許注入 content script。
- Gemini API 的使用量與費用依你的 Google AI 帳戶設定與配額計算。
- `sha.vrm` 已隨 Extension 打包到 `dist/avatars/sha.vrm`，不依賴工作區外的相對路徑。
