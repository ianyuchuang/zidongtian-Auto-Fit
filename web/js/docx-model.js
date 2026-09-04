// Word 輸出的規劃邏輯（無 DOM、不碰 docx 函式庫）：分組、檔名、輸出前檢查。
// 版面規則在 template/spec.js（LayoutSpec），文件見 docs/版型.md。

import { isTrashDir } from './state.js';
import { usedFields } from './template/spec.js';

/** 輸出檔名：「民國日期 資料夾名.docx」；suffix 用於同名檔被開啟時另存 _new。 */
export function outputFileName(roc, folderName, suffix = '') {
  return `${roc} ${folderName}${suffix}.docx`;
}

/**
 * 規劃輸出：每個有照片的資料夾各產生一份 docx（與 V1.0 相同，存在該資料夾）。
 * orderedPhotos 已依表格順序排好。dirs: [{path, name}]。
 * 內容說明為空的照片略過並列入 skipped；回收桶（_回收桶）裡的照片不輸出，列入 trashed。
 */
export function planExport(orderedPhotos, dirs) {
  const byDir = new Map();
  const skipped = [];
  const trashed = [];
  for (const p of orderedPhotos) {
    if (isTrashDir(p.dir)) {
      trashed.push(p);
      continue;
    }
    if (!(p.desc || '').trim()) {
      skipped.push(p);
      continue;
    }
    if (!byDir.has(p.dir)) byDir.set(p.dir, []);
    byDir.get(p.dir).push(p);
  }
  const groups = [];
  for (const d of dirs) {
    const photos = byDir.get(d.path);
    if (photos && photos.length) groups.push({ dir: d.path, folderName: d.name, photos });
  }
  return { groups, skipped, trashed };
}

/** 輸出前的提醒（不阻擋）。spec 有給就一併檢查版型要的欄位有沒有資料。 */
export function exportWarnings(orderedPhotos, spec = null) {
  const warnings = [];
  orderedPhotos = orderedPhotos.filter((p) => !isTrashDir(p.dir));
  const unreviewed = orderedPhotos.filter((p) => p.status === 'ai' || p.status === 'low');
  if (unreviewed.length) warnings.push(`有 ${unreviewed.length} 張 AI 辨識結果尚未確認，將以目前欄位內容輸出。`);
  const pending = orderedPhotos.filter((p) => p.status === 'pending');
  if (pending.length) warnings.push(`有 ${pending.length} 張尚未辨識完成。`);
  const empty = orderedPhotos.filter((p) => !(p.desc || '').trim());
  if (empty.length) warnings.push(`有 ${empty.length} 張內容說明為空，將略過不輸出。`);
  if (spec) {
    const used = usedFields(spec);
    if (used.has('photoDate') && !orderedPhotos.some((p) => p.photoDate)) {
      warnings.push('版型有「拍照日期」欄位，但目前沒有拍照日期資料，這一欄會留空。');
    }
    for (const [key, label] of [['design', '設計'], ['actual', '實際']]) {
      if (!used.has(key)) continue;
      const blank = orderedPhotos.filter((p) => (p.desc || '').trim() && !(p[key] || '').trim()).length;
      if (blank) warnings.push(`有 ${blank} 張沒填${label}值，版型的這一欄會留空。`);
    }
  }
  return warnings;
}
