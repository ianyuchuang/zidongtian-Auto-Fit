// Excel（xlsx）的單位換算與座標小工具。解析（parse-xlsx.js）與輸出（xlsx-export.js）共用，
// 只寫這一份。LayoutSpec 一律用 Word 的單位（欄寬 dxa、列高 twips、照片 px），
// 進出 Excel 時在這裡換算，版型頁與 docx 輸出才不必知道有 Excel 這回事。

export const TWIPS_PER_PT = 20;
export const TWIPS_PER_INCH = 1440;
export const DXA_PER_PX = 15; // 1440 dxa/吋 ÷ 96 px/吋
export const MDW = 7; // Calibri 11 的「最大數字寬度」，Excel 欄寬換算的基準（px）

// A4：Excel 的 paperSize=9。LayoutSpec 存 twips。
export const A4 = { w: 11906, h: 16838 };

/** Excel 欄寬（字元數）→ 像素。Excel 自己的公式：round(字元數 × MDW) + 內距 5px。 */
export const charWidthToPx = (w) => Math.round(w * MDW) + 5;
/** 像素 → Excel 欄寬（字元數）。 */
export const pxToCharWidth = (px) => Math.round(((px - 5) / MDW) * 10000) / 10000;

/** Excel 欄寬（字元數）→ LayoutSpec 的欄寬（dxa）。 */
export const charWidthToDxa = (w) => Math.round(charWidthToPx(w) * DXA_PER_PX);
/** LayoutSpec 的欄寬（dxa）→ Excel 欄寬（字元數）。 */
export const dxaToCharWidth = (dxa) => pxToCharWidth(dxa / DXA_PER_PX);

/** Excel 列高（pt）→ LayoutSpec 的列高（twips）。 */
export const ptToTwips = (pt) => Math.round(pt * TWIPS_PER_PT);
/** LayoutSpec 的列高（twips）→ Excel 列高（pt）。 */
export const twipsToPt = (tw) => Math.round((tw / TWIPS_PER_PT) * 100) / 100;

/** 頁面邊界：Excel 用英吋，LayoutSpec 用 twips。 */
export const inchToTwips = (inch) => Math.round(inch * TWIPS_PER_INCH);
export const twipsToInch = (tw) => Math.round((tw / TWIPS_PER_INCH) * 1e6) / 1e6;

/** 欄索引（0 起算）→ 欄名（A、B、…、AA）。 */
export function colName(i) {
  let n = i + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** 欄名 → 欄索引（0 起算）。 */
export function colIndex(name) {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 儲存格位址 'B12' → { col: 1, row: 11 }（都是 0 起算）。認不出來回 null。 */
export function parseRef(ref) {
  const m = /^([A-Za-z]+)(\d+)$/.exec(String(ref ?? '').trim());
  if (!m) return null;
  return { col: colIndex(m[1]), row: Number(m[2]) - 1 };
}

/** { col, row } → 'B12'。 */
export const cellRef = (col, row) => `${colName(col)}${row + 1}`;

/** 合併範圍 'A1:B1' → { c1, r1, c2, r2 }（0 起算，含頭含尾）。認不出來回 null。 */
export function parseRange(ref) {
  const [a, b] = String(ref ?? '').split(':');
  const from = parseRef(a);
  const to = parseRef(b ?? a);
  if (!from || !to) return null;
  return {
    c1: Math.min(from.col, to.col),
    r1: Math.min(from.row, to.row),
    c2: Math.max(from.col, to.col),
    r2: Math.max(from.row, to.row),
  };
}

/** XML 文字跳脫（輸出用）。 */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
