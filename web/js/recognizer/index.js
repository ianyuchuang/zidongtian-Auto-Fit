// 辨識模組登錄表。每個 provider 介面：
//   { id, label, available, note, async recognize(file, ctx) → { desc, design, actual, confidence(0-100), bbox } }
//   bbox：白板在整張照片上的相對位置 {x, y, w, h}（0–1），沒有就 null。
// local.js 走本機 llama-server（ctx.local 帶網址與型號，照片不出這台電腦）；
// api.js 走 LLM API 直打（ctx.api 帶供應商與金鑰，照片會送到該公司）。

import { mockRecognizer } from './mock.js';
import { localRecognizer } from './local.js';
import { apiRecognizer } from './api.js';
export { DEFAULT_PROMPT } from './prompt-default.js';

export const RECOGNIZERS = [mockRecognizer, localRecognizer, apiRecognizer];

export function getRecognizer(id) {
  const r = RECOGNIZERS.find((x) => x.id === id);
  if (!r) throw new Error(`沒有這個辨識方式：${id}`);
  return r;
}
