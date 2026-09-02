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
