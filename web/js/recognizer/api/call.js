// 各家 LLM API 的 HTTP 呼叫（瀏覽器 fetch 直打，沒有後端）。
// 每家做三件事：headers（認證）、request（把 { model, text, image } 組成 request）、models（列出可用型號）。
// image：{ data: base64 字串, mimeType } 或 null（純文字，測試連線用）。
// extra：該家的額外設定（目前只有 Claude 的 workspaceId），欄位定義在 providers.js 的 extraFields。

// 輸出 token 上限。推理型模型（GPT-5、Gemini Pro 有 thinking）會先把額度花在思考上，
// 給太少（64／2048）正文就是空的，只會看到「回應裡沒有文字」——所以放寬；實際用量照模型輸出算，不會多花錢。
// 不另外加 reasoning_effort／thinkingConfig 參數：非推理型號會拒絕整個請求。
export const TEST_MAX_TOKENS = 1024;
export const RECOGNIZE_MAX_TOKENS = 8192;
export const TRUNCATED_MESSAGE = '輸出 token 用完（推理型模型會把額度花在思考上），請換型號或提高上限';

const ADAPTERS = {
  // Claude：瀏覽器直打要多帶 anthropic-dangerous-direct-browser-access，否則被 CORS 擋。
  // 公司／團隊帳號的「識別碼型金鑰」還要帶 anthropic-workspace-id，否則 HTTP 400。
  claude: {
    headers({ apiKey, extra = {} }) {
      const h = {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
      if (extra.workspaceId) h['anthropic-workspace-id'] = extra.workspaceId;
      return h;
    },
    request({ model, text, image, maxTokens }) {
      const content = [];
      if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } });
      content.push({ type: 'text', text });
      return {
        url: 'https://api.anthropic.com/v1/messages',
        body: { model, max_tokens: maxTokens, messages: [{ role: 'user', content }] },
      };
    },
    text(json) {
      return (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    },
    truncated(json) {
      return json.stop_reason === 'max_tokens';
    },
    modelsUrl: 'https://api.anthropic.com/v1/models?limit=1000',
    models(json) {
      // /v1/models 只列對話型號，全部都看得懂圖
      return (json.data || []).map((m) => ({ id: m.id, label: m.display_name || m.id, usable: true }));
    },
  },

  gemini: {
    headers({ apiKey }) {
      return { 'x-goog-api-key': apiKey };
    },
    request({ model, text, image, maxTokens }) {
      const parts = [];
      if (image) parts.push({ inline_data: { mime_type: image.mimeType, data: image.data } });
      parts.push({ text });
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        body: { contents: [{ parts }], generationConfig: { maxOutputTokens: maxTokens, temperature: 0 } },
      };
    },
    text(json) {
      return (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    },
    truncated(json) {
      return json.candidates?.[0]?.finishReason === 'MAX_TOKENS';
    },
    modelsUrl: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
    models(json) {
      // 這個端點連向量、繪圖、語音型號一起列出來，只有支援 generateContent 的能拿來辨識
      const skip = /embedding|aqa|imagen|veo|tts|audio|image-generation|learnlm/i;
      return (json.models || []).map((m) => {
        const id = String(m.name || '').replace(/^models\//, '');
        return {
          id,
          label: m.displayName || id,
          usable: (m.supportedGenerationMethods || []).includes('generateContent') && !skip.test(id),
        };
      });
    },
  },

  openai: {
    headers({ apiKey }) {
      return { Authorization: `Bearer ${apiKey}` };
    },
    request({ model, text, image, maxTokens }) {
      const content = [{ type: 'text', text }];
      if (image) content.push({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } });
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        body: { model, messages: [{ role: 'user', content }], max_completion_tokens: maxTokens },
      };
    },
    text(json) {
      const c = json.choices?.[0]?.message?.content;
      return typeof c === 'string' ? c : '';
    },
    truncated(json) {
      return json.choices?.[0]?.finish_reason === 'length';
    },
    modelsUrl: 'https://api.openai.com/v1/models',
    models(json) {
      // /v1/models 把向量、語音、繪圖型號全列出來，挑得出圖看的對話型號才標可用
      const skip = /embedding|whisper|tts|audio|realtime|moderation|dall-e|image|transcribe|search|sora|davinci|babbage|codex/i;
      const chat = /^(gpt|o[0-9]|chatgpt)/i;
      return (json.data || []).map((m) => ({ id: m.id, label: m.id, usable: chat.test(m.id) && !skip.test(m.id) }));
    },
  },
};

export function hasAdapter(providerId) {
  return Boolean(ADAPTERS[providerId]);
}

