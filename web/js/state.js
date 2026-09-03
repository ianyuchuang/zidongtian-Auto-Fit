// 照片狀態、篩選、計數、排序等純邏輯（無 DOM）。

export const STATUS = {
  PENDING: 'pending', // 尚未辨識
  PARSED: 'parsed', // 檔名解析
  AI: 'ai', // AI 辨識・待校對
  LOW: 'low', // AI 低信心・請確認
  CONFIRMED: 'confirmed', // 已確認
  ERROR: 'error', // 辨識失敗
};

export const STATUS_LABEL = {
  [STATUS.PENDING]: '辨識中…',
  [STATUS.PARSED]: '檔名解析',
  [STATUS.AI]: 'AI 辨識・待校對',
  [STATUS.LOW]: 'AI 低信心・請確認',
  [STATUS.CONFIRMED]: '已確認',
  [STATUS.ERROR]: '辨識失敗',
};

/** 低信心門檻（草稿 <70%，見 docs/介面規格.md） */
export const LOW_CONF = 70;

export function statusFromConfidence(confidence) {
  if (confidence == null || Number.isNaN(confidence)) return STATUS.AI;
  return confidence < LOW_CONF ? STATUS.LOW : STATUS.AI;
}

/** 篩選 chip 的 key */
export const CHIPS = ['all', 'parsed', 'ai', 'low'];
export const CHIP_LABEL = { all: '全部', parsed: '檔名解析', ai: 'AI 待校對', low: '低信心' };

function matchChip(p, chip) {
  switch (chip) {
    case 'parsed':
      return p.status === STATUS.PARSED;
    case 'ai':
      return p.status === STATUS.AI || p.status === STATUS.LOW;
    case 'low':
      return p.status === STATUS.LOW;
    default:
      return true;
  }
}

/** 搜尋比對「內容說明」與檔名（只比說明的話，想用檔名找某一張會找不到）。 */
function matchQuery(p, q) {
  return (p.desc || '').toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q);
}

/**
 * 依 chip、搜尋字串、資料夾篩選。
 * 已刪除（在回收桶裡）的照片只在「全部」出現，讓使用者看得到、能還原，
 * 但不參與檔名解析／待校對／低信心這些校對用的 chip。
 */
export function filterPhotos(photos, { chip = 'all', query = '', dir = null } = {}) {
  const q = query.trim().toLowerCase();
  return photos.filter((p) => {
    if (dir != null && groupDirOf(p) !== dir) return false;
    if (q && !matchQuery(p, q)) return false;
    if (isTrashed(p)) return chip === 'all';
    return matchChip(p, chip);
  });
}

/** 統計一律不含已刪除的照片（否則「待校對」永遠歸不了零），另外單獨給 trashed。 */
export function counts(photos) {
  const c = { all: 0, parsed: 0, ai: 0, low: 0, confirmed: 0, pending: 0, recognized: 0, trashed: 0 };
  for (const p of photos) {
    if (isTrashed(p)) {
      c.trashed += 1;
      continue;
    }
    c.all += 1;
    if (p.status === STATUS.PARSED) c.parsed += 1;
    if (p.status === STATUS.AI || p.status === STATUS.LOW) c.ai += 1;
    if (p.status === STATUS.LOW) c.low += 1;
    if (p.status === STATUS.CONFIRMED) c.confirmed += 1;
    if (p.status === STATUS.PENDING) c.pending += 1;
    if (p.status !== STATUS.PENDING) c.recognized += 1;
  }
  c.toReview = c.ai; // 待校對 = AI 待校對 + 低信心
  return c;
}

export function isPendingReview(p) {
  return p.status === STATUS.AI || p.status === STATUS.LOW;
}

/** 從 fromId 之後（循環）找下一張待校對；沒有就回 null。 */
export function nextPendingReview(orderedPhotos, fromId) {
  const n = orderedPhotos.length;
  if (!n) return null;
  let start = orderedPhotos.findIndex((p) => p.id === fromId);
  if (start < 0) start = -1;
  for (let k = 1; k <= n; k++) {
    const p = orderedPhotos[(start + k) % n];
    if (isPendingReview(p)) return p;
  }
  return null;
}

