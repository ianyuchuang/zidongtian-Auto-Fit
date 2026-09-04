// 用 docx 函式庫（vendor/docx-*.iife.js，全域 window.docx）依 LayoutSpec 產生 Word 檔。
// 版面規則與預設值在 template/spec.js；這裡只負責把 spec 轉成 docx 物件。

import { renderForDocx } from './imaging.js';
import { defaultSpec, fitPhoto, tableCols, blockWidth, layoutPages, cellText, cellColumns, validateSpec } from './template/spec.js';

function lib() {
  if (!globalThis.docx) throw new Error('docx 函式庫沒有載入（vendor/docx-9.7.1.iife.js）');
  return globalThis.docx;
}

const fontsOf = (spec) => ({ ascii: spec.font, hAnsi: spec.font, eastAsia: spec.font, cs: spec.font });

function textPara(spec, text, halfPt, { align, bold, pageBreakBefore } = {}) {
  const { Paragraph, TextRun, AlignmentType } = lib();
  return new Paragraph({
    alignment: { center: AlignmentType.CENTER, right: AlignmentType.RIGHT }[align] ?? AlignmentType.LEFT,
    spacing: { before: 0, after: 0 },
    pageBreakBefore: !!pageBreakBefore,
    // 字串裡的 \n 是段落內的換行（Word 的 Shift+Enter）：拆成多個 run，第二個起加 break
    children: String(text)
      .split('\n')
      .map((t, i) => new TextRun({ text: t, size: halfPt, bold: !!bold, font: fontsOf(spec), ...(i ? { break: 1 } : {}) })),
  });
}

/** 一個格子橫跨的欄寬總和（dxa）。col＝這個格子從區塊的第幾欄開始。 */
/** 抬頭文字：每個 {date} 都換成檢查日期（一行裡可能出現不只一次）。 */
export const headingText = (text, rocDisplay) => String(text ?? '').replaceAll('{date}', rocDisplay ?? '');

function cellWidth(spec, col, span) {
  let w = 0;
  for (let i = col; i < col + span && i < spec.block.cols.length; i++) w += spec.block.cols[i];
  return w;
}

function buildCell(spec, cell, col, { photo, rendered, ctx }) {
  const { Paragraph, TableCell, ImageRun, AlignmentType, VerticalAlign, WidthType } = lib();
  const span = cell.colSpan ?? 1;
  const halfPt = (cell.sizePt ?? spec.caption.sizePt) * 2;
  let children;
  if (cell.kind === 'photo') {
    if (rendered) {
      const size = fitPhoto(spec, rendered.width, rendered.height);
      children = [
        new Paragraph({
          // 照片格的水平對齊照版型頁右鍵選的；沒寫就置中（解析與預設版型都寫 center）
          alignment: { left: AlignmentType.LEFT, right: AlignmentType.RIGHT }[cell.align] ?? AlignmentType.CENTER,
          spacing: { before: 0, after: 0 },
          children: [new ImageRun({ type: rendered.type, data: rendered.data, transformation: size })],
        }),
      ];
    } else if (photo) {
      children = [textPara(spec, `[無法插入照片: ${photo.name}]`, halfPt)];
    } else {
      children = [new Paragraph('')];
    }
  } else if (photo) {
    children = cellText(cell, photo, ctx).map((l) => textPara(spec, l, halfPt, { align: cell.align, bold: cell.bold }));
  } else {
    children = [new Paragraph('')]; // 這一格沒排到照片：留白，不印空的欄位名
  }
  const opts = { width: { size: cellWidth(spec, col, span), type: WidthType.DXA }, children };
  if (span > 1) opts.columnSpan = span;
  if ((cell.rowSpan ?? 1) > 1) opts.rowSpan = cell.rowSpan;
  // 每一格預設垂直置中（照詠郁手改的正確版：文字格也置中，不是靠上）；要靠上／靠下得在版型頁的右鍵選單指定
  opts.verticalAlign = { top: VerticalAlign.TOP, bottom: VerticalAlign.BOTTOM }[cell.vAlign] ?? VerticalAlign.CENTER;
  return new TableCell(opts);
}

/** 一個區塊列（perRow 張照片）展開成 spec.block.rows.length 個 TableRow。 */
function buildBlockRows(spec, slotPhotos, byPhoto) {
  const { TableRow, HeightRule } = lib();
  return spec.block.rows.map((br) => {
    const cols = cellColumns(br);
    const children = [];
    for (const photo of slotPhotos) {
      (br.cells ?? []).forEach((cell, i) => {
        children.push(buildCell(spec, cell, cols[i], photo ? byPhoto.get(photo) : { photo: null }));
      });
    }
    const opts = { children };
    if (br.h) opts.height = { value: br.h, rule: HeightRule.ATLEAST };
    return new TableRow(opts);
  });
}

