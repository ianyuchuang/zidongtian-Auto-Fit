// 依 LayoutSpec 直接畫出 PDF（vendor/pdf-lib + fontkit），把這次要輸出的每一份 Word 的每一頁
// 重畫一次、接成同一份 PDF。版面規則跟 docx-export.js 共用 template/spec.js。
//
// 注意：Word 那邊的排版是 Word 自己算的，這裡是我們自己畫，行高／字距會有極細微差異；
// 版面（頁面大小、邊界、欄寬、列高、字級、對齊、照片尺寸）都照同一份 spec，所以看起來會一樣。
// 幾何計算全部寫成純函式（吃一個 metrics 物件），方便在 node 裡測。

import { renderForDocx } from './imaging.js';
import { defaultSpec, fitPhoto, tableCols, layoutPages, cellText, cellColumns, validateSpec } from './template/spec.js';
import { headingText } from './docx-export.js';

export const TWIP = 1 / 20; // dxa / twips → pt
export const PX = 0.75; // CSS px（96dpi）→ pt
export const CELL_PAD_X = 108 * TWIP; // Word 預設格子左右內距 108 dxa
export const HEADER_DIST = 720 * TWIP; // Word 預設頁首距頂 720 twips
export const BORDER_W = 0.5; // 表格框線粗細（pt）

function lib() {
  if (!globalThis.PDFLib) throw new Error('pdf-lib 沒有載入（vendor/pdf-lib-1.17.1.min.js）');
  return globalThis.PDFLib;
}
function fontkitLib() {
  if (!globalThis.fontkit) throw new Error('fontkit 沒有載入（vendor/fontkit-1.1.1.umd.min.js）');
  return globalThis.fontkit;
}

/** 一段字串裡的 \n＝段落內換行，拆成實際要畫的每一行。 */
export const wrapLines = (text) => String(text ?? '').split('\n');

/** 表格每一欄的左緣與寬（pt），含 tableIndent。 */
export function columnGeometry(spec, leftPt) {
  const cols = tableCols(spec).map((d) => d * TWIP);
  const x = [];
  let cur = leftPt + (spec.grid.tableIndent ?? 0) * TWIP;
  for (const w of cols) {
    x.push(cur);
    cur += w;
  }
  return { x, w: cols, right: cur };
}

/**
 * 一頁裡所有格子的位置（還沒算高度）。
 * pageRows＝layoutPages() 的一頁：[區塊列][格] 的照片（null＝空格）。
 */
export function buildPageCells(spec, pageRows) {
  const R = spec.block.rows.length;
  const blockCols = spec.block.cols.length;
  const out = [];
  pageRows.forEach((slotPhotos, b) => {
    spec.block.rows.forEach((br, k) => {
      const cols = cellColumns(br);
      slotPhotos.forEach((photo, s) => {
        (br.cells ?? []).forEach((cell, ci) => {
          out.push({
            r: b * R + k,
            c: s * blockCols + cols[ci],
            colSpan: cell.colSpan ?? 1,
            rowSpan: cell.rowSpan ?? 1,
            cell,
            photo,
          });
        });
      });
    });
  });
  return out;
}

/**
 * 每一列的高度（pt）：先取版型寫的列高（Word 的 ATLEAST），內容更高就把最後一列撐開。
 * heightOf(cellDef) → 這一格內容要的高度（pt）。
 */
export function computeRowHeights(spec, pageRows, cells, heightOf) {
  const R = spec.block.rows.length;
  const n = pageRows.length * R;
  const h = new Array(n).fill(0);
  for (let i = 0; i < n; i++) h[i] = (spec.block.rows[i % R].h ?? 0) * TWIP;
  for (const cd of cells) {
    const span = Math.max(1, Math.min(cd.rowSpan, n - cd.r));
    let have = 0;
    for (let i = 0; i < span; i++) have += h[cd.r + i];
    const need = heightOf(cd);
    if (need > have) h[cd.r + span - 1] += need - have;
  }
  return h;
}

