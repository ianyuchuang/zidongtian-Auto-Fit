// LLM API 供應商定義（純資料，不打網路）。每家一筆：
//   id / label / model（預設型號）/ keyHint（金鑰長相）/ apply（申請金鑰頁）/ guide（官方教學）
//   steps（入口頁「申請教學」彈窗的步驟）/ billing（付費方式）/ price（型號價格）/ available（辨識已接上）
// 型號與價格依 2026-09 官方文件，摘要在 docs/LLM-API.md；改型號只要改這裡。

export const PROVIDERS = [
  {
    id: 'claude',
    label: 'Claude（Anthropic）',
    model: 'claude-haiku-4-5-20251001',
    keyHint: 'sk-ant-api03-…',
    apply: 'https://platform.claude.com/',
    guide: 'https://platform.claude.com/docs/en/get-started',
    steps: [
      '開啟 platform.claude.com，用 Google 或 Email 註冊／登入（這是「Console」，和 claude.ai 聊天帳號分開計費）。',
      '左側「Billing」→「Add credits」儲值（預付，最低約 US$5；建議順手設每月上限 Spend limit）。',
      '左側「API Keys」→「Create Key」→ 取個名字（例：autofit）→ Create。',
      '金鑰 sk-ant-api03-… 只會顯示這一次，立刻複製、貼到下面的輸入格，再按「測試連線」。',
    ],
    billing: 'Claude Pro／Max 月費不含 API，要在 Console 另外儲值。',
    price: 'Haiku 4.5：輸入 $1／輸出 $5（每百萬 token），一張照片約 NT$0.05–0.1。',
    available: true,
  },
  {
    id: 'gemini',
    label: 'Gemini（Google）',
    model: 'gemini-3.7-flash',
    keyHint: 'AIza…',
    apply: 'https://aistudio.google.com/apikey',
    guide: 'https://ai.google.dev/gemini-api/docs/api-key',
    steps: [
      '開啟 aistudio.google.com/apikey，用 Google 帳號登入，同意服務條款。',
      '按「Create API key」（第一次會自動建立一個 Google Cloud 專案）。',
      '複製 AIza… 開頭的金鑰，貼到下面的輸入格，再按「測試連線」。',
      '免費額度有每分鐘／每日次數限制；要一次跑很多張，到 Google Cloud 對該專案「Set up billing」開付費即可。',
    ],
    billing: '有免費額度（限速），不綁月費也能先試。',
    price: 'Gemini 3.7 Flash：輸入 $0.75／輸出 $3.75（每百萬 token，2026 年內優惠價），一張照片約 NT$0.05。',
    available: true,
  },
  {
    id: 'openai',
    label: 'GPT（OpenAI）',
    model: 'gpt-5.6-terra',
    keyHint: 'sk-…',
    apply: 'https://platform.openai.com/api-keys',
    guide: 'https://developers.openai.com/api/docs/quickstart',
    steps: [
      '開啟 platform.openai.com 註冊／登入（這是開發者平台，和 ChatGPT Plus 月費分開計費）。',
      '右上 Settings →「Billing」→ Add payment details，儲值（預付）。',
      '左側「API keys」→「Create new secret key」→ 取個名字 → Create secret key。',
      '金鑰 sk-… 只會顯示這一次，立刻複製、貼到下面的輸入格，再按「測試連線」。',
    ],
    billing: 'ChatGPT Plus 月費不含 API，要在開發者平台另外儲值。',
    price: 'GPT-5.6 terra：輸入 $1／輸出 $6（每百萬 token），一張照片約 NT$0.05–0.1。',
    available: true,
  },
  {
    id: 'grok',
    label: 'Grok（xAI）',
    model: '',
    keyHint: 'xai-…',
    apply: 'https://console.x.ai/',
    guide: 'https://docs.x.ai/developers/quickstart',
    steps: [
      '開啟 console.x.ai，用 X 或 Google 帳號登入。',
      '建立 Team →「Billing」儲值（預付）。',
      '「API Keys」→「Create API key」→ 複製 xai-… 開頭的金鑰。',
    ],
    billing: 'xAI 為 OpenAI 相容格式；本工具的辨識尚未接上這家。',
    price: '',
    available: false,
    note: '待接',
  },
];

export function getProvider(id) {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`沒有這家 LLM API：${id}`);
  return p;
}
