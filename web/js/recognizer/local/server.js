// 本機模型伺服器（llama.cpp 的 llama-server）的 HTTP 呼叫。OpenAI 相容端點，不需要金鑰。
// 照片只在 127.0.0.1 之間流動，不會離開這台電腦——機密照片走這條（需求 1）。
// 伺服器要自己先啟動（例：D:\Qwen3.8-27B\start.bat，要有 --mmproj 才看得懂圖）；
// 沒開就是連線失敗，這裡把訊息講清楚，不要讓使用者對著空白畫面猜。
// 型號一律向伺服器要（/v1/models），不寫死；做法與 api/call.js 一致。

export const DEFAULT_BASE_URL = 'http://127.0.0.1:8080';
// 本機大模型一張照片可能要跑好幾分鐘（27B 在單張顯卡上約 3–10 tokens/秒），逾時要放得比雲端寬。
export const DEFAULT_TIMEOUT_MS = 600000;
export const PROBE_TIMEOUT_MS = 30000;

/** 使用者可能打成 "127.0.0.1:8080" 或結尾多一條斜線，統一成 "http://127.0.0.1:8080"。 */
export function normalizeBaseUrl(url) {
  const s = String(url ?? '').trim();
  if (!s) return DEFAULT_BASE_URL;
  const withScheme = /^https?:\/\//i.test(s) ? s : `http://${s}`;
  return withScheme.replace(/\/+$/, '');
}

/** 連不上就是伺服器沒開——把「怎麼開」直接寫進錯誤訊息裡。 */
function offlineMessage(baseUrl, detail) {
  return `連不上本機模型伺服器 ${baseUrl}（${detail}）。請先啟動 llama-server（例：D:\\Qwen3.8-27B\\start.bat），視窗要一直開著。`;
}

async function send(baseUrl, path, { body = null, fetchFn, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const f = fetchFn || globalThis.fetch;
  const url = `${baseUrl}${path}`;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let resp;
  try {
    resp = await f(url, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: ctrl?.signal,
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error(`本機模型逾時沒有回應（超過 ${Math.round(timeoutMs / 1000)} 秒）：模型可能還在算，或伺服器卡住了。`);
    throw new Error(offlineMessage(baseUrl, e.message));
  }
  // 逾時要涵蓋讀 body：llama-server 常常 headers 先回、正文要等模型算完，timer 讀完 body 才清。
  let raw;
  try {
    raw = await resp.text();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`本機模型逾時沒有回應（超過 ${Math.round(timeoutMs / 1000)} 秒，讀取回應內容時逾時）：模型可能還在算，或伺服器卡住了。`);
    throw new Error(`本機模型讀取回應失敗：${e.message}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }
  if (!resp.ok) {
    const m = json?.error?.message || (typeof json?.error === 'string' ? json.error : '') || raw.slice(0, 200);
    throw new Error(`本機模型 HTTP ${resp.status}${m ? `：${m}` : ''}`);
  }
  if (!json) throw new Error(`本機模型回應不是 JSON：${raw.slice(0, 200)}`);
  return json;
}

/** 問伺服器現在載了哪些模型。回傳 [{ id, label, usable }]（本機只會載自己指定的那個，通常一筆）。 */
export async function listLocalModels({ baseUrl = DEFAULT_BASE_URL, fetchFn, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const base = normalizeBaseUrl(baseUrl);
  const json = await send(base, '/v1/models', { fetchFn, timeoutMs });
  const models = (json.data || []).map((m) => ({ id: String(m.id ?? ''), label: String(m.id ?? ''), usable: true })).filter((m) => m.id);
  if (!models.length) throw new Error('伺服器沒有回報任何模型：llama-server 可能還在載入模型，等一下再按一次。');
  return models;
}

/**
 * 送一次對話，回傳模型輸出的純文字。
 * image：{ data: base64 字串, mimeType } 或 null（純文字，測試連線用）。
 */
export async function localChat({ baseUrl = DEFAULT_BASE_URL, model, text, image = null, maxTokens = 2048, fetchFn, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const base = normalizeBaseUrl(baseUrl);
  if (!model) throw new Error('沒有指定本機模型的型號（請先按「測試連線」）');
  const content = [{ type: 'text', text }];
  if (image) content.push({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } });
  const json = await send(base, '/v1/chat/completions', {
    body: { model, messages: [{ role: 'user', content }], max_tokens: maxTokens, temperature: 0, stream: false },
    fetchFn,
    timeoutMs,
  });
  const c = json.choices?.[0]?.message?.content;
  const out = typeof c === 'string' ? c : '';
  if (!out) {
    // 思考型模型（Qwen3 thinking）把 max_tokens 花在思考上，正文會是空的
    if (json.choices?.[0]?.finish_reason === 'length') throw new Error(`本機模型輸出 token 用完（推理型模型會把額度花在思考上），請換型號或提高上限：${JSON.stringify(json).slice(0, 300)}`);
    throw new Error(`本機模型回應裡沒有文字：${JSON.stringify(json).slice(0, 300)}`);
  }
  return out;
}

/** 測試連線：送一句話，回得出東西就算通。 */
export async function testLocalConnection({ baseUrl = DEFAULT_BASE_URL, model, fetchFn, timeoutMs = PROBE_TIMEOUT_MS }) {
  return localChat({ baseUrl, model, text: '請只回覆「OK」兩個字母。', maxTokens: 64, fetchFn, timeoutMs });
}