function adapterOf(providerId) {
  const a = ADAPTERS[providerId];
  if (!a) throw new Error(`${providerId} 的 API 呼叫尚未接上`);
  return a;
}

/** 組 request（不送出），方便測試與除錯。 */
export function buildRequest(providerId, opts) {
  const a = adapterOf(providerId);
  if (!opts.apiKey) throw new Error('沒有 API 金鑰');
  if (!opts.model) throw new Error('沒有指定型號');
  const { url, body } = a.request({ maxTokens: 1024, ...opts });
  return { url, headers: a.headers(opts), body };
}

/** 從錯誤回應擠出可讀訊息（三家都是 error.message，格式略有不同）。 */
export function errorMessage(status, json, rawText = '') {
  const m = json?.error?.message || (typeof json?.error === 'string' ? json.error : '') || json?.message;
  const hint =
    status === 401 || status === 403
      ? '（金鑰錯誤或沒有權限）'
      : status === 429
        ? '（用量／額度超過，請到該公司主控台檢查餘額）'
        : /anthropic-workspace-id/i.test(m || '')
          ? '（這把是公司／團隊的識別碼型金鑰，請在下面填 Workspace ID：Claude Console → Settings → Workspaces 的 ID 欄，長得像 wrkspc_…）'
          : '';
  return `HTTP ${status}${hint}${m ? `：${m}` : rawText ? `：${rawText.slice(0, 200)}` : ''}`;
}

/** 送一個請求並把回應解析成 JSON；HTTP 錯誤、逾時、非 JSON 都大聲失敗。 */
async function sendJson(providerId, { url, headers, body, fetchFn, timeoutMs }) {
  const f = fetchFn || globalThis.fetch;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs ?? 90000) : null;
  let resp;
  try {
    resp = await f(url, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json', ...headers } : { ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: ctrl?.signal,
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    throw new Error(e.name === 'AbortError' ? `${providerId} 逾時沒有回應` : `${providerId} 連線失敗：${e.message}（網路不通或被 CORS 擋）`);
  }
  // 逾時要涵蓋讀 body：headers 先回來、正文卡住（推理型模型慢慢吐）時也要能斷掉，所以 timer 讀完 body 才清。
  let raw;
  try {
    raw = await resp.text();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? `${providerId} 逾時沒有回應（讀取回應內容時逾時）` : `${providerId} 讀取回應失敗：${e.message}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }
  if (!resp.ok) throw new Error(`${providerId} ${errorMessage(resp.status, json, raw)}`);
  if (!json) throw new Error(`${providerId} 回應不是 JSON：${raw.slice(0, 200)}`);
  return json;
}

/**
 * 呼叫 API，回傳模型輸出的純文字。
 * opts：{ apiKey, model, text, image, extra, maxTokens, fetchFn, timeoutMs }
 */
export async function callLLM(providerId, opts) {
  const a = adapterOf(providerId);
  const req = buildRequest(providerId, opts);
  const json = await sendJson(providerId, { ...req, fetchFn: opts.fetchFn, timeoutMs: opts.timeoutMs });
  const text = a.text(json);
  if (!text) {
    if (a.truncated?.(json)) throw new Error(`${providerId} ${TRUNCATED_MESSAGE}：${JSON.stringify(json).slice(0, 300)}`);
    throw new Error(`${providerId} 回應裡沒有文字：${JSON.stringify(json).slice(0, 300)}`);
  }
  return text;
}

/**
 * 問伺服器現在有哪些型號（型號不寫死在程式裡）。
 * 回傳 [{ id, label, usable }]，usable=false 是向量／語音／繪圖之類不能拿來看照片的。
 * 可用的排前面，其餘維持伺服器給的順序。
 */
export async function listModels(providerId, { apiKey, extra = {}, fetchFn, timeoutMs = 30000 } = {}) {
  const a = adapterOf(providerId);
  if (!apiKey) throw new Error('沒有 API 金鑰');
  const json = await sendJson(providerId, { url: a.modelsUrl, headers: a.headers({ apiKey, extra }), body: null, fetchFn, timeoutMs });
  const models = a.models(json).filter((m) => m.id);
  if (!models.length) throw new Error(`${providerId} 沒有回傳任何型號`);
  return [...models.filter((m) => m.usable), ...models.filter((m) => !m.usable)];
}

/** 測試連線：送一句話，模型回得出東西就算通。回傳模型回覆的文字。 */
export async function testConnection(providerId, { apiKey, model, extra = {}, fetchFn, timeoutMs = 30000 }) {
  return callLLM(providerId, { apiKey, model, extra, text: '請只回覆「OK」兩個字母。', maxTokens: TEST_MAX_TOKENS, fetchFn, timeoutMs });
}
