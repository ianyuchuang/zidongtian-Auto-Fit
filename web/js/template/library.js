// 版型庫：解析＋校正好的 LayoutSpec 存進瀏覽器 localStorage，下次直接選用，
// 不必每次翻檔案。也記住每個根資料夾上次用哪一份版型。

export const LIB_KEY = 'autofit:v1:templates';
export const LAST_KEY = 'autofit:v1:template-by-folder';

const read = (key, store) => {
  try {
    const raw = store?.getItem(key);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? v : null;
  } catch (e) {
    console.warn('讀取版型庫失敗', e);
    return null;
  }
};

/** 寫進 localStorage；失敗（例如 QuotaExceeded）回傳那個錯誤，成功回 null。由呼叫端決定要不要大聲失敗。 */
const write = (key, value, store) => {
  try {
    store?.setItem(key, JSON.stringify(value));
    return null;
  } catch (e) {
    console.warn('寫入版型庫失敗', e);
    return e ?? new Error('setItem 失敗');
  }
};

/** [{ id, name, savedAt, spec }]，最近存的排前面。 */
export function listTemplates(store = globalThis.localStorage) {
  const list = read(LIB_KEY, store);
  if (!Array.isArray(list)) return [];
  return list.filter((t) => t && t.id && t.spec).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

export function getTemplate(id, store = globalThis.localStorage) {
  return listTemplates(store).find((t) => t.id === id) ?? null;
}

/** 新 id：時間戳＋亂數尾巴，同一毫秒連存兩份也不會撞。 */
export const newId = () => `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * 存一份版型。同名的直接覆蓋（改完再存不會愈存愈多份），而且**沿用原本的 id**：
 * 每個資料夾記的是 id（rememberFor），換了 id 就會忘記上次用哪一份。回傳存好的那筆。
 * localStorage 寫不進去（空間滿了…）就丟錯，不能回一筆其實沒存進去的 entry。
 */
export function saveTemplate(spec, name, store = globalThis.localStorage) {
  const clean = String(name ?? '').trim() || spec.name || '未命名版型';
  const all = listTemplates(store);
  const same = all.find((t) => t.name === clean);
  const list = all.filter((t) => t.name !== clean);
  const entry = { id: same?.id ?? newId(), name: clean, savedAt: Date.now(), spec: JSON.parse(JSON.stringify(spec)) };
  entry.spec.name = clean;
  entry.spec.id = entry.id;
  const err = write(LIB_KEY, [entry, ...list], store);
  if (err) throw new Error(`版型存不進瀏覽器（localStorage 寫入失敗，可能是空間已滿）：${err.message ?? err}`);
  return entry;
}

export function removeTemplate(id, store = globalThis.localStorage) {
  write(LIB_KEY, listTemplates(store).filter((t) => t.id !== id), store);
}

/** 記住某個根資料夾上次用的版型（id 給 null 代表用預設版面）。 */
export function rememberFor(rootName, id, store = globalThis.localStorage) {
  if (!rootName) return;
  const map = read(LAST_KEY, store) ?? {};
  if (id) map[rootName] = id;
  else delete map[rootName];
  write(LAST_KEY, map, store);
}

export function lastFor(rootName, store = globalThis.localStorage) {
  const id = (read(LAST_KEY, store) ?? {})[rootName];
  return id ? getTemplate(id, store) : null;
}
