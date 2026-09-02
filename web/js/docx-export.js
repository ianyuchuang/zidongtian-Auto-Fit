// 用 docx 函式庫（vendor/docx-*.iife.js，全域 window.docx）產生與 V1.0 相同版面的 Word 檔。
// 版面規則與常數在 docx-model.js；這裡只負責把它轉成 docx 物件。

import { COMPANY, TITLE, FONT, LAYOUT, fitPhoto, captionLines, pairRows } from './docx-model.js';
import { renderForDocx } from './imaging.js';

function lib() {
  if (!globalThis.docx) throw new Error('docx 函式庫沒有載入（vendor/docx-9.7.1.iife.js）');
  return globalThis.docx;
}

const FONTS = { ascii: FONT, hAnsi: FONT, eastAsia: FONT, cs: FONT };

function textPara(text, halfPt, { align } = {}) {
  const { Paragraph, TextRun, AlignmentType } = lib();
  return new Paragraph({
    alignment: align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before: 0, after: 0 },
    children: [new TextRun({ text, size: halfPt, font: FONTS })],
  });
}

function photoCell(rendered, photo) {
  const { Paragraph, TableCell, ImageRun, AlignmentType, VerticalAlign, WidthType } = lib();
  let children;
  if (rendered) {
    const size = fitPhoto(rendered.width, rendered.height);
    children = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        children: [new ImageRun({ type: rendered.type, data: rendered.data, transformation: size })],
      }),
    ];
  } else {
    children = [textPara(`[無法插入照片: ${photo.name}]`, LAYOUT.captionHalfPt)];
  }
  return new TableCell({
    width: { size: LAYOUT.cellW, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    children,
  });
}

function captionCell(photo) {
  const { TableCell, WidthType } = lib();
  return new TableCell({
    width: { size: LAYOUT.cellW, type: WidthType.DXA },
    children: (photo ? captionLines(photo) : ['']).map((l) => textPara(l, LAYOUT.captionHalfPt)),
  });
}

function emptyCell() {
  const { TableCell, Paragraph, WidthType } = lib();
  return new TableCell({ width: { size: LAYOUT.cellW, type: WidthType.DXA }, children: [new Paragraph('')] });
}

/**
 * 產生一份 docx Blob。
 * group: { photos: [{name, file, desc, design, actual}] }（表格順序）
 * opts: { rocDisplay: '115年07月25日', stamp: '2026-07-25', onProgress(i, n), render }
 * render(file, {stamp}) 預設用 canvas（imaging.js），測試時可換成不需瀏覽器的版本。
 */
export async function buildDocxBlob(group, { rocDisplay, stamp, onProgress, render = renderForDocx } = {}) {
  const { Document, Packer, Table, TableRow, Header, WidthType, HeightRule } = lib();
  const photos = group.photos;
  const rendered = [];
  const failures = [];
  for (let i = 0; i < photos.length; i++) {
    try {
      rendered.push(await render(photos[i].file, { stamp }));
    } catch (e) {
      rendered.push(null);
      failures.push(`${photos[i].name}：${e.message}`);
    }
    onProgress?.(i + 1, photos.length);
  }

  const rows = [];
  for (const pair of pairRows(photos)) {
    const idx = pair.map((p) => photos.indexOf(p));
    rows.push(
      new TableRow({
        height: { value: LAYOUT.photoRowH, rule: HeightRule.ATLEAST },
        children: [0, 1].map((c) => (pair[c] ? photoCell(rendered[idx[c]], pair[c]) : emptyCell())),
      }),
    );
    rows.push(new TableRow({ children: [0, 1].map((c) => (pair[c] ? captionCell(pair[c]) : emptyCell())) }));
  }

  const table = new Table({
    rows,
    width: { size: LAYOUT.cellW * 2, type: WidthType.DXA },
    columnWidths: [LAYOUT.cellW, LAYOUT.cellW],
    indent: { size: LAYOUT.tableIndent, type: WidthType.DXA },
  });

  const doc = new Document({
    styles: { default: { document: { run: { font: FONTS, size: LAYOUT.captionHalfPt } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: LAYOUT.pageW, height: LAYOUT.pageH },
            margin: { top: LAYOUT.marginT, right: LAYOUT.marginR, bottom: LAYOUT.marginB, left: LAYOUT.marginL },
          },
        },
        headers: {
          default: new Header({
            children: [
              textPara(COMPANY, LAYOUT.headerHalfPt, { align: 'center' }),
              textPara(`${TITLE}(檢查日期：${rocDisplay})`, LAYOUT.headerHalfPt, { align: 'center' }),
            ],
          }),
        },
        children: [table],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  return { blob, failures };
}
