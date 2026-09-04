// 本機模型設定的保存（瀏覽器 localStorage）。伺服器網址與型號都不是機密，一律記住，
// 免得每次開「AI 辨識」都要重打網址、重按「測試連線」。與 api/keys.js 分開存，互不影響。

import { DEFAULT_BASE_URL, normalizeBaseUrl } from './server.js';

export const LOCAL_STORAGE_KEY = 'autofit:v1:local';

const EMPTY = () => ({ baseUrl: DEFAULT_BASE_URL, model: '' });

export function loadLocalSettings(store = globalThis.localStorage) {
  try {
    const raw = store?.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return EMPTY();
    const o = JSON.parse(raw);
    return {
      baseUrl: normalizeBaseUrl(typeof o.baseUrl === 'string' ? o.baseUrl : ''),
      model: typeof o.model === 'string' ? o.model.trim() : '',
    };
  } catch (e) {
    console.warn('讀取本機模型設定失敗', e);
    return EMPTY();
  }
}

export function saveLocalSettings({ baseUrl = DEFAULT_BASE_URL, model = '' } = {}, store = globalThis.localStorage) {
  const out = { baseUrl: normalizeBaseUrl(baseUrl), model: String(model ?? '').trim() };
  try {
    store?.setItem(LOCAL_STORAGE_KEY, JSON.stringify(out));
  } catch (e) {
    console.warn('寫入本機模型設定失敗', e);
  }
  return out;
}
