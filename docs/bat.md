# 三個 .bat（放在 repo 上一層 `D:\自懂填-Auto-Fit\`）

原始檔在 repo 內 `tools/bat/`（才會進 git、進備份）；上一層那三個是複本，
改完要一起複製過去。

## 為什麼 .bat 裡不能有中文

cmd.exe 執行批次檔時是「跑一行 → 記住位元組位置 → 再開檔案接著讀」。
在 `chcp 65001`（UTF-8）之下，遇到中文（多位元組）它會把位置算錯，
接下來就從一行的中間開始讀，把註解或訊息的後半段當成指令執行，
於是出現這種錯誤：

```
'0\' is not recognized as an internal or external command
'裝包（不進' is not recognized as an internal or external command
```

所以三個 .bat 一律只放 ASCII：
- 中文說明搬到這份文件；
- 中文執行訊息由 Python 印（`tools/*.py` 是 UTF-8，沒有這個問題）；
- 中文資料夾路徑不寫進 .bat：repo 位置由 `_repo.cmd` 用 `*-V2.0` 在執行時找，
  範例照片資料夾預設值寫在 `tools/dev_server.py`。

`tests/test_bat_files.py` 會擋下之後不小心加進去的非 ASCII 字元。

## 各自做什麼

| 檔案 | 做的事 |
| --- | --- |
| `1_備份至Google雲端.bat` | `tools/backup_to_drive.py`：把 repo（含 `.git`）和上一層 `需求及資訊來源\` 打包成 zip，放 `%USERPROFILE%\.autofit\backups\`（只留最近 7 份），上傳雲端資料夾「自懂填-Auto-Fit 備份」。雲端舊備份不自動刪。第一次要先把 OAuth 的 `credentials.json` 放到 `%USERPROFILE%\.autofit\`，執行時會開瀏覽器授權一次。 |
| `2_推至GitHub.bat` | `tools/push_to_github.py`：pytest → `git add -A` → commit（會問說明）→ `git push origin main`。測試沒過就停，不推。 |
| `3_開啟網頁(localhost).bat` | `tools/dev_server.py`：把 `web/` 掛在 http://localhost:8765/ 並開瀏覽器（要 Chrome / Edge 才能讀寫資料夾），範例資料夾掛成「載入範例」。照片只在瀏覽器本地處理。 |

## 缺套件

三個腳本用到的套件都在 `tools/requirements-tools.txt`（pytest、pillow、Google API）。
缺的時候腳本會問要不要現在裝；也可以自己開命令視窗跑：

```
cd /d D:\自懂填-Auto-Fit\自懂填-Auto-Fit-V2.0
python -m pip install -r tools\requirements-tools.txt
```

## 第一次備份：申請 Google 授權檔（credentials.json）

備份用的是自己的 OAuth 用戶端，範圍只有 `drive.file`（只碰這支程式自己建立／上傳的檔案，
看不到雲端硬碟其他東西）。到 [Google Cloud Console](https://console.cloud.google.com/) 用要存
備份的那個 Google 帳號登入，然後：

1. **建專案**：左上角專案選單 →「新增專案」，名稱例如 `autofit-backup` → 建立，
   之後每一步都確認右上角選的是這個專案。
2. **開 Drive API**：「API 和服務」→「已啟用的 API 和服務」→「啟用 API 和服務」→
   搜尋 `Google Drive API` → 啟用。
3. **設定 Google Auth 平台**（第一次會要求）：左側「Google Auth 平台」→「開始使用」，
   填應用程式名稱（例如 `自懂填 Auto-Fit 備份`）與支援電子郵件；
   對象（Audience）選 **外部**；完成後在「對象」頁的**測試使用者**加入自己的 Gmail
   （不加的話授權時會被擋掉）。發布狀態留在「測試中」就好。
4. **建用戶端**：「Google Auth 平台」→「用戶端」→「建立用戶端」→
   應用程式類型選 **桌面應用程式** → 命名 → 建立 → 下載 JSON。
5. **放檔案**：把下載的檔案改名成 `credentials.json`，放到 `C:\Users\<你>\.autofit\`。
6. 再點一次 `1_備份至Google雲端.bat`：會開瀏覽器要你授權一次
   （出現「Google 尚未驗證這個應用程式」→「進階」→「繼續」，因為是自己建的用戶端），
   之後授權存在 `.autofit\token.json`，不用再授權。

授權過期或想換帳號：刪掉 `%USERPROFILE%\.autofit\token.json` 再跑一次。
