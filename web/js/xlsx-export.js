// 依同一份 LayoutSpec 產生 Excel 檔（.xlsx）。與 docx-export.js 是兩支平行的輸出器：
// 版面規則與預設值都在 template/spec.js，這裡只負責把 spec 轉成 SpreadsheetML。
// 打包用 zip.js（瀏覽器內建 CompressionStream），不外掛 Excel 函式庫。
//
// 與 Word 版的差別（見 docs/版型.md）：
// - Excel 沒有「頁首每頁重印」：抬頭一律當成列，每一頁的最上面各印一次。
// - 分頁靠 rowBreaks（強制分頁），不交給 Excel 依高度自己排。
// - 照片是浮動圖片（oneCellAnchor）疊在照片格上；日期戳跟 Word 一樣烙進照片本身。
// - 儲存格高度不會自己長高，所以照片列／說明列會取「版型高度」與「內容需要的高度」的大值。

import { renderForDocx } from './imaging.js';
import { defaultSpec, fitPhoto, layoutPages, cellText, cellColumns, validateSpec, EMU_PER_PX } from './template/spec.js';
import { headingText } from './docx-export.js';
import { colName, dxaToCharWidth, esc, twipsToInch, twipsToPt, DXA_PER_PX } from './template/xlsx.js';
import { zipBlob } from './zip.js';

const EMU_PER_PT = 12700;
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

// Excel 的 paperSize：紙張寬（twips，直式）→ 代號。認不得的就不寫 paperSize，交給印表機預設。
const PAPER_CODE = [
  [11906, 16838, 9], // A4
  [16838, 23811, 8], // A3
  [8391, 11906, 11], // A5
  [12240, 15840, 1], // Letter
];

function paperSizeOf(page) {
  const w = page.orient === 'landscape' ? page.h : page.w;
  const h = page.orient === 'landscape' ? page.w : page.h;
  return PAPER_CODE.find(([pw, ph]) => Math.abs(pw - w) < 40 && Math.abs(ph - h) < 40)?.[2] ?? null;
}

// ---------- 樣式表 ----------

/** 收集用到的字型／對齊組合，產生 styles.xml，並給每個組合一個 cellXf 索引。 */
function styleSheet(font) {
  // 0 號是「一般」樣式的字型，**一定要是 Calibri 11**：Excel 的欄寬單位是「幾個字元」，
  // 換算成像素時用的就是這個字型的數字寬（MDW＝7px）。放成標楷體的話，Excel／LibreOffice
  // 會用不同的 MDW 重算，欄就會變寬、兩欄擠不下一頁而被拆成左右兩頁（2026-09-10 的 bug）。
  // 每一格自己的字型（標楷體）寫在各自的 xf 上，不受這一項影響。
  const NORMAL = { sizePt: 11, bold: false, name: 'Calibri' };
  const fonts = [NORMAL];
  const xfs = [{ font: 0, align: null, vAlign: null, wrap: false, border: 0 }];
  const keyOf = (o) => `${o.sizePt}|${o.bold}|${o.align}|${o.vAlign}|${o.wrap}|${o.border}`;
  const seen = new Map([[keyOf({ sizePt: 11, bold: false, align: null, vAlign: null, wrap: false, border: 0 }), 0]]);

  function id({ sizePt = 11, bold = false, align = null, vAlign = null, wrap = false, border = 0 } = {}) {
    const o = { sizePt, bold, align, vAlign, wrap, border };
    const k = keyOf(o);
    if (seen.has(k)) return seen.get(k);
    let fi = fonts.findIndex((f) => f.sizePt === sizePt && f.bold === bold && f.name === font);
    if (fi < 0) fi = fonts.push({ sizePt, bold, name: font }) - 1;
    const i = xfs.push({ ...o, font: fi }) - 1;
    seen.set(k, i);
    return i;
  }

  function xml() {
    const fontXml = fonts
      .map((f) => `<font><sz val="${f.sizePt}"/>${f.bold ? '<b/>' : ''}<name val="${esc(f.name)}"/><family val="4"/><charset val="136"/></font>`)
      .join('');
    // 0＝無框、1＝四邊細框
    const borders =
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right>' +
      '<top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>';
    const xfXml = xfs
      .map((x) => {
        const al = x.align || x.vAlign || x.wrap;
        const a = al
          ? `<alignment${x.align ? ` horizontal="${x.align}"` : ''}${x.vAlign ? ` vertical="${x.vAlign}"` : ''}${x.wrap ? ' wrapText="1"' : ''}/>`
          : '';
        return `<xf numFmtId="0" fontId="${x.font}" fillId="0" borderId="${x.border}" xfId="0" applyFont="1" applyBorder="1"${al ? ' applyAlignment="1"' : ''}>${a}</xf>`;
      })
      .join('');
    return (
      `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">` +
      `<fonts count="${fonts.length}">${fontXml}</fonts>` +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      borders +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${xfs.length}">${xfXml}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="一般" xfId="0" builtinId="0"/></cellStyles>' +
      '<dxfs count="0"/><tableStyles count="0"/>' +
      '</styleSheet>'
    );
  }

  return { id, xml };
}

