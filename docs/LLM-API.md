# LLM API（個人金鑰）— 申請與使用

頂列「🤖 AI 辨識」→「辨識方式」選 **LLM API** → 選一家 → 貼金鑰 →「測試連線」→ **從清單挑型號** → 開始辨識。照片會縮到 1500px 後送到該公司伺服器（需求 1 的例外，介面有標示）。
程式：`web/js/recognizer/api.js`（辨識器）、`api/providers.js`（四家定義與申請教學）、`api/call.js`（HTTP、列型號）、`api/keys.js`（金鑰／型號／Workspace ID 存 localStorage `autofit:v1:api-keys`）、`api/prompt.js`（提示詞與 JSON 解析）。

## 四家申請方式（2026-09 官方文件）

| 家 | 申請金鑰 | 步驟 | 預設型號 | 價格（每百萬 token 輸入／輸出） | 月費方案可否共用 |
|---|---|---|---|---|---|
| Claude | https://platform.claude.com/ | 登入 → API Keys → Create Key → 複製 `sk-ant-api03-…`（只顯示一次）→ Billing 儲值 | `claude-haiku-4-5-20251001` | $1／$5 | 否，Pro/Max 不含 API，要另外儲值 |
| Gemini | https://aistudio.google.com/apikey | Google 帳號登入 → 同意條款 → 自動建專案與金鑰 `AIza…` | `gemini-3.7-flash` | $0.75／$3.75（2026 年內優惠價） | 有免費額度（限速），可先免費試 |
| GPT | https://platform.openai.com/api-keys | 登入 → Create new secret key `sk-…` → Billing 儲值 | `gpt-5.6-terra` | $1／$6 | 否，ChatGPT Plus 不含 API |
| Grok | https://console.x.ai/ | （辨識尚未接上；xAI 是 OpenAI 相容格式，接法同 GPT） | — | — | — |

一張照片約 1,600–2,000 token → 三家都約 **NT$0.05–0.1／張**。

## 瀏覽器直打的要點
- 網頁沒有後端，用 `fetch` 直接呼叫各家端點。Claude 必須多帶 header `anthropic-dangerous-direct-browser-access: true`，否則被 CORS 擋；Gemini（`x-goog-api-key`）與 OpenAI（`Authorization: Bearer`）原生允許。
- 回覆要求純 JSON `{desc, design, actual, confidence, bbox}`；`parseResult` 會剝掉 markdown 圍欄、三欄全空就報錯（不會靜靜填空值）。
- 金鑰只存在使用者自己的瀏覽器；勾「不要記住金鑰」則不落地。請在各家主控台設用量上限。

## 換引擎重開同一個資料夾
校對暫存每筆 AI 結果都記 `engine`；引擎不同（例：先用模擬辨識、再用 Claude）時，未確認的 AI 結果不套回、重新辨識；已確認的保留。同引擎重開沿用暫存，不重複花錢。頂列 🤖 pill 顯示這次用的引擎與型號；辨識失敗會彈出彙整提示，檢視器顯示各張原因。

## 型號清單（不寫死）
按「測試連線」時 `listModels()` 先向該公司要清單，再用選到的型號試打一次；型號下拉只列這份清單。

| 家 | 列型號端點 | 挑選規則 |
|---|---|---|
| Claude | `GET /v1/models?limit=1000` | 全部都能看圖，直接列 |
| Gemini | `GET /v1beta/models?pageSize=1000` | 只有 `supportedGenerationMethods` 含 `generateContent` 的算可用 |
| GPT | `GET /v1/models` | 這個端點連向量／語音／繪圖型號都列，用型號名稱篩掉 |

不能看圖的型號預設收起來，勾「連不能看圖的型號也列出來」才顯示（篩錯了還挑得到，不會被卡死）。選好的型號記在 localStorage，下次開對話框直接帶回來，不必每次重測。`providers.js` 的 `model` 只是「清單抓回來時預設選哪個」與抓不到時的後備，不是寫死的唯一選擇。

## Claude 公司／團隊帳號：Workspace ID
公司帳號發的「識別碼型金鑰」（personal / service account key）每次請求都要帶 header `anthropic-workspace-id`，否則：

```
HTTP 400：anthropic-workspace-id is required when authenticating with an identity-linked API key
```

對話框在 Claude 金鑰下面有「Workspace ID」欄（選填，個人金鑰免填）：**Claude Console → Settings → Workspaces → ID 欄**，長得像 `wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ`。收到這個 400 時錯誤訊息會直接指路並把游標送到該欄。欄位定義在 `providers.js` 的 `extraFields`（其他家要加額外欄位照這個加）。
