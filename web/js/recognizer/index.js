// 辨識模組登錄表。每個 provider 介面：
//   { id, label, available, note, async recognize(file, ctx) → { desc, design, actual, confidence(0-100), bbox } }
//   bbox：白板在整張照片上的相對位置 {x, y, w, h}（0–1），沒有就 null。
// 本地模型尚待實驗（docs/辨識模型實驗計畫.md）；LLM API 走 api.js（ctx.api 帶供應商與金鑰）。

import { mockRecognizer } from './mock.js';
import { apiRecognizer } from './api.js';
export { DEFAULT_PROMPT } from './prompt-default.js';

const notReady = (id, label) => ({
  id,
  label,
  available: false,
  note: '尚未接上（待實驗驗證）',
  async recognize() {
    throw new Error(`${label} 尚未實作`);
  },
});

export const RECOGNIZERS = [mockRecognizer, notReady('local', '本地模型（Hugging Face）'), apiRecognizer];

export function getRecognizer(id) {
  const r = RECOGNIZERS.find((x) => x.id === id);
  if (!r) throw new Error(`沒有這個辨識方式：${id}`);
  return r;
}
