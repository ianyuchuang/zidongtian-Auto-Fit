# LLM API（個人金鑰）— 申請與使用

入口頁「辨識方式」選 **LLM API** → 選一家 → 貼金鑰 → 「測試連線」。照片會縮到 1500px 後送到該公司伺服器（需求 1 的例外，介面有標示）。
程式：`web/js/recognizer/api.js`（辨識器）、`api/providers.js`（四家定義與預設型號）、`api/call.js`（HTTP）、`api/keys.js`（金鑰存 localStorage `autofit:v1:api-keys`）、`api/prompt.js`（提示詞與 JSON 解析）。

## 四家申請方式（2026-09 官方文件）

| 家 | 申請金鑰 | 步驟 | 預設型號 | 價格（每百萬 token 輸入／輸出） | 月費方案可否共用 |
|---|---|---|---|---|---|
| Claude | https://platform.claude.com/ | 登入 → API Keys → Create Key → 複製 `sk-ant-api03-…`（只顯示一次）→ Billing 儲值 | `claude-haiku-4-5` | $1／$5 | 否，Pro/Max 不含 API，要另外儲值 |
| Gemini | https://aistudio.google.com/apikey | Google 帳號登入 → 同意條款 → 自動建專案與金鑰 `AIza…` | `gemini-3.7-flash` | $0.75／$3.75（2026 年內優惠價） | 有免費額度（限速），可先免費試 |
| GPT | https://platform.openai.com/api-keys | 登入 → Create new secret key `sk-…` → Billing 儲值 | `gpt-5.6-terra` | $1／$6 | 否，ChatGPT Plus 不含 API |
| Grok | https://console.x.ai/ | （辨識尚未接上；xAI 是 OpenAI 相容格式，接法同 GPT） | — | — | — |

一張照片約 1,600–2,000 token → 三家都約 **NT$0.05–0.1／張**。

## 瀏覽器直打的要點
- 網頁沒有後端，用 `fetch` 直接呼叫各家端點。Claude 必須多帶 header `anthropic-dangerous-direct-browser-access: true`，否則被 CORS 擋；Gemini（`x-goog-api-key`）與 OpenAI（`Authorization: Bearer`）原生允許。
- 回覆要求純 JSON `{desc, design, actual, confidence, bbox}`；`parseResult` 會剝掉 markdown 圍欄、三欄全空就報錯（不會靜靜填空值）。
- 金鑰只存在使用者自己的瀏覽器；勾「不要記住金鑰」則不落地。請在各家主控台設用量上限。

## 換型號
改 `api/providers.js` 的 `model` 即可；`ctx.api.model` 也可個別覆蓋（目前介面沒開放）。