/**
 * 依（資料夾順序, 是否已刪除, order）排序，回傳新陣列。dirOrder：資料夾路徑陣列。
 * 已刪除的照片仍歸原資料夾，只是排在該資料夾的最後面。
 */
export function sortPhotos(photos, dirOrder) {
  const rank = new Map(dirOrder.map((d, i) => [d, i]));
  return [...photos].sort((a, b) => {
    const ra = rank.get(groupDirOf(a)) ?? 1e9;
    const rb = rank.get(groupDirOf(b)) ?? 1e9;
    if (ra !== rb) return ra - rb;
    const ta = isTrashed(a) ? 1 : 0;
    const tb = isTrashed(b) ? 1 : 0;
    if (ta !== tb) return ta - tb;
    return a.order - b.order;
  });
}

/**
 * 同一資料夾內拖曳換順序：把 movingId 放到 targetId 之前或之後，
 * 回傳該資料夾內照片的新順序（id 陣列）。不同資料夾回傳 null。
 */
export function reorderWithinDir(photos, movingId, targetId, place = 'before') {
  const moving = photos.find((p) => p.id === movingId);
  const target = photos.find((p) => p.id === targetId);
  if (!moving || !target || moving.dir !== target.dir || movingId === targetId) return null;
  const ids = photos
    .filter((p) => p.dir === moving.dir)
    .sort((a, b) => a.order - b.order)
    .map((p) => p.id)
    .filter((id) => id !== movingId);
  const idx = ids.indexOf(targetId);
  ids.splice(place === 'after' ? idx + 1 : idx, 0, movingId);
  return ids;
}

/** 以 ids 順序重新編 order（回傳 Map id→order）。 */
export function assignOrder(ids) {
  return new Map(ids.map((id, i) => [id, i]));
}

/**
 * 回收桶：每個資料夾底下各有一個 `_回收桶`（網頁無法丟進 Windows 資源回收桶）。
 * 「刪除」＝搬進所在資料夾的回收桶；表格仍把它留在原資料夾群組裡反灰顯示，
 * 按「還原」就搬回同一層，所以不小心刪錯一眼就看得到、也還得回來。
 */
export const TRASH_DIR = '_回收桶';

/** 路徑中任何一層叫 `_回收桶` 就算在回收桶裡。 */
export function isTrashDir(path) {
  return String(path ?? '')
    .split('/')
    .includes(TRASH_DIR);
}

export function isTrashed(p) {
  return isTrashDir(p?.dir);
}

/** 某個資料夾的回收桶路徑：'' → '_回收桶'；'4F' → '4F/_回收桶'。 */
export function trashDirOf(dir) {
  return dir ? `${dir}/${TRASH_DIR}` : TRASH_DIR;
}

/** 回收桶路徑 → 擁有它的資料夾（還原的目的地）。不是回收桶就原樣回傳。 */
export function ownerOfTrash(path) {
  const parts = String(path ?? '').split('/');
  const i = parts.indexOf(TRASH_DIR);
  return i < 0 ? String(path ?? '') : parts.slice(0, i).join('/');
}

/** 這張照片在表格與左樹裡要歸到哪個資料夾群組（已刪除的仍歸原資料夾）。 */
export function groupDirOf(p) {
  return ownerOfTrash(p?.dir);
}

/** 勾選集合只留還存在的 id（就地修改），回傳移除數。 */
export function pruneChecked(checked, photos) {
  const alive = new Set(photos.map((p) => p.id));
  let removed = 0;
  for (const id of [...checked]) {
    if (!alive.has(id)) {
      checked.delete(id);
      removed += 1;
    }
  }
  return removed;
}

/** 批次搬移結果 → 提示文字。r = { moved, failed: [{name, error}] } */
export function moveSummary(r, dirName, { readOnly = false } = {}) {
  const parts = [];
  if (r.moved) parts.push(`已搬 ${r.moved} 張到「${dirName}」${readOnly ? '（唯讀複本，未動到實際檔案）' : ''}`);
  if (r.failed.length) parts.push(`${r.failed.length} 張失敗：${r.failed.map((f) => `${f.name}（${f.error}）`).join('；')}`);
  if (!parts.length) parts.push('沒有需要搬移的照片');
  return parts.join('。');
}
