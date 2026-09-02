// 各家 LLM API 的 HTTP 呼叫（瀏覽器 fetch 直打，沒有後端）。
// 每家只做兩件事：把 { model, apiKey, text, image } 組成 request、從回應 JSON 抽出文字。
// image：{ data: base64 字串, mimeType } 或 null（純文字，測試連線用）。

const ADAPTERS = {
  // Claude：瀏覽器直打要多帶 anthropic-dangerous-direct-browser-access，否則被 CORS 擋。
  claude: {
    request({ model, apiKey, text, image, maxTokens }) {
      const content = [];
      if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } });
      content.push({ type: 'text', text });
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: { model, max_tokens: maxTokens, messages: [{ role: 'user', content }] },
      };
    },
    text(json) {
      return (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    },
  },

  gemini: {
    request({ model, apiKey, text, image, maxTokens }) {
      const parts = [];
      if (image) parts.push({ inline_data: { mime_type: image.mimeType, data: image.data } });
      parts.push({ text });
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        headers: { 'x-goog-api-key': apiKey },
        body: { contents: [{ parts }], generationConfig: { maxOutputTokens: maxTokens, temperature: 0 } },
      };
    },
    text(json) {
      return (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    },
  },

  openai: {
    request({ model, apiKey, text, image, maxTokens }) {
      const content = [{ type: 'text', text }];
      if (image) content.push({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } });
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: { model, messages: [{ role: 'user', content }], max_completion_tokens: maxTokens },
      };
    },
    text(json) {
      const c = json.choices?.[0]?.message?.content;
      return typeof c === 'string' ? c : '';
    },
  },
};

export function hasAdapter(providerId) {
  return Boolean(ADAPTERS[providerId]);
}

/** 組 request（不送出），方便測試與除錯。 */
export function buildRequest(providerId, opts) {
  const a = ADAPTERS[providerId];
  if (!a) throw new Error(`${providerId} 的 API 呼叫尚未接上`);
  if (!opts.apiKey) throw new Error('沒有 API 金鑰');
  if (!opts.model) throw new Error('沒有指定型號');
  return a.request({ maxTokens: 1024, ...opts });
}

/** 從錯誤回應擠出可讀訊息（三家都是 error.message，格式略有不同）。 */
export function errorMessage(status, json, rawText = '') {
  const m = json?.error?.message || (typeof json?.error === 'string' ? json.error : '') || json?.message;
  const hint =
    status === 401 || status === 403
      ? '（金鑰錯誤或沒有權限）'
      : status === 429
        ? '（用量／額度超過，請到該公司主控台檢查餘額）'
        : '';
  return `HTTP ${status}${hint}${m ? `：${m}` : rawText ? `：${rawText.slice(0, 200)}` : ''}`;
}

/**
 * 呼叫 API，回傳模型輸出的純文字。
 * opts：{ apiKey, model, text, image, maxTokens, fetchFn, timeoutMs }
 */
export async function callLLM(providerId, opts) {
  const a = ADAPTERS[providerId];
  const req = buildRequest(providerId, opts);
  const fetchFn = opts.fetchFn || globalThis.fetch;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 90000) : null;
  let resp;
  try {
    resp = await fetchFn(req.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...req.headers },
      body: JSON.stringify(req.body),
      signal: ctrl?.signal,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? `${providerId} 逾時沒有回應` : `${providerId} 連線失敗：${e.message}（網路不通或被 CORS 擋）`);
  } finally {
    if (timer) clearTimeout(timer);
  }
  const raw = await resp.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }
  if (!resp.ok) throw new Error(`${providerId} ${errorMessage(resp.status, json, raw)}`);
  if (!json) throw new Error(`${providerId} 回應不是 JSON：${raw.slice(0, 200)}`);
  const text = a.text(json);
  if (!text) throw new Error(`${providerId} 回應裡沒有文字：${raw.slice(0, 300)}`);
  return text;
}

/** 測試連線：送一句話，模型回得出東西就算通。回傳模型回覆的文字。 */
export async function testConnection(providerId, { apiKey, model, fetchFn, timeoutMs = 30000 }) {
  return callLLM(providerId, { apiKey, model, text: '請只回覆「OK」兩個字母。', maxTokens: 64, fetchFn, timeoutMs });
}