// ---------- 版面規劃：把每一頁攤成「工作表的列」 ----------

/**
 * 抬頭的連續同款式行併成一格（樣本檔就是兩行擠在同一格）。
 * 回傳 [{ lines:[文字…], sizePt, bold, align }]。
 */
function headingBlocks(spec, rocDisplay) {
  const out = [];
  for (const l of spec.heading?.lines ?? []) {
    const sizePt = l.sizePt ?? 14;
    const bold = !!l.bold;
    const align = l.align ?? 'center';
    const text = headingText(l.text, rocDisplay);
    const last = out[out.length - 1];
    if (last && last.sizePt === sizePt && last.bold === bold && last.align === align) last.lines.push(text);
    else out.push({ lines: [text], sizePt, bold, align });
  }
  return out;
}

const lineCount = (s) => String(s ?? '').split('\n').length;

// ---------- 主流程 ----------

/**
 * 產生一份 xlsx Blob。參數與 buildDocxBlob 一致。
 * group: { photos: [{name, file, desc, design, actual}] }（表格順序）
 * opts: { spec, rocDisplay, rocPhotoDate, stamp, onProgress(i, n), render }
 */
export async function buildXlsxBlob(group, { spec = defaultSpec(), rocDisplay, rocPhotoDate, stamp, onProgress, render = renderForDocx } = {}) {
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

  const st = styleSheet(spec.font);
  const nCols = spec.block.cols.length;
  const perRow = spec.grid.perRow;
  const totalCols = nCols * perRow;
  const colPx = [];
  for (let i = 0; i < perRow; i++) for (const dxa of spec.block.cols) colPx.push(dxa / DXA_PER_PX);
  const colEmu = colPx.map((px) => px * EMU_PER_PX);

  const rowsXml = [];
  const merges = [];
  const anchors = [];
  const media = []; // { name, data, type }
  const mediaByRendered = new Map();
  const breaks = [];
  let rowIdx = 0; // 0 起算的工作表列

  const heads = headingBlocks(spec, rocDisplay);
  const pages = layoutPages(spec, photos);
  const list = pages.length ? pages : [[]];

  for (let pi = 0; pi < list.length; pi++) {
    // ---- 抬頭：每頁都印一次 ----
    for (const h of heads) {
      const s = st.id({ sizePt: h.sizePt, bold: h.bold, align: h.align, vAlign: 'center', wrap: true, border: 0 });
      const text = h.lines.join('\n');
      rowsXml.push(row(rowIdx, Math.ceil(h.lines.length * h.sizePt * 1.5), [cellXml(0, rowIdx, s, text)]));
      if (totalCols > 1) merges.push(`${colName(0)}${rowIdx + 1}:${colName(totalCols - 1)}${rowIdx + 1}`);
      rowIdx++;
    }

    // ---- 區塊列 ----
    // 先算好這一組（perRow 張）每一列的高度再放格子：Excel 的列不會自己長高，而跨列合併的
    // 照片格不能把高度全算在第一列上（會把整個區塊撐成好幾倍高）——不夠的部分補在最後一列。
    for (const slotPhotos of list[pi]) {
      const blockTop = rowIdx;
      const heights = spec.block.rows.map((r) => (r.h ? twipsToPt(r.h) : 0));
      const rowCells = spec.block.rows.map(() => []);
      const placed = []; // 這一組要放的照片

      spec.block.rows.forEach((brow, br) => {
        const cols = cellColumns(brow);
        for (let b = 0; b < perRow; b++) {
          const photo = slotPhotos[b] ?? null;
          const info = photo ? byPhoto.get(photo) : null;
          (brow.cells ?? []).forEach((cell, ci) => {
            const col = b * nCols + cols[ci];
            const colSpan = cell.colSpan ?? 1;
            const rowSpan = cell.rowSpan ?? 1;
            const sizePt = cell.sizePt ?? spec.caption.sizePt;
            const s = st.id({
              sizePt,
              bold: !!cell.bold,
              align: cell.align ?? (cell.kind === 'photo' ? 'center' : 'left'),
              vAlign: cell.vAlign ?? 'center',
              wrap: cell.kind !== 'photo',
              border: 1,
            });
            const r0 = blockTop + br;
            if (colSpan > 1 || rowSpan > 1) {
              merges.push(`${colName(col)}${r0 + 1}:${colName(col + colSpan - 1)}${r0 + rowSpan}`);
            }
            if (cell.kind === 'photo') {
              if (info?.rendered) {
                placed.push({ br, col, colSpan, rowSpan, box: fitPhoto(spec, info.rendered.width, info.rendered.height), align: cell.align ?? 'center', vAlign: cell.vAlign ?? 'center', rendered: info.rendered });
                rowCells[br].push(cellXml(col, r0, s, ''));
              } else {
                // 照片畫不出來就把原因寫在格子裡，不要靜靜留白
                rowCells[br].push(cellXml(col, r0, s, photo ? `[無法插入照片: ${photo.name}]` : ''));
              }
              return;
            }
            const text = photo ? cellText(cell, photo, info.ctx).join('\n') : '';
            rowCells[br].push(cellXml(col, r0, s, text));
            // 跨列的文字格由它自己那幾列的總高吸收，不把高度全算在第一列
            if (text && rowSpan === 1) heights[br] = Math.max(heights[br], lineCount(text) * sizePt * 1.45 + 3);
          });
        }
      });

      // 照片要塞得下：整個跨列範圍的總高不夠就補在最後一列
      for (const a of placed) {
        const need = (a.box.height * EMU_PER_PX) / EMU_PER_PT + 2;
        let have = 0;
        for (let r = a.br; r < a.br + a.rowSpan && r < heights.length; r++) have += heights[r];
        const last = Math.min(a.br + a.rowSpan, heights.length) - 1;
        if (have < need) heights[last] += need - have;
      }
      for (const a of placed) anchors.push({ ...a, row: blockTop + a.br, heights });

      spec.block.rows.forEach((_, br) => {
        rowsXml.push(row(blockTop + br, Math.ceil(heights[br]) || null, rowCells[br]));
      });
      rowIdx = blockTop + spec.block.rows.length;
    }
    // 最後一頁後面不必分頁
    if (pi < list.length - 1) breaks.push(rowIdx);
  }

  // ---- 照片（浮動圖片）----
  const anchorXml = anchors.map((a, i) => {
    let key = a.rendered;
    if (!mediaByRendered.has(key)) {
      const ext = a.rendered.type === 'png' ? 'png' : 'jpeg';
      const name = `image${media.length + 1}.${ext}`;
      media.push({ name, data: a.rendered.data, ext });
      mediaByRendered.set(key, media.length); // 1 起算＝rId 編號
    }
    const rid = mediaByRendered.get(key);
    const cx = Math.round(a.box.width * EMU_PER_PX);
    const cy = Math.round(a.box.height * EMU_PER_PX);
    let boxW = 0;
    for (let c = a.col; c < a.col + a.colSpan && c < colEmu.length; c++) boxW += colEmu[c];
    let boxH = 0;
    for (let r = a.br; r < a.br + a.rowSpan && r < a.heights.length; r++) boxH += a.heights[r] * EMU_PER_PT;
    const offX = Math.max(0, Math.round(a.align === 'left' ? 0 : a.align === 'right' ? boxW - cx : (boxW - cx) / 2));
    const offY = Math.max(0, Math.round(a.vAlign === 'top' ? 0 : a.vAlign === 'bottom' ? boxH - cy : (boxH - cy) / 2));
    return (
      '<xdr:oneCellAnchor>' +
      `<xdr:from><xdr:col>${a.col}</xdr:col><xdr:colOff>${offX}</xdr:colOff><xdr:row>${a.row}</xdr:row><xdr:rowOff>${offY}</xdr:rowOff></xdr:from>` +
      `<xdr:ext cx="${cx}" cy="${cy}"/>` +
      '<xdr:pic>' +
      `<xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="照片 ${i + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
      `<xdr:blipFill><a:blip r:embed="rId${rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
      `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
      '</xdr:pic><xdr:clientData/></xdr:oneCellAnchor>'
    );
  });

  // ---- 工作表 ----
  const colsXml = colPx
    .map((px, i) => `<col min="${i + 1}" max="${i + 1}" width="${dxaToCharWidth(px * DXA_PER_PX)}" customWidth="1"/>`)
    .join('');
  const paper = paperSizeOf(spec.page);
  const m = spec.page.margin;
  const sheetXml =
    `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}">` +
    // fitToPage：欄總寬從 Word 的 dxa 換算成 Excel 的「字元」會有幾個 px 的進位差，差一點點就會被
    // 拆成左右兩頁（2026-09-10 的 bug）。讓 Excel 依寬度縮放（高度不管，分頁由 rowBreaks 決定）。
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
    `<dimension ref="A1:${colName(Math.max(0, totalCols - 1))}${Math.max(1, rowIdx)}"/>` +
    '<sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>' +
    '<sheetFormatPr baseColWidth="8" defaultRowHeight="15.75"/>' +
    `<cols>${colsXml}</cols>` +
    `<sheetData>${rowsXml.join('')}</sheetData>` +
    (merges.length ? `<mergeCells count="${merges.length}">${merges.map((r) => `<mergeCell ref="${r}"/>`).join('')}</mergeCells>` : '') +
    '<printOptions horizontalCentered="1"/>' +
    `<pageMargins left="${twipsToInch(m.l)}" right="${twipsToInch(m.r)}" top="${twipsToInch(m.t)}" bottom="${twipsToInch(m.b)}" header="0" footer="0"/>` +
    `<pageSetup${paper ? ` paperSize="${paper}"` : ''} orientation="${spec.page.orient}" fitToWidth="1" fitToHeight="0"/>` +
    (breaks.length ? `<rowBreaks count="${breaks.length}" manualBreakCount="${breaks.length}">${breaks.map((b) => `<brk id="${b}" max="16383" man="1"/>`).join('')}</rowBreaks>` : '') +
    '<drawing r:id="rId1"/>' +
    '</worksheet>';

  const drawingXml =
    `${XML_HEAD}<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}" xmlns:r="${NS_R}">${anchorXml.join('')}</xdr:wsDr>`;

  const exts = [...new Set(media.map((f) => f.ext))];
  const contentTypes =
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    exts.map((e) => `<Default Extension="${e}" ContentType="image/${e === 'jpeg' ? 'jpeg' : 'png'}"/>`).join('') +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' +
    '</Types>';

  const files = [
    { name: '[Content_Types].xml', data: contentTypes },
    {
      name: '_rels/.rels',
      data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}"><sheets><sheet name="${esc(sheetName(group))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${NS_R}/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${NS_R}/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'xl/styles.xml', data: st.xml() },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
    {
      name: 'xl/worksheets/_rels/sheet1.xml.rels',
      data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_R}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
    },
    { name: 'xl/drawings/drawing1.xml', data: drawingXml },
    {
      name: 'xl/drawings/_rels/drawing1.xml.rels',
      data:
        `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        media.map((f, i) => `<Relationship Id="rId${i + 1}" Type="${NS_R}/image" Target="../media/${f.name}"/>`).join('') +
        '</Relationships>',
    },
    ...media.map((f) => ({ name: `xl/media/${f.name}`, data: f.data, store: true })),
  ];

  return { blob: await zipBlob(files), failures };
}

/** 工作表名稱：Excel 不吃 : \ / ? * [ ]，最長 31 字。 */
function sheetName(group) {
  const raw = (group?.folderName || '工作表1').replace(/[:\\/?*[\]]/g, '_').slice(0, 31);
  return raw || '工作表1';
}

function row(idx, heightPt, cells) {
  const ht = heightPt ? ` ht="${heightPt}" customHeight="1"` : '';
  return `<row r="${idx + 1}"${ht}>${cells.join('')}</row>`;
}

function cellXml(col, rowIdx, style, text) {
  const ref = `${colName(col)}${rowIdx + 1}`;
  if (!text) return `<c r="${ref}" s="${style}"/>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}
