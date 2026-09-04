// 表格 / 左樹共用：拖曳資料格式、讀 drop 的 id 清單、搬移結果提示。

import { moveSummary } from '../state.js';
import { toast } from './dialog.js';

export const DND_MULTI = 'text/autofit-photos'; // JSON 陣列：多張 id
export const DND_SINGLE = 'text/autofit-photo';

/** 讀 drop 的 id 清單（多張優先，其次單張）。 */
export function dropIds(dt) {
  const multi = dt.getData(DND_MULTI);
  if (multi) {
    try {
      const ids = JSON.parse(multi);
      if (Array.isArray(ids) && ids.length) return ids;
    } catch (e) {
      /* 落回單張 */
    }
  }
  const one = dt.getData(DND_SINGLE);
  return one ? [one] : [];
}

/** 搬移 / 刪除結果的提示。r = app.moveManyToDir / app.trash 的回傳。 */
export function reportMove(app, r, dirName) {
  const msg = moveSummary(r, dirName, { readOnly: app.state.readOnly });
  toast(msg, { error: r.failed.length > 0, ms: r.failed.length ? 6000 : 3500 });
}

/**
 * 把一塊區域變成可拖放檔案的區域（入口頁選資料夾、版型調整頁拖 docx 共用）。
 * 會擋掉冒泡，所以小區塊（例：版型框）綁的處理會蓋過外層整頁的處理。
 */
export function bindFileDrop(zone, onDrop) {
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('over');
    try {
      await onDrop(e.dataTransfer);
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
}

/**
 * 入口頁拖進來的東西該當成什麼（純邏輯，好測）。
 * isDirectory：拖進來的是資料夾嗎；fileName：檔案的名字（沒有就給 null）。
 */
export function classifyDrop({ isDirectory = false, fileName = null } = {}) {
  if (isDirectory) return 'folder';
  if (fileName && /\.docx$/i.test(fileName)) return 'template';
  if (fileName && /\.doc$/i.test(fileName)) return 'old-doc';
  if (fileName) return 'other-file';
  return 'unsupported';
}
