// 辨識模組登錄表。每個 provider 介面：
//   { id, label, available, note, async recognize(file, ctx) → { desc, design, actual, confidence(0-100), bbox } }
//   bbox：白板在整張照片上的相對位置 {x, y, w, h}（0–1），沒有就 null。
// 本地模型 / LLM API 尚待實驗（docs/需求摘要.md §7），目前只有模擬版能用。

import { mockRecognizer } from './mock.js';

const notReady = (id, label) => ({
  id,
  label,
  available: false,
  note: '尚未接上（待實驗驗證）',
  async recognize() {
    throw new Error(`${label} 尚未實作`);
  },
});

export const RECOGNIZERS = [
  mockRecognizer,
  notReady('local', '本地模型（Hugging Face）'),
  notReady('api', 'LLM API'),
];

export function getRecognizer(id) {
  const r = RECOGNIZERS.find((x) => x.id === id);
  if (!r) throw new Error(`沒有這個辨識方式：${id}`);
  return r;
}

export const DEFAULT_PROMPT =
  '白板上有「檢驗項目」「標準值」「實際值」三欄；檢驗項目對應內容說明，標準值對應設計，實際值對應實際。';
