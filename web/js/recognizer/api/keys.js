// 個人 API 金鑰與型號選擇的保存（瀏覽器 localStorage，與照片校對暫存分開）。
// 結構：{ provider, remember, keys: { claude: '…' }, models: { claude: '…' }, extras: { claude: { workspaceId } } }
// remember=false 時只存 provider / remember / models / extras，金鑰一律不落地（並清掉先前存的）。
// models 與 extras 不是機密（型號名稱、Workspace ID），一律保存，免得每次開對話框都要重按「測試連線」。

export const KEYS_STORAGE_KEY = 'autofit:v1:api-keys';

const EMPTY = () => ({ provider: null, remember: true, keys: {}, models: {}, extras: {} });

const strMap = (o) => {
  const out = {};
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  return out;
};

const extraMap = (o) => {
  const out = {};
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') out[k] = strMap(v);
  return out;
};

export function loadApiKeys(store = globalThis.localStorage) {
  try {
    const raw = store?.getItem(KEYS_STORAGE_KEY);
    if (!raw) return EMPTY();
    const obj = JSON.parse(raw);
    return {
      provider: typeof obj.provider === 'string' ? obj.provider : null,
      remember: obj.remember !== false,
      keys: obj.keys && typeof obj.keys === 'object' ? { ...obj.keys } : {},
      models: strMap(obj.models),
      extras: extraMap(obj.extras),
    };
  } catch (e) {
    console.warn('讀取 API 金鑰設定失敗', e);
    return EMPTY();
  }
}

/** 存設定；remember=false 時金鑰不寫入。回傳實際寫入的物件。 */
export function saveApiKeys({ provider = null, remember = true, keys = {}, models = {}, extras = {} }, store = globalThis.localStorage) {
  const out = { provider, remember, keys: {}, models: strMap(models), extras: extraMap(extras) };
  if (remember) out.keys = strMap(keys);
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