/**
 * 產生一份 docx Blob。
 * group: { photos: [{name, file, desc, design, actual}] }（表格順序）
 * opts: { spec, rocDisplay: '115年07月25日', rocPhotoDate: '115.7.25', stamp: '2026-07-25', onProgress(i, n), render }
 * rocPhotoDate＝該資料夾的檢查日期；版型的「拍照日期」一律填它（不讀照片 EXIF，全案統一用資料夾列的日期格）。
 * render(file, {stamp}) 預設用 canvas（imaging.js），測試時可換成不需瀏覽器的版本。
 */
export async function buildDocxBlob(group, { spec = defaultSpec(), rocDisplay, rocPhotoDate, stamp, onProgress, render = renderForDocx } = {}) {
  const { Document, Packer, Table, Header, WidthType } = lib();
  const errs = validateSpec(spec);
  if (errs.length) throw new Error(`版型不完整，無法輸出：${errs.join('；')}`);

  const photos = group.photos;
  const stampText = spec.stamp?.on ? stamp : '';
  const byPhoto = new Map();
  const failures = [];
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    let rendered = null;
    try {
      rendered = await render(p.file, { stamp: stampText });
    } catch (e) {
      failures.push(`${p.name}：${e.message}`);
    }
    byPhoto.set(p, { photo: p, rendered, ctx: { seq: i + 1, photoDate: rocPhotoDate || '' } });
    onProgress?.(i + 1, photos.length);
  }

  const pages = layoutPages(spec, photos);
  const cols = tableCols(spec);
  const makeTable = (pageRows) =>
    new Table({
      rows: pageRows.flatMap((slotPhotos) => buildBlockRows(spec, slotPhotos, byPhoto)),
      width: { size: blockWidth(spec) * spec.grid.perRow, type: WidthType.DXA },
      columnWidths: cols,
      indent: { size: spec.grid.tableIndent ?? 0, type: WidthType.DXA },
    });

  // pageBreakBefore：抬頭在內文時，第 2 頁起強制分頁，抬頭才會落在每頁最上面。
  const headingParas = ({ pageBreakBefore = false } = {}) =>
    (spec.heading?.lines ?? []).map((l, i) =>
      textPara(spec, headingText(l.text, rocDisplay), (l.sizePt ?? 14) * 2, {
        align: l.align ?? 'center',
        bold: l.bold,
        pageBreakBefore: pageBreakBefore && i === 0,
      }),
    );
  const inHeader = spec.heading?.place !== 'body';

  // 一律一頁一張表、第 2 頁起強制分頁：每頁幾張由 spec.grid 決定，不交給 Word 依高度自己排。
  // （2026-09-04 修：抬頭在頁首時原本整份一張表，2 列 × 2 張的版型列高只有 6.7cm，
  //   A4 塞得下 3 列，Word 就自己排成 3 × 2。）
  // 抬頭在內文：每張表前面各放一組抬頭，分頁掛在抬頭第一段。
  // 抬頭在頁首：表格之間放一個 1pt 的空段落掛分頁（Word 的分頁只能掛在段落上，
  //   而且兩張表中間沒有段落的話 Word 會把它們併成同一張表）。
  const children = [];
  const list = pages.length ? pages : [[]];
  list.forEach((page, i) => {
    if (!inHeader) children.push(...headingParas({ pageBreakBefore: i > 0 }));
    else if (i > 0) children.push(textPara(spec, '', 2, { pageBreakBefore: true }));
    children.push(makeTable(page));
  });

  // docx 函式庫在 landscape 時會自己把長寬對調，所以這裡要餵「轉正前」的尺寸。
  const landscape = spec.page.orient === 'landscape';
  const size = landscape
    ? { width: spec.page.h, height: spec.page.w, orientation: 'landscape' }
    : { width: spec.page.w, height: spec.page.h, orientation: 'portrait' };

  const section = {
    properties: {
      page: {
        size,
        margin: { top: spec.page.margin.t, right: spec.page.margin.r, bottom: spec.page.margin.b, left: spec.page.margin.l },
      },
    },
    children,
  };
  if (inHeader) section.headers = { default: new Header({ children: headingParas() }) };

  const doc = new Document({
    styles: { default: { document: { run: { font: fontsOf(spec), size: spec.caption.sizePt * 2 } } } },
    sections: [section],
  });

  const blob = await Packer.toBlob(doc);
  return { blob, failures };
}
