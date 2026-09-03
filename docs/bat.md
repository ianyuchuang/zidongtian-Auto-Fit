# 五個 .bat（放在 repo 上一層 `D:\自懂填-Auto-Fit\`）

原始檔在 repo 內 `tools/bat/`（才會進 git、進備份）；上一層那幾個是複本，
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

所以 .bat 一律只放 ASCII：
- 中文說明搬到這份文件；
- 中文執行訊息由 Python 印（`tools/*.py` 是 UTF-8，沒有這個問題）；
- 中文資料夾路徑不寫進 .bat：repo 位置由 `_repo.cmd` 用 `*-V2.0` 在執行時找，
  範例照片資料夾預設值寫在 `tools/dev_server.py`。

`tests/test_bat_files.py` 會擋下之後不小心加進去的非 ASCII 字元。

## 各自做什麼

| 檔案 | 做的事 |
| --- | --- |
| `0_開通防火牆(只做一次).bat` | `tools/open_firewall.py`：自己跳 UAC 提權，加一條只開**私人網路** TCP 8765 的防火牆規則（`AutoFit-LAN-8765`），並印出內網 IP。開內網測試前做一次就好；`--remove` 可收回。 |
| `1_備份至Google雲端.bat` | `tools/backup_to_drive.py`：把 repo（含 `.git`）和上一層 `需求及資訊來源\` 打包成 zip，放 `%USERPROFILE%\.autofit\backups\`（只留最近 7 份），上傳雲端資料夾「自懂填-Auto-Fit 備份」。雲端舊備份不自動刪。第一次要先把 OAuth 的 `credentials.json` 放到 `%USERPROFILE%\.autofit\`，執行時會開瀏覽器授權一次。 |
| `2_推至GitHub.bat` | `tools/push_to_github.py`：pytest → `git add -A` → commit（會問說明）→ `git push origin main`。測試沒過就停，不推。 |
| `3_開啟網頁(localhost).bat` | `tools/dev_server.py`：把 `web/` 掛在 http://localhost:8765/ 並開瀏覽器（要 Chrome / Edge 才能讀寫資料夾），範例資料夾掛成「載入範例」。照片只在瀏覽器本地處理。只有這台電腦連得到。 |
| `4_架設到內網.bat` | 同上但加 `--lan`（綁 `0.0.0.0`），同事用 `http://<你的IP>:8765/` 連得到。同事的 Chrome 要先設一次旗標，否則只能唯讀 —— 步驟、防火牆與注意事項見 `docs/內網測試.md`。 |

## 缺套件

這些腳本用到的套件都在 `tools/requirements-tools.txt`（pytest、pillow、Google API）。
缺的時候腳本會問要不要現在裝；也可以自己開命令視窗跑：

```
cd /d D:\自懂填-Auto-Fit\自懂填-Auto-Fit-V2.0
python -m pip install -r tools\requirements-tools.txt
```

## 第一次備份：Google 授權與雲端資料夾

需要 `%USERPROFILE%\.autofit\credentials.json`（OAuth「桌面應用程式」用戶端）。
**目前沿用施工儀錶板那組**，把它的 `credentials.json` 複製到 `C:\Users\<你>\.autofit\` 就好；
第一次執行會開瀏覽器授權一次（同意畫面顯示的是那支 app 的名稱，出現「Google 尚未驗證
這個應用程式」→「進階」→「繼續」），之後授權存在 `.autofit\token.json`，不用再授權。

### 雲端資料夾為什麼要讓程式自己建

授權範圍只有 `drive.file`：程式只碰**自己建立或上傳**的檔案，看不到雲端硬碟其他東西
（安全，也不必送 Google 審核）。代價是**不能**直接指定一個你手動建的資料夾，
那樣 API 會回 404。

所以第一次備份時程式會自己建「自懂填-Auto-Fit 備份」，並把資料夾 id 記在
`%USERPROFILE%\.autofit\drive_folder_id.txt`。**建好之後你可以在雲端硬碟把它拖到任何位置、
改任何名字**，程式認的是 id，照樣上傳到同一個資料夾。要放進哪個資料夾底下，拖進去就好。

（`drive_folder_id.txt` 刪掉的話，程式會用名稱重找，找不到就再建一個新的。）

### 其他

- 授權過期或想換帳號：刪掉 `%USERPROFILE%\.autofit\token.json` 再跑一次。
- 目前用的是專案 `zidongtian-auto-fit-507411`（用戶端 `175497191106-…`），已發布成正式版。
  同名的另一個專案 `zidongtian-auto-fit`（管理專案，用戶端 `680638242094-…`）沒在用。
- 那支 app 若還停在 Google Auth 平台的「測試中」，授權**七天就過期**、而且只有測試使用者能授權
  （否則 403 access_denied）；發布成正式版可以根治，`drive.file` 是非敏感範圍，發布不需要審核。
- 要自己另建一組用戶端時：Google Cloud Console 建專案 → 啟用 `Google Drive API` →
  「Google Auth 平台」→「品牌」頁：應用程式名稱、使用者支援電子郵件、開發人員聯絡電子郵件，
  **加上「應用程式首頁」與「隱私權政策連結」**（這兩格沒標必填，但不填「發布應用程式」會是灰的，
  滑鼠停在按鈕上才會告訴你；隨便指到自己的 GitHub 頁面即可），填了網址就要在「授權網域」加該網域
  （例如 `github.com`）→ 儲存 →「目標對象」使用者類型外部、按「發布應用程式」→ 確認，狀態變「實際運作中」
  →「用戶端」建「桌面應用程式」→ 下載 JSON 改名成 `credentials.json`。
- Drive API 是**每個專案各自**要啟用的；換專案就要再開一次，沒開會在打包後上傳時才 403
  `accessNotConfigured`（現在腳本會在打包前先檢查）。
- 專案很容易建到兩個同名的：發布前對照 bat 印出的「用戶端：專案 …」，或用帶
  `?project=<專案ID>` 的 Console 網址操作，別靠左上角的名稱。
