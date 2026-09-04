// 本地模型辨識器：照片縮到 1500px → base64 → 送到本機的 llama-server → 解析 JSON 填三欄。
// 與 api.js 是同一套流程，差別只有兩點：照片不出這台電腦（不需要金鑰、不經過網際網路），
// 以及逾時放得很寬（本機大模型一張要好幾分鐘）。提示詞與回覆解析共用 api/prompt.js。
// 伺服器怎麼啟動、設定存哪裡見 local/server.js 與 local/settings.js，說明見 docs/本地模型.md。

import { localChat, DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS } from './local/server.js';
import { buildPrompt, parseResult } from './api/prompt.js';
import { DEFAULT_PROMPT } from './prompt-default.js';

// 與 LLM API 那條路用同一個尺寸，兩邊的實測結果才比得起來（docs/辨識實測-尺寸11F.md）。
export const LOCAL_IMAGE_MAX_SIDE = 1500;

/** encode(file, maxSide) → { data, mimeType }；fetchFn 可注入（測試用）。 */
export function createLocalRecognizer({ encode, fetchFn } = {}) {
  return {
    id: 'local',
    label: '本地模型（本機 llama.cpp；照片不離開這台電腦）',
    available: true,
    note: '需要自己先啟動 llama-server',
    async recognize(file, ctx = {}) {
      const cfg = ctx.local || {};
      if (!cfg.model) throw new Error('沒有選本機模型的型號（請在「AI 辨識」按「測試連線」）');
      const enc = encode || (await import('../imaging.js')).encodeJpegBase64;
      const image = await enc(file, LOCAL_IMAGE_MAX_SIDE);
      const text = await localChat({
        baseUrl: cfg.baseUrl || DEFAULT_BASE_URL,
        model: cfg.model,
        text: buildPrompt(ctx.prompt, DEFAULT_PROMPT),
        image,
        maxTokens: 2048,
        timeoutMs: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        fetchFn,
      });
      const r = parseResult(text);
      return { ...r, raw: text };
    },
  };
}

export const localRecognizer = createLocalRecognizer();
