// Word 輸出的純邏輯（無 DOM、不碰 docx 函式庫）：版面常數、分組、尺寸、檔名、檢查。
// 版面常數取自 V1.0 self_check_core.py（EMU → twips / px）。

const EMU_PER_TWIP = 635;
const EMU_PER_PX = 9525;

export const COMPANY = '永青營造工程股份有限公司';
export const TITLE = '施工自主檢查照片';
export const FONT = '標楷體';

export const LAYOUT = {
  pageW: Math.round(7560310 / EMU_PER_TWIP), // 11906 twips (A4)
  pageH: Math.round(10692130 / EMU_PER_TWIP), // 16838
  marginL: Math.round(720090 / EMU_PER_TWIP), // 1134
  marginR: Math.round(540385 / EMU_PER_TWIP), // 851
  marginT: Math.round(450215 / EMU_PER_TWIP), // 709
  marginB: Math.round(540385 / EMU_PER_TWIP), // 851
  cellW: 4915, // dxa
  photoRowH: 3798, // twips
  tableIndent: 80, // dxa
  photoH: 2232000 / EMU_PER_PX, // 234.3 px
  photoMaxW: 2975500 / EMU_PER_PX, // 312.4 px
  captionHalfPt: 16, // 8pt
  headerHalfPt: 28, // 14pt
  perRow: 2,
  rowsPerPage: 3,
};

/** 依 V1.0 規則算照片在 Word 裡的尺寸（px）：固定高度，太寬改以最大寬度為準。 */
export function fitPhoto(width, height) {
  if (!(width > 0) || !(height > 0)) throw new Error(`照片尺寸不合法：${width}x${height}`);
  let h = LAYOUT.photoH;
  let w = (width / height) * h;
  if (w > LAYOUT.photoMaxW) {
    w = LAYOUT.photoMaxW;
    h = (height / width) * w;
  }
  return { width: Math.round(w * 100) / 100, height: Math.round(h * 100) / 100 };
}

export function captionLines(p) {
  return [`內容說明：${p.desc ?? ''}`, `設    計：${p.design ?? ''}`, `實    際：${p.actual ?? ''}`];
}

/** 輸出檔名：「民國日期 資料夾名.docx」；suffix 用於同名檔被開啟時另存 _new。 */
export function outputFileName(roc, folderName, suffix = '') {
  return `${roc} ${folderName}${suffix}.docx`;
}

/** 把照片兩張一列分組。 */
export function pairRows(photos, perRow = LAYOUT.perRow) {
  const rows = [];
  for (let i = 0; i < photos.length; i += perRow) rows.push(photos.slice(i, i + perRow));
  return rows;
}

/**
 * 規劃輸出：每個有照片的資料夾各產生一份 docx（與 V1.0 相同，存在該資料夾）。
 * orderedPhotos 已依表格順序排好。dirs: [{path, name}]。
 * 內容說明為空的照片略過並列入 skipped。
 */
export function planExport(orderedPhotos, dirs) {
  const byDir = new Map();
  const skipped = [];
  for (const p of orderedPhotos) {
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
  return { groups, skipped };
}

/** 輸出前的提醒（不阻擋）。 */
export function exportWarnings(orderedPhotos) {
  const warnings = [];
  const unreviewed = orderedPhotos.filter((p) => p.status === 'ai' || p.status === 'low');
  if (unreviewed.length) warnings.push(`有 ${unreviewed.length} 張 AI 辨識結果尚未確認，將以目前欄位內容輸出。`);
  const pending = orderedPhotos.filter((p) => p.status === 'pending');
  if (pending.length) warnings.push(`有 ${pending.length} 張尚未辨識完成。`);
  const empty = orderedPhotos.filter((p) => !(p.desc || '').trim());
  if (empty.length) warnings.push(`有 ${empty.length} 張內容說明為空，將略過不輸出。`);
  return warnings;
}
