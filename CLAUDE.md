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
  - `js/app.js` 狀態與動作；`js/ui/` 入口頁 / 頂列 / 左樹 / 表格 / 檢視器 / 燈箱（`dnd.js` 為表格與左樹共用的拖曳格式與提示；`recognize.js` 為頂列「AI 辨識」的設定對話框與進度）；`js/fs/` 資料夾存取（File System Access API，`memory.js` 為唯讀複本，`handle-store.js` 用 IndexedDB 記住上次的資料夾）；`js/recognizer/` 辨識模組（`mock`；`local.js` + `local/` 為本機 llama-server，照片不出這台電腦，見 `docs/本地模型.md`；`api.js` + `api/` 為 LLM API 直打，四家定義與申請方式見 `docs/LLM-API.md`）；`js/template/` 版型（`spec.js` LayoutSpec 與純邏輯、`parse.js` 解析 docx、`xml.js`、`unzip.js`、`library.js` 版型庫），見 `docs/版型.md`；`js/docx-export.js` 照 LayoutSpec 產 Word、`docx-model.js` 管分組與輸出前檢查（`vendor/docx-*.iife.js`）。
  - 開本機測試：上一層 `3_開啟網頁(localhost).bat` → `tools/dev_server.py`（port 8765；範例資料夾預設值寫在 `dev_server.py` 的 `DEFAULT_SAMPLES`，掛成「載入範例」）。需 Chrome / Edge 才能讀寫資料夾。
  - 辨識不在入口頁決定：讀取後照片是「待辨識」，由頂列「🤖 AI 辨識」選方式／提示詞／範圍才開跑（辨識期間**停在工作台**，只把欄位與篩選反灰鎖住並顯示進度，不換頁）。
  - LLM API 的型號不寫死：按「測試連線」時向該公司要清單（`api/call.js` 的 `listModels`）再讓使用者挑；預設挑哪個由 `providers.js` 的 `prefer` 關鍵字決定（Claude＝sonnet），Claude 公司帳號的識別碼型金鑰要填 Workspace ID（`extraFields`），見 `docs/LLM-API.md`。
  - **小型／快速型號讀不動這種手寫白板**（Haiku 12 張 0 對、Sonnet 9/12），低信心也不能只信模型自報的 confidence，實測與因應見 `docs/辨識實測-尺寸11F.md`。
  - 拖放檔案：`main.js` 在 window 上把 `dragover`／`drop` 的預設行為擋掉——沒接住的拖放會讓瀏覽器去開那個檔案，從 http://localhost 跳 file:// 被擋掉就變成一片空白（2026-09-04 的 bug）。入口頁整頁都接得住拖放，用 `ui/dnd.js` 的 `classifyDrop` 判斷是資料夾還是版型 docx。
  - 入口頁選到的資料夾與版型都存進 `app.state`（`pickRoot` / `state.template`）：拖版型 docx 會換到版型調整頁，入口頁被拆掉重掛，只放區域變數就會忘掉（2026-09-04 的 bug）；`state.rootSummary` 是掃過的子資料夾摘要，回入口頁不重掃，`goHome()` 會清掉（工作台可能搬過檔案）。
  - `emit('page')` 只給真的換頁用：`main.js` 會拆掉重掛整個頁面，工作台拆掉時 `history.back()` 會被新掛的 popstate 接到而彈回首頁（2026-09-03 的 bug）。同頁內的變化發自己的事件（例：`setRecognizer` 發 `engine`）。掛在共用 `#app` 容器或 `window` 上的監聽要用 `{ signal }` 綁、mount 回傳 unmount，否則每進一次頁就疊一套舊閉包（2026-09-04 版型頁「存成版型跳好幾個成功、用的是上一次的版型」）。
  - 校對結果暫存在瀏覽器 localStorage（依根資料夾名），不寫進照片資料夾；每筆 AI 結果記 `engine`（`mock` / `api:claude`…）。
  - 「刪除」＝搬進**該照片所在資料夾**自己的 `_回收桶`（網頁無法用 Windows 資源回收桶）；表格把它留在原位反灰、按「↩ 還原」搬回同一層，統計不含它、產生 Word 時略過。瀏覽器拿不到完整磁碟路徑，入口頁只顯示資料夾名與子資料夾摘要。
- 測試：`python -m pytest`（tests/；會一併跑 `node --test tests/js/*.test.mjs`，需 Node.js）。
- 工具套件清單 `tools/requirements-tools.txt`（pytest、pillow、Google API）；缺的時候 `tools/deps.py` 會問要不要現在裝。
  - 入口頁只做兩件事：選資料夾、選版型。檢查日期改在工作台表格的**資料夾列**上、資料夾名旁靠左填（每個資料夾各一個，預設今天，存 `autofit:v1:dates:<根資料夾名>`），docx 檔名／頁首日期／照片日期戳都用該資料夾的日期。
  - 版型：入口頁按「讀取版型」進**版型頁**（`ui/template-page.js`）——先「選版型」（列出存過的版型／預設版面／讀一份新的 docx），讀了 docx 才進「版型調整」，整頁所見即所得地調（抬頭與說明格直接點著打字——點格子空白處也接得到游標，Enter 分段、Shift+Enter 段落內換行；要填值的位置是可換欄位的「膠囊」，同一行可以放好幾個、中間夾自己打的逗號；欄位可從工具列拖進某一行或新增一行、也能拖到別格；拖曳格子換填照順序；格子上按右鍵可選水平／垂直對齊），「完成」會先存進版型庫（`autofit:v1:templates`）再回入口頁，並記住每個資料夾上次用哪一份。一次讀取只用一種版型。細節與三份樣本的差異見 `docs/版型.md`。
- 定案：「拍照日期」不讀 EXIF，版型有這欄一律填該資料夾的檢查日期（`rocDot()`＝`115.6.14`）。待定：每個資料夾各出一份 docx（同 V1.0）；**兩階段辨識（定位白板→裁切→再辨識）尚未實作**。