/** 抬頭要佔的高度（pt）。metrics.lineHeight(sizePt) → 一行的高。 */
export function headingHeight(spec, metrics) {
  return (spec.heading?.lines ?? []).reduce((sum, l) => sum + wrapLines(l.text).length * metrics.lineHeight(l.sizePt ?? 14), 0);
}

/**
 * 內文（表格）從頁面上緣往下多少 pt 開始。
 * 抬頭在頁首時 Word 會把內文往下推到頁首之下；在內文時抬頭自己佔位置。
 */
export function bodyTop(spec, metrics) {
  const margin = spec.page.margin.t * TWIP;
  if (spec.heading?.place === 'body') return margin;
  return Math.max(margin, HEADER_DIST + headingHeight(spec, metrics));
}

/** 這一頁排得下嗎（表格底部有沒有超出下邊界）。 */
export function pageOverflow(spec, metrics, rowHeights) {
  const top = bodyTop(spec, metrics) + (spec.heading?.place === 'body' ? headingHeight(spec, metrics) : 0);
  const bottom = spec.page.h * TWIP - spec.page.margin.b * TWIP;
  const used = rowHeights.reduce((a, b) => a + b, 0);
  return Math.max(0, top + used - bottom);
}

const alignX = (align, x, w, textW) => (align === 'center' ? x + (w - textW) / 2 : align === 'right' ? x + w - textW : x);

/**
 * 產生一份 PDF Blob。
 * groups: [{ folderName, photos, rocDisplay, rocPhotoDate, stamp }]（照 Word 的輸出順序）
 * fontBytes: Uint8Array（pdf-font.js 取得）
 */
