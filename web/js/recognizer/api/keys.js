// 個人 API 金鑰的保存（瀏覽器 localStorage，與照片校對暫存分開）。
// 結構：{ provider: 'claude', remember: true, keys: { claude: '…', gemini: '…' } }
// remember=false 時只存 provider 與 remember 旗標，金鑰一律不落地（並清掉先前存的）。

export const KEYS_STORAGE_KEY = 'autofit:v1:api-keys';

const EMPTY = () => ({ provider: null, remember: true, keys: {} });

export function loadApiKeys(store = globalThis.localStorage) {
  try {
    const raw = store?.getItem(KEYS_STORAGE_KEY);
    if (!raw) return EMPTY();
    const obj = JSON.parse(raw);
    return {
      provider: typeof obj.provider === 'string' ? obj.provider : null,
      remember: obj.remember !== false,
      keys: obj.keys && typeof obj.keys === 'object' ? { ...obj.keys } : {},
    };
  } catch (e) {
    console.warn('讀取 API 金鑰設定失敗', e);
    return EMPTY();
  }
}

/** 存設定；remember=false 時金鑰不寫入。回傳實際寫入的物件。 */
export function saveApiKeys({ provider = null, remember = true, keys = {} }, store = globalThis.localStorage) {
  const out = { provider, remember, keys: {} };
  if (remember) for (const [k, v] of Object.entries(keys)) if (typeof v === 'string' && v.trim()) out.keys[k] = v.trim();
  try {
    store?.setItem(KEYS_STORAGE_KEY, JSON.stringify(out));
  } catch (e) {
    console.warn('寫入 API 金鑰設定失敗', e);
  }
  return out;
}

export function clearApiKeys(store = globalThis.localStorage) {
  store?.removeItem(KEYS_STORAGE_KEY);
}
