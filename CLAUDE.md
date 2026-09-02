# 工作規則 — 自檢表照片製作工具

## 全域規則

1. 先規劃再執行；不確定先問，不要自己假設。
2. 不可逆或代價高的動作，動手前先確認。
3. 程式各功能區塊分開，能個別維護、個別執行；一格壞掉不拖垮整體。
4. .md 只留必要資訊，不要冗長。
5. 重複的內容只寫一處，其他地方指向它。
6. 出問題先查根本原因，不要憑推論改程式。
7. 寧可大聲失敗，不要靜靜算錯。

## Git（全域 + 本專案）

8. 每次改動代碼後，都必須建立一個對應的 commit（便於追蹤與回滾）。
9. commit 依主題分，重要修復獨立一個。
10. Claude 只 commit，push 由詠郁自己來（`2_推至GitHub.bat`）。

## 測試與交付（全域 + 本專案）

11. 每次改動後，都必須編寫或更新相關測試；修 bug 時補回歸測試。
12. 交付前所有測試與驗收必須全部通過；不交沒驗過的東西。

## 專案脈絡

- 需求：`docs/需求摘要.md`；介面定案（B+E 混合）：`docs/介面規格.md`，視覺稿 `docs/ui-BE-mockup.png`。
- 資料夾：本 repo＝`D:\自懂填-Auto-Fit\自懂填-Auto-Fit-V2.0`；需求文件、範例照片、V1.0 程式在上一層 `需求及資訊來源\`（不進 git，只進 Google 備份）。
- 可留用程式：`需求及資訊來源\自懂填Auto-Fit_V1.0_安裝包\app\self_check_core.py`（docx 排版、日期戳）。
- 備份與推送（bat 在上一層）：`1_備份至Google雲端.bat` → `tools/backup_to_drive.py`；`2_推至GitHub.bat` → pytest → commit → push（remote `ianyuchuang/zidongtian-Auto-Fit`）。
- 網頁（純前端，照片只在瀏覽器本地處理，可直接放 GitHub Pages）：`web/`，無建置步驟。
  - `js/app.js` 狀態與動作；`js/ui/` 入口頁 / 頂列 / 左樹 / 表格 / 檢視器；`js/fs/` 資料夾存取（File System Access API，`memory.js` 為唯讀複本）；`js/recognizer/` 辨識模組（目前只有 `mock`，本地模型 / API 待實驗）；`js/docx-export.js` + `docx-model.js` 依 V1.0 版面產 Word（`vendor/docx-*.iife.js`）。
  - 開本機測試：上一層 `3_開啟網頁(localhost).bat` → `tools/dev_server.py`（port 8765，掛範例資料夾成「載入範例」）。需 Chrome / Edge 才能讀寫資料夾。
  - 校對結果暫存在瀏覽器 localStorage（依根資料夾名），不寫進照片資料夾。
- 測試：`python -m pytest`（tests/；會一併跑 `node --test tests/js/*.test.mjs`，需 Node.js）。
- 待定：板型 docx 目前只記錄檔名、輸出仍用預設版面；低信心門檻暫 70%；每個資料夾各出一份 docx（同 V1.0）。
