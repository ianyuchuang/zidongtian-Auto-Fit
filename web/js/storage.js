// 校對結果暫存在瀏覽器 localStorage（不寫進使用者的照片資料夾）。
// key 以根資料夾名稱區分；每張照片以相對路徑對應。

const PREFIX = 'autofit:v1:';
const FIELDS = ['desc', 'design', 'actual', 'confidence', 'source', 'status', 'bbox', 'order', 'engine', 'error', 'warn'];

export function storageKey(rootName) {
  return PREFIX + rootName;
}

export function loadSaved(rootName, store = globalThis.localStorage) {
  try {
    const raw = store?.getItem(storageKey(rootName));
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('讀取暫存失敗', e);
    return {};
  }
}

export function serializePhotos(photos) {
  const out = {};
  for (const p of photos) {
    // 「待辨識」的也要存：沒跑 AI、純手打三欄的照片狀態一直是 pending，
    // 不存的話手打的字與拖曳的順序重開就不見了（bug W2）。
    const rec = {};
    for (const f of FIELDS) if (p[f] !== undefined) rec[f] = p[f];
    out[p.path] = rec;
  }
  return out;
}

export function savePhotos(rootName, photos, store = globalThis.localStorage) {
  try {
    store?.setItem(storageKey(rootName), JSON.stringify(serializePhotos(photos)));
  } catch (e) {
    console.warn('寫入暫存失敗', e);
  }
}

/**
 * 把暫存套回照片清單（就地修改），回傳 { applied, redo }。
 * engine：這次用的辨識引擎（例 'mock'、'api:claude'）。AI 結果若是別的引擎跑的、又還沒被人確認，
 * 就不套回（只保留排序），讓它重新辨識——否則換了引擎仍會看到舊引擎（例如模擬辨識）的結果。
 */
export function applySaved(photos, saved, { engine = null } = {}) {
  let applied = 0;
  let redo = 0;
  for (const p of photos) {
    const rec = saved[p.path];
    if (!rec) continue;
    const staleAi = rec.source === 'ai' && rec.status !== 'confirmed' && engine != null && rec.engine !== engine;
    if (staleAi) {
      if (rec.order !== undefined) p.order = rec.order;
      redo += 1;
      continue;
    }
    for (const f of FIELDS) if (rec[f] !== undefined) p[f] = rec[f];
    applied += 1;
  }
  return { applied, redo };
}

export function clearSaved(rootName, store = globalThis.localStorage) {
  store?.removeItem(storageKey(rootName));
}

// ---------- 各資料夾的檢查日期 ----------
// 日期跟著資料夾走（每個資料夾各出一份 docx，日期可以不同），與校對暫存分開存。

export const datesKey = (rootName) => `${PREFIX}dates:${rootName}`;

/** { '4F': '1150725', … }；壞掉或沒有就回空物件。 */
export function loadDates(rootName, store = globalThis.localStorage) {
  try {
    const raw = store?.getItem(datesKey(rootName));
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== 'object') return {};
    const out = {};
    for (const [k, s] of Object.entries(v)) if (typeof s === 'string' && /^\d{7}$/.test(s)) out[k] = s;
    return out;
  } catch (e) {
    console.warn('讀取日期暫存失敗', e);
    return {};
  }
}

export function saveDates(rootName, dates, store = globalThis.localStorage) {
  try {
    store?.setItem(datesKey(rootName), JSON.stringify(dates));
  } catch (e) {
    console.warn('寫入日期暫存失敗', e);
  }
}
