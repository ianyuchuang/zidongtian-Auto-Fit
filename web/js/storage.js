// 校對結果暫存在瀏覽器 localStorage（不寫進使用者的照片資料夾）。
// key 以根資料夾名稱區分；每張照片以相對路徑對應。

const PREFIX = 'autofit:v1:';
const FIELDS = ['desc', 'design', 'actual', 'confidence', 'source', 'status', 'bbox', 'order', 'engine', 'error', 'warn'];

/**
 * 校對暫存的 key：'autofit:v1:photos:<根資料夾名>'。
 * 舊版直接 PREFIX + 根資料夾名，資料夾叫 api-keys / templates / dates:… 就會跟其他設定撞 key（bug W15）。
 */
export function storageKey(rootName) {
  return `${PREFIX}photos:${rootName}`;
}

/** 舊版（2026-09-04 以前）的 key；跟其他設定同名的不能當成舊暫存來讀。 */
export function legacyStorageKey(rootName) {
  const k = PREFIX + rootName;
  const reserved = /^(api-keys|templates|template-by-folder)$/.test(rootName) || /^(dates|photos):/.test(rootName);
  return reserved ? null : k;
}

/**
 * 讀校對暫存。新 key 沒有、舊 key 有 → 搬到新 key（一次性遷移，既有使用者不會掉暫存）。
 */
export function loadSaved(rootName, store = globalThis.localStorage) {
  try {
    let raw = store?.getItem(storageKey(rootName));
    if (raw == null) {
      const legacy = legacyStorageKey(rootName);
      raw = legacy ? store?.getItem(legacy) : null;
      if (raw != null) {
        store.setItem(storageKey(rootName), raw);
        store.removeItem(legacy);
      }
    }
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
