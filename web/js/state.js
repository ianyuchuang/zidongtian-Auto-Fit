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

/** 依 chip、搜尋字串（比對內容說明）、資料夾篩選。 */
export function filterPhotos(photos, { chip = 'all', query = '', dir = null } = {}) {
  const q = query.trim().toLowerCase();
  return photos.filter(
    (p) => matchChip(p, chip) && (dir == null || p.dir === dir) && (!q || (p.desc || '').toLowerCase().includes(q)),
  );
}

export function counts(photos) {
  const c = { all: photos.length, parsed: 0, ai: 0, low: 0, confirmed: 0, pending: 0, recognized: 0 };
  for (const p of photos) {
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

/** 依（資料夾順序, order）排序，回傳新陣列。dirOrder：資料夾路徑陣列。 */
export function sortPhotos(photos, dirOrder) {
  const rank = new Map(dirOrder.map((d, i) => [d, i]));
  return [...photos].sort((a, b) => {
    const ra = rank.get(a.dir) ?? 1e9;
    const rb = rank.get(b.dir) ?? 1e9;
    if (ra !== rb) return ra - rb;
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
