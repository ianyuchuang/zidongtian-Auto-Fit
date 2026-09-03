// LLM API 辨識器：照片縮到 1500px → base64 → 送到使用者選的供應商 → 解析 JSON 填三欄。
// 注意：這條路會把照片送出機器（需求 1 的例外），入口頁有明確標示。
// ctx.api = { provider, apiKey, model?, extra? } 由 app.state.api 帶進來；
// model 由「AI 辨識」對話框從伺服器抓回的清單選出來，extra 是各家的額外設定（Claude 的 workspaceId）。

import { getProvider } from './api/providers.js';
import { callLLM, hasAdapter } from './api/call.js';
import { buildPrompt, parseResult } from './api/prompt.js';
import { DEFAULT_PROMPT } from './prompt-default.js';

export const API_IMAGE_MAX_SIDE = 1500;

/** encode(file, maxSide) → { data, mimeType }；fetchFn 可注入（測試用）。 */
export function createApiRecognizer({ encode, fetchFn } = {}) {
  return {
    id: 'api',
    label: 'LLM API（個人金鑰；照片會送到該公司伺服器）',
    available: true,
    note: '',
    async recognize(file, ctx = {}) {
      const api = ctx.api || {};
      if (!api.provider) throw new Error('沒有選 LLM API 供應商');
      const p = getProvider(api.provider);
      if (!p.available || !hasAdapter(p.id)) throw new Error(`${p.label} 辨識尚未接上`);
      if (!api.apiKey) throw new Error(`沒有填 ${p.label} 的 API 金鑰`);
      const enc = encode || (await import('../imaging.js')).encodeJpegBase64;
      const image = await enc(file, API_IMAGE_MAX_SIDE);
      const text = await callLLM(p.id, {
        apiKey: api.apiKey,
        model: api.model || p.model,
        extra: api.extra || {},
        text: buildPrompt(ctx.prompt, DEFAULT_PROMPT),
        image,
        maxTokens: 2048,
        fetchFn,
      });
      const r = parseResult(text);
      return { ...r, raw: text };
    },
  };
}

export const apiRecognizer = createApiRecognizer();
