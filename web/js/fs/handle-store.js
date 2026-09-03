// 記住上次開過的照片資料夾。File System Access 的 handle 可以直接存進 IndexedDB，
// 重新整理、隔天再開都還在（Chrome 會再問一次讀寫權限，所以要由使用者點一下才恢復）。
// 存不進去就當作沒這回事，不影響主流程。

const DB_NAME = 'autofit';
const STORE = 'handles';
const KEY = 'lastRoot';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('這個瀏覽器沒有 IndexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveLastRoot(handle) {
  if (!handle || typeof handle.queryPermission !== 'function') return false; // 記憶體複本不必存
  try {
    await run('readwrite', (s) => s.put(handle, KEY));
    return true;
  } catch (e) {
    console.warn('記住資料夾失敗', e);
    return false;
  }
}

export async function loadLastRoot() {
  try {
    return (await run('readonly', (s) => s.get(KEY))) ?? null;
  } catch (e) {
    console.warn('讀取上次的資料夾失敗', e);
    return null;
  }
}

export async function clearLastRoot() {
  try {
    await run('readwrite', (s) => s.delete(KEY));
  } catch (e) {
    console.warn('清除上次的資料夾失敗', e);
  }
}

/** 已經有權限就回 true；還沒的話要由使用者的點擊觸發才能問。 */
export async function ensurePermission(handle, { request = false } = {}) {
  if (!handle?.queryPermission) return true;
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (!request) return false;
  return (await handle.requestPermission(opts)) === 'granted';
}