export async function buildPdfBlob(groups, { spec = defaultSpec(), fontBytes, render = renderForDocx, onProgress } = {}) {
  const errs = validateSpec(spec);
  if (errs.length) throw new Error(`版型不完整，無法輸出 PDF：${errs.join('；')}`);
  if (!fontBytes || !fontBytes.length) throw new Error('沒有可嵌入的中文字型');

  const { PDFDocument, rgb } = lib();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkitLib());
  let font;
  try {
    font = await doc.embedFont(fontBytes, { subset: true });
  } catch (e) {
    throw new Error(`字型嵌入失敗：${e.message}`);
  }
  const metrics = {
    lineHeight: (sizePt) => font.heightAtSize(sizePt),
    ascent: (sizePt) => font.heightAtSize(sizePt, { descender: false }),
    widthOf: (text, sizePt) => font.widthOfTextAtSize(String(text ?? ''), sizePt),
  };

  const pageW = spec.page.w * TWIP;
  const pageH = spec.page.h * TWIP;
  const marginL = spec.page.margin.l * TWIP;
  const marginR = spec.page.margin.r * TWIP;
  const black = rgb(0, 0, 0);
  const failures = [];
  const warnings = [];

  const drawText = (page, text, size, { x, w, top, align }) => {
    const lines = wrapLines(text);
    let y = top;
    for (const ln of lines) {
      const tw = metrics.widthOf(ln, size);
      if (ln) page.drawText(ln, { x: alignX(align ?? 'left', x, w, tw), y: pageH - (y + metrics.ascent(size)), size, font, color: black });
      y += metrics.lineHeight(size);
    }
    return y - top;
  };

  const drawHeading = (page, rocDisplay, top) => {
    let y = top;
    for (const l of spec.heading?.lines ?? []) {
      y += drawText(page, headingText(l.text, rocDisplay), l.sizePt ?? 14, {
        x: marginL,
        w: pageW - marginL - marginR,
        top: y,
        align: l.align ?? 'center',
      });
    }
    return y - top;
  };

  const inHeader = spec.heading?.place !== 'body';
  const top0 = bodyTop(spec, metrics);
  let totalPages = 0;

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    // 先把照片畫好（加日期戳）並嵌進 PDF；render 由外面帶進來，跟 Word 那邊共用快取。
    const byPhoto = new Map();
    for (let i = 0; i < g.photos.length; i++) {
      const p = g.photos[i];
      let img = null;
      let size = null;
      try {
        const r = await render(p.file, { stamp: spec.stamp?.on ? g.stamp : '' });
        img = await doc.embedJpg(r.data);
        const fit = fitPhoto(spec, r.width, r.height);
        size = { w: fit.width * PX, h: fit.height * PX };
      } catch (e) {
        failures.push(`${p.name}：${e.message}`);
      }
      byPhoto.set(p, { img, size, ctx: { seq: i + 1, photoDate: g.rocPhotoDate || '' } });
      onProgress?.({ group: gi + 1, groups: groups.length, i: i + 1, n: g.photos.length, folder: g.folderName });
    }

    const heightOf = (cd) => {
      const size = cd.cell.sizePt ?? spec.caption.sizePt;
      if (cd.cell.kind === 'photo') return byPhoto.get(cd.photo)?.size?.h ?? (cd.photo ? metrics.lineHeight(size) : 0);
      if (!cd.photo) return 0;
      const lines = cellText(cd.cell, cd.photo, byPhoto.get(cd.photo)?.ctx ?? {});
      return lines.reduce((sum, t) => sum + wrapLines(t).length * metrics.lineHeight(size), 0);
    };

    for (const pageRows of layoutPages(spec, g.photos)) {
      const page = doc.addPage([pageW, pageH]);
      totalPages += 1;
      let y = top0;
      if (inHeader) drawHeading(page, g.rocDisplay, HEADER_DIST);
      else y += drawHeading(page, g.rocDisplay, y);

      const cells = buildPageCells(spec, pageRows);
      const heights = computeRowHeights(spec, pageRows, cells, heightOf);
      const over = pageOverflow(spec, metrics, heights);
      if (over > 1) warnings.push(`${g.folderName}：有一頁的表格比版面高 ${Math.round(over)}pt，PDF 裡會超出下邊界。`);
      const rowTop = [y];
      for (const h of heights) rowTop.push(rowTop[rowTop.length - 1] + h);
      const geo = columnGeometry(spec, marginL);

      for (const cd of cells) {
        const span = Math.max(1, Math.min(cd.colSpan, geo.x.length - cd.c));
        const rspan = Math.max(1, Math.min(cd.rowSpan, heights.length - cd.r));
        const x = geo.x[cd.c];
        let w = 0;
        for (let i = 0; i < span; i++) w += geo.w[cd.c + i];
        const yTop = rowTop[cd.r];
        const h = rowTop[cd.r + rspan] - yTop;
        page.drawRectangle({ x, y: pageH - yTop - h, width: w, height: h, borderWidth: BORDER_W, borderColor: black });
        if (!cd.photo) continue;

        const inner = { x: x + CELL_PAD_X, w: Math.max(0, w - CELL_PAD_X * 2) };
        const size = cd.cell.sizePt ?? spec.caption.sizePt;
        const vAlign = cd.cell.vAlign ?? 'center';
        const place = (contentH) => (vAlign === 'top' ? yTop : vAlign === 'bottom' ? yTop + h - contentH : yTop + (h - contentH) / 2);

        if (cd.cell.kind === 'photo') {
          const got = byPhoto.get(cd.photo);
          if (got?.img && got.size) {
            const iw = Math.min(got.size.w, inner.w);
            const ih = got.size.h * (iw / got.size.w);
            const ix = alignX(cd.cell.align ?? 'center', inner.x, inner.w, iw);
            page.drawImage(got.img, { x: ix, y: pageH - place(ih) - ih, width: iw, height: ih });
          } else {
            drawText(page, `[無法插入照片: ${cd.photo.name}]`, size, { ...inner, top: place(metrics.lineHeight(size)), align: 'left' });
          }
          continue;
        }
        const lines = cellText(cd.cell, cd.photo, byPhoto.get(cd.photo)?.ctx ?? {});
        const contentH = lines.reduce((s, t) => s + wrapLines(t).length * metrics.lineHeight(size), 0);
        let ty = place(contentH);
        for (const t of lines) ty += drawText(page, t, size, { ...inner, top: ty, align: cd.cell.align ?? 'left' });
      }
    }
  }

  if (!totalPages) throw new Error('沒有可輸出的頁面');
  const bytes = await doc.save();
  return { blob: new Blob([bytes], { type: 'application/pdf' }), failures, warnings, pages: totalPages };
}
