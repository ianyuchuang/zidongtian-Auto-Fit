# 工作規則 — 自檢表照片製作工具

## 全域規則

1. 先規劃再執行；不確定先問，不要自己假設。
2. 不可逆或代價高的動作，動手前先確認。
3. 程式各功能區塊分開，能個別維護、個別執行；一格壞掉不拖垮整體。
4. .md 只留必要資訊，不要冗長。
5. 重複的內容只寫一處，其他地方指向它。
6. 出問題先查根本原因，不要憑推論改程式。
7. 寧可大聲失敗，不要靜靜算錯。
8. 資料目錄有變更過的話，先讀過一次資料目錄再給指令。

## Git（全域 + 本專案）

9. 每次改動代碼後，都必須建立一個對應的 commit（便於追蹤與回滾）。
10. commit 依主題分，重要修復獨立一個。
11. Claude 只 commit，push 由詠郁自己來（`2_推至GitHub.bat`）。

## 測試與交付（全域 + 本專案）

12. 每次改動後，都必須編寫或更新相關測試；修 bug 時補回歸測試。
13. 交付前所有測試與驗收必須全部通過；不交沒驗過的東西。

## 專案脈絡

- 需求：`docs/需求摘要.md`；介面定案（B+E 混合）：`docs/介面規格.md`，視覺稿 `docs/ui-BE-mockup.png`。
- 資料夾：本 repo＝`D:\自懂填-Auto-Fit\自懂填-Auto-Fit-V2.0`；需求文件、範例照片、V1.0 程式在上一層 `需求及資訊來源\`（不進 git，只進 Google 備份）。
- 可留用程式：`需求及資訊來源\自懂填Auto-Fit_V1.0_安裝包\app\self_check_core.py`（docx 排版、日期戳）。
- 三個 .bat 放在上一層，原始檔在 `tools/bat/`（改完要複製過去）；**內容只能是 ASCII**，中文訊息一律由 Python 印，原因與用法見 `docs/bat.md`。備份 → `tools/backup_to_drive.py`；推送 → `tools/push_to_github.py`（pytest → commit → push，remote `ianyuchuang/zidongtian-Auto-Fit`）；開網頁 → `tools/dev_server.py`。
- 網頁（純前端，照片只在瀏覽器本地處理，可直接放 GitHub Pages）：`web/`，無建置步驟。
  - `js/app.js` 狀態與動作；`js/ui/` 入口頁 / 頂列 / 左樹 / 表格 / 檢視器（`dnd.js` 為表格與左樹共用的拖曳格式與提示）；`js/fs/` 資料夾存取（File System Access API，`memory.js` 為唯讀複本）；`js/recognizer/` 辨識模組（`mock`；`api.js` + `api/` 為 LLM API 直打，四家定義與申請方式見 `docs/LLM-API.md`；本地模型待實驗）；`js/docx-export.js` + `docx-model.js` 依 V1.0 版面產 Word（`vendor/docx-*.iife.js`）。
  - 開本機測試：上一層 `3_開啟網頁(localhost).bat` → `tools/dev_server.py`（port 8765；範例資料夾預設值寫在 `dev_server.py` 的 `DEFAULT_SAMPLES`，掛成「載入範例」）。需 Chrome / Edge 才能讀寫資料夾。
  - 校對結果暫存在瀏覽器 localStorage（依根資料夾名），不寫進照片資料夾；每筆 AI 結果記 `engine`（`mock` / `api:claude`…），換引擎重開同資料夾時，未確認的 AI 結果會重跑、已確認與檔名解析保留（否則會一直看到模擬辨識的假資料）。
  - 「刪除」＝搬到根資料夾下 `_回收桶`（網頁無法用 Windows 資源回收桶），拖回即還原，產生 Word 時略過；瀏覽器拿不到完整磁碟路徑，入口頁只顯示資料夾名與子資料夾摘要。
- 測試：`python -m pytest`（tests/；會一併跑 `node --test tests/js/*.test.mjs`，需 Node.js）。
- 工具套件清單 `tools/requirements-tools.txt`（pytest + Google API）；缺的時候 `tools/deps.py` 會問要不要現在裝。
- 待定：板型 docx 目前只記錄檔名、輸出仍用預設版面；低信心門檻暫 70%；每個資料夾各出一份 docx（同 V1.0）。
