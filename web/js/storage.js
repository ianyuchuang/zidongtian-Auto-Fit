// 校對結果暫存在瀏覽器 localStorage（不寫進使用者的照片資料夾）。
// key 以根資料夾名稱區分；每張照片以相對路徑對應。

const PREFIX = 'autofit:v1:';
const FIELDS = ['desc', 'design', 'actual', 'confidence', 'source', 'status', 'bbox', 'order'];

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
    if (p.status === 'pending') continue; // 還沒辨識完的不存
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

/** 把暫存套回照片清單（就地修改），回傳套用張數。 */
export function applySaved(photos, saved) {
  let n = 0;
  for (const p of photos) {
    const rec = saved[p.path];
    if (!rec) continue;
    for (const f of FIELDS) if (rec[f] !== undefined) p[f] = rec[f];
    n += 1;
  }
  return n;
}

export function clearSaved(rootName, store = globalThis.localStorage) {
  store?.removeItem(storageKey(rootName));
}
