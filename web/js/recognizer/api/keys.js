// 個人 API 金鑰與型號選擇的保存（瀏覽器 localStorage，與照片校對暫存分開）。
// 結構：{ provider, remember, keys: { claude: '…' }, models: { claude: '…' }, extras: { claude: { workspaceId } } }
// remember=false（「不要記住金鑰（關閉分頁就清掉）」）：localStorage 只存 provider / remember / models / extras，
// 金鑰改放 sessionStorage——同一個分頁裡重開對話框還在，關閉分頁就沒了（之前是每次開對話框就清掉，跟文字不符，bug W19）。
// models 與 extras 不是機密（型號名稱、Workspace ID），一律保存，免得每次開對話框都要重按「測試連線」。

export const KEYS_STORAGE_KEY = 'autofit:v1:api-keys';
export const SESSION_KEYS_KEY = 'autofit:v1:api-keys:session';

/** sessionStorage 可能不存在（Node 測試）或被瀏覽器擋住（存取就丟錯），一律守住。 */
function sessionStore() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function loadSessionKeys(session) {
  try {
    const raw = session?.getItem(SESSION_KEYS_KEY);
    return raw ? strMap(JSON.parse(raw)) : {};
  } catch (e) {
    console.warn('讀取分頁內金鑰失敗', e);
    return {};
  }
}

function saveSessionKeys(session, keys) {
  try {
    if (!session) return;
    const m = strMap(keys);
    if (Object.keys(m).length) session.setItem(SESSION_KEYS_KEY, JSON.stringify(m));
    else session.removeItem(SESSION_KEYS_KEY);
  } catch (e) {
    console.warn('寫入分頁內金鑰失敗', e);
  }
}

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

export function loadApiKeys(store = globalThis.localStorage, session = sessionStore()) {
  try {
    const raw = store?.getItem(KEYS_STORAGE_KEY);
    if (!raw) return EMPTY();
    const obj = JSON.parse(raw);
    const remember = obj.remember !== false;
    return {
      provider: typeof obj.provider === 'string' ? obj.provider : null,
      remember,
      keys: remember ? (obj.keys && typeof obj.keys === 'object' ? { ...obj.keys } : {}) : loadSessionKeys(session),
      models: strMap(obj.models),
      extras: extraMap(obj.extras),
    };
  } catch (e) {
    console.warn('讀取 API 金鑰設定失敗', e);
    return EMPTY();
  }
}

/** 存設定；remember=false 時金鑰不寫進 localStorage，改放 sessionStorage。回傳實際寫進 localStorage 的物件。 */
export function saveApiKeys({ provider = null, remember = true, keys = {}, models = {}, extras = {} }, store = globalThis.localStorage, session = sessionStore()) {
  const out = { provider, remember, keys: {}, models: strMap(models), extras: extraMap(extras) };
  if (remember) out.keys = strMap(keys);
  try {
    store?.setItem(KEYS_STORAGE_KEY, JSON.stringify(out));
  } catch (e) {
    console.warn('寫入 API 金鑰設定失敗', e);
  }
  saveSessionKeys(session, remember ? {} : keys); // 改成記住時，分頁內的那份就不需要了
  return out;
}

export function clearApiKeys(store = globalThis.localStorage, session = sessionStore()) {
  store?.removeItem(KEYS_STORAGE_KEY);
  try {
    session?.removeItem(SESSION_KEYS_KEY);
  } catch {
    /* 沒有 sessionStorage */
  }
}
