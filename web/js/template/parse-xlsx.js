// 從 Excel 檔（xlsx）的 XML 推出 LayoutSpec（版面描述）。與 parse.js（docx）是兩支各自
// 獨立的解析器，只共用 unzip.js / xml.js / fields.js / xlsx.js；做不到的項目一樣列進
// spec.unknown，由版型頁要求使用者指定——不猜、不靜靜套預設值。規格見 docs/版型.md。

import { parseXml, find, findAll, kids, attr, num, text as rawText } from './xml.js';
import { EMU_PER_PX } from './spec.js';
import { unzipText } from './unzip.js';
import { DATE_RE, guessField, splitLine } from './fields.js';
import { A4, charWidthToDxa, charWidthToPx, colIndex, inchToTwips, parseRange, parseRef, ptToTwips } from './xlsx.js';

const EMU_PER_PT = 12700;
const DEFAULT_COL_WIDTH = 8.43; // Excel 的預設欄寬（字元）
const DEFAULT_ROW_HEIGHT = 15.75; // pt

// Excel 的 paperSize → 紙張尺寸（twips，直式）。認不得的不猜。
const PAPER = {
  1: { w: 12240, h: 15840 }, // Letter
  8: { w: 16838, h: 23811 }, // A3
  9: A4,
  11: { w: 8391, h: 11906 }, // A5
};

// ---------- styles.xml ----------

/** 讀出每個 cellXf 的字型與對齊：{ sizePt, bold, fontName, align, vAlign, wrap }。 */
function readStyles(stylesXml) {
  if (!stylesXml) return [];
  const root = kids(parseXml(stylesXml))[0];
  const fonts = kids(find(root, 'fonts'), 'font').map((f) => ({
    sizePt: num(find(f, 'sz'), 'val'),
    name: attr(find(f, 'name'), 'val') ?? null,
    bold: !!find(f, 'b'),
  }));
  return kids(find(root, 'cellXfs'), 'xf').map((xf) => {
    const font = fonts[Number(attr(xf, 'fontId') ?? 0)] ?? {};
    const al = find(xf, 'alignment');
    return {
      sizePt: font.sizePt ?? null,
      bold: !!font.bold,
      fontName: font.name ?? null,
      align: attr(al, 'horizontal') ?? null,
      vAlign: attr(al, 'vertical') ?? null,
      wrap: attr(al, 'wrapText') === '1',
    };
  });
}

// ---------- sharedStrings.xml ----------

/** si 的文字（跳過注音 rPh）。 */
function siText(si) {
  let out = '';
  for (const c of si.children ?? []) {
    if (typeof c === 'string') out += c;
    else if (c.name !== 'rPh' && c.name !== 'phoneticPr') out += siText(c);
  }
  return out;
}

/** 儲存格裡的換行：Excel 存 \r\n 或 \n，一律收成 \n。 */
const nl = (s) => String(s ?? '').replace(/\r\n?/g, '\n');

function readSharedStrings(xml) {
  if (!xml) return [];
  return kids(kids(parseXml(xml))[0], 'si').map(siText);
}

// ---------- drawing?.xml ----------

/**
 * 圖片與文字方塊的錨點。回傳 { pics:[{col,row,cx,cy}], stamps:[{col,row,text}] }。
 * cx/cy 是 EMU；twoCellAnchor 沒有 ext，用 from→to 加上欄寬列高算出來。
 */
function readDrawing(drawingXml, colEmu, rowEmu) {
  const pics = [];
  const stamps = [];
  if (!drawingXml) return { pics, stamps };
  const root = kids(parseXml(drawingXml))[0];
  for (const kind of ['xdr:twoCellAnchor', 'xdr:oneCellAnchor', 'xdr:absoluteAnchor']) {
    for (const a of findAll(root, kind)) {
      const at = (tag) => {
        const n = find(a, tag);
        if (!n) return null;
        const g = (x) => Number(rawText(find(n, x)) || 0);
        return { col: g('xdr:col'), colOff: g('xdr:colOff'), row: g('xdr:row'), rowOff: g('xdr:rowOff') };
      };
      const from = at('xdr:from');
      if (!from) continue; // absoluteAnchor 沒有 from：釘在頁面座標，不屬於任何格子
      const isPic = !!find(a, 'xdr:pic');
      if (isPic) pics.push({ col: from.col, row: from.row, ...anchorSize(a, from, colEmu, rowEmu) });
      else if (find(a, 'xdr:txBody')) stamps.push({ col: from.col, row: from.row, text: rawText(find(a, 'xdr:txBody')) });
    }
  }
  return { pics, stamps };
}

function anchorSize(anchor, from, colEmu, rowEmu) {
  const ext = kids(anchor, 'xdr:ext')[0];
  if (ext) return { cx: num(ext, 'cx') ?? 0, cy: num(ext, 'cy') ?? 0 };
  const toNode = find(anchor, 'xdr:to');
  if (!toNode) return { cx: 0, cy: 0 };
  const g = (x) => Number(rawText(find(toNode, x)) || 0);
  const to = { col: g('xdr:col'), colOff: g('xdr:colOff'), row: g('xdr:row'), rowOff: g('xdr:rowOff') };
  let cx = to.colOff - from.colOff;
  for (let c = from.col; c < to.col; c++) cx += colEmu(c);
  let cy = to.rowOff - from.rowOff;
  for (let r = from.row; r < to.row; r++) cy += rowEmu(r);
  return { cx, cy };
}

// ---------- sheet?.xml ----------

/** 一格的文字：t="s" 查 sharedStrings、t="inlineStr" 讀 is、其餘讀 v。 */
function cellValue(c, shared) {
  const t = attr(c, 't');
  if (t === 's') return nl(shared[Number(rawText(find(c, 'v')) || 0)] ?? '');
  if (t === 'inlineStr') return nl(siText(find(c, 'is') ?? { children: [] }));
  return nl(rawText(find(c, 'v')));
}

/**
 * sheetXml + 相關 XML → LayoutSpec。四份 XML 都是字串，Node 測試與瀏覽器跑同一份程式碼。
 */
export function parseXlsxTemplate({ sheetXml, sharedStringsXml = null, stylesXml = null, drawingXml = null, name = '' } = {}) {
  const unknown = [];
  const sheet = kids(parseXml(sheetXml))[0];
  if (!sheet || sheet.name !== 'worksheet') throw new Error('這不是 Excel 的工作表 XML（找不到 worksheet）');

  const shared = readSharedStrings(sharedStringsXml);
  const styles = readStyles(stylesXml);
  const styleOf = (c) => styles[Number(attr(c, 's') ?? 0)] ?? {};

  // ---- 欄寬 ----
  const fmt = find(sheet, 'sheetFormatPr');
  const defaultColWidth = num(fmt, 'defaultColWidth') ?? DEFAULT_COL_WIDTH;
  const defaultRowHeight = num(fmt, 'defaultRowHeight') ?? DEFAULT_ROW_HEIGHT;
  const colWidths = [];
  for (const col of kids(find(sheet, 'cols'), 'col')) {
    const min = num(col, 'min') ?? 1;
    const max = num(col, 'max') ?? min;
    const w = num(col, 'width') ?? defaultColWidth;
    for (let i = min - 1; i <= max - 1 && i < 256; i++) colWidths[i] = w;
  }
  const widthOf = (i) => colWidths[i] ?? defaultColWidth;

  // ---- 列 ----
  const rowNodes = new Map(); // 0 起算的列 → { node, cells: Map<欄, node>, ht }
  for (const r of kids(find(sheet, 'sheetData'), 'row')) {
    const idx = (num(r, 'r') ?? 0) - 1;
    if (idx < 0) continue;
    const cells = new Map();
    for (const c of kids(r, 'c')) {
      const ref = parseRef(attr(c, 'r'));
      if (ref) cells.set(ref.col, c);
    }
    rowNodes.set(idx, { node: r, cells, ht: num(r, 'ht') });
  }
  const heightOf = (i) => rowNodes.get(i)?.ht ?? defaultRowHeight;
  const colEmu = (i) => charWidthToPx(widthOf(i)) * EMU_PER_PX;
  const rowEmu = (i) => heightOf(i) * EMU_PER_PT;

  // ---- 合併 ----
  const merges = kids(find(sheet, 'mergeCells'), 'mergeCell')
    .map((m) => parseRange(attr(m, 'ref')))
    .filter(Boolean);
  const mergeAt = (row, col) => merges.find((m) => m.r1 === row && m.c1 === col) ?? null;
  const coveredBy = (row, col) => merges.find((m) => row >= m.r1 && row <= m.r2 && col >= m.c1 && col <= m.c2 && !(row === m.r1 && col === m.c1));

  // ---- 圖片與日期戳 ----
  const { pics, stamps } = readDrawing(drawingXml, colEmu, rowEmu);
  const picsByRow = new Map();
  for (const p of pics) {
    if (!picsByRow.has(p.row)) picsByRow.set(p.row, []);
    picsByRow.get(p.row).push(p);
  }
  const photoRows = [...picsByRow.keys()].sort((a, b) => a - b);
  if (!photoRows.length) unknown.push('照片格');

  // ---- 版面：每列幾張、一個區塊幾列、幾欄 ----
  const start = photoRows[0] ?? 0;
  const lastRow = Math.max(...[...rowNodes.keys()], ...pics.map((p) => p.row), start);
  const blockRowCount = photoRows.length > 1 ? photoRows[1] - photoRows[0] : Math.max(1, lastRow - start + 1);
  const perRow = new Set((picsByRow.get(start) ?? []).map((p) => p.col)).size || 1;

  // 用到的欄數：區塊那幾列裡有內容（文字、合併、圖片）的最大欄 + 1
  let maxCol = -1;
  for (let r = start; r < start + blockRowCount; r++) {
    for (const c of rowNodes.get(r)?.cells.keys() ?? []) maxCol = Math.max(maxCol, c);
    for (const p of picsByRow.get(r) ?? []) maxCol = Math.max(maxCol, p.col);
    for (const m of merges) if (m.r1 <= r && r <= m.r2) maxCol = Math.max(maxCol, m.c2);
  }
  const usedCols = maxCol + 1;
  const blockCols = usedCols / perRow;
  if (!Number.isInteger(blockCols) || blockCols < 1) unknown.push('欄位配置（欄數不是每列張數的倍數）');
  const nCols = Number.isInteger(blockCols) && blockCols >= 1 ? blockCols : Math.max(1, usedCols);
  const cols = Array.from({ length: nCols }, (_, i) => charWidthToDxa(widthOf(i)));

  // ---- 一個區塊的格子 ----
  const blockRows = [];
  const slots = []; // 待認領的值格
  const pending = []; // 有欄位名、還沒配到值的 label
  let fontVotes = new Map();
  for (let r = 0; r < blockRowCount; r++) {
    const sheetRow = start + r;
    const h = rowNodes.get(sheetRow)?.ht;
    const row = { h: h != null ? ptToTwips(h) : null, cells: [] };
    for (let col = 0; col < nCols; col++) {
      if (coveredBy(sheetRow, col)) continue; // 合併的下半段／右半段，輸出時由 rowSpan/colSpan 產生
      const isPhoto = (picsByRow.get(sheetRow) ?? []).some((p) => p.col === col);
      const merged = mergeAt(sheetRow, col);
      const cell = { kind: isPhoto ? 'photo' : 'text', col };
      if (merged) {
        const colSpan = Math.min(merged.c2, nCols - 1) - merged.c1 + 1;
        const rowSpan = Math.min(merged.r2, start + blockRowCount - 1) - merged.r1 + 1;
        if (colSpan > 1) cell.colSpan = colSpan;
        if (rowSpan > 1) cell.rowSpan = rowSpan;
      }
      if (isPhoto) {
        cell.align = 'center';
        cell.vAlign = 'center';
        row.cells.push(cell);
        continue;
      }
      // 說明格一律靠左、垂直置中（同 docx 解析：不照樣本，照手改的正確版）
      cell.align = 'left';
      cell.vAlign = 'center';
      const c = rowNodes.get(sheetRow)?.cells.get(col);
      const st = c ? styleOf(c) : {};
      if (st.sizePt) cell.sizePt = st.sizePt;
      if (st.fontName) fontVotes.set(st.fontName, (fontVotes.get(st.fontName) ?? 0) + 1);
      const paras = String(c ? cellValue(c, shared) : '')
        .split('\n')
        .map((t) => t.replace(/\s+$/, ''))
        .filter((t) => t.trim() !== '');
      cell.lines = [];
      if (!paras.length) {
        cell.lines.push({ label: '', field: null });
        slots.push({ r, cell, line: cell.lines[0] });
      }
      let valueLine = null; // 同一格裡連續的純值段落算同一個欄位
      let inlineValue = false; // 上一段是「欄位名：值」，接著的純文字是那個值太長換行，不是新欄位
      for (const t of paras) {
        const { label, rest } = splitLine(t);
        if (label && rest) {
          cell.lines.push({ label, field: guessField(label) ?? 'none' });
          valueLine = null;
          inlineValue = true;
        } else if (label) {
          cell.lines.push({ label, field: 'none' });
          pending.push({ r, col, field: guessField(label) });
          valueLine = null;
          inlineValue = false;
        } else if (inlineValue) {
          // 樣本值的續行：值本來就會丟掉，不開新的值格
        } else if (!valueLine) {
          valueLine = { label: '', field: null };
          cell.lines.push(valueLine);
          slots.push({ r, cell, line: valueLine });
        }
      }
      row.cells.push(cell);
    }
    blockRows.push(row);
  }

  // label 認領值格：先找同一列右邊的，再找下面幾列的
  for (const p of pending) {
    if (!p.field) continue;
    const hit =
      slots.find((s) => s.line.field === null && s.r === p.r && s.cell.col > p.col) ??
      slots.find((s) => s.line.field === null && s.r > p.r);
    if (hit) hit.line.field = p.field;
  }

  // ---- 照片框 ----
  const firstPic = (picsByRow.get(start) ?? [])[0] ?? null;
  const photo = { h: (firstPic?.cy ?? 0) / EMU_PER_PX, maxW: (firstPic?.cx ?? 0) / EMU_PER_PX };
  if (!photo.h || !photo.maxW) unknown.push('照片框大小');

  // ---- 抬頭：照片列之前、有字的列 ----
  const headingLines = [];
  for (let r = 0; r < start; r++) {
    for (const [col, c] of rowNodes.get(r)?.cells ?? []) {
      if (coveredBy(r, col)) continue;
      const v = String(cellValue(c, shared) ?? '').trim();
      if (!v) continue;
      const st = styleOf(c);
      for (const line of v.split('\n')) {
        if (!line.trim()) continue;
        headingLines.push({
          text: line.replace(DATE_RE, '{date}'),
          sizePt: st.sizePt ?? 14,
          bold: !!st.bold,
          align: st.align === 'center' ? 'center' : st.align === 'right' ? 'right' : 'left',
        });
        if (st.fontName) fontVotes.set(st.fontName, (fontVotes.get(st.fontName) ?? 0) + 1);
      }
    }
  }
  // Excel 沒有 Word 那種「頁首每頁重印」：抬頭一律當成內文列，輸出時每頁各印一次。
  const heading = { place: 'body', lines: headingLines };

  // ---- 日期戳（照片上的文字方塊）----
  const stampOn = stamps.some((s) => photoRows.includes(s.row) && DATE_RE.test(s.text));

  // ---- 頁面 ----
  const setup = find(sheet, 'pageSetup');
  const paperSize = num(setup, 'paperSize');
  const paper = paperSize == null ? A4 : PAPER[paperSize];
  if (!paper) unknown.push(`頁面尺寸（不認得的紙張 paperSize=${paperSize}）`);
  const landscape = attr(setup, 'orientation') === 'landscape';
  const size = paper ?? A4;
  const m = find(sheet, 'pageMargins');
  const page = {
    w: landscape ? size.h : size.w,
    h: landscape ? size.w : size.h,
    orient: landscape ? 'landscape' : 'portrait',
    margin: {
      t: inchToTwips(num(m, 'top') ?? 0.75),
      r: inchToTwips(num(m, 'right') ?? 0.7),
      b: inchToTwips(num(m, 'bottom') ?? 0.75),
      l: inchToTwips(num(m, 'left') ?? 0.7),
    },
  };

  const font = [...fontVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '標楷體';

  return {
    id: null,
    name,
    source: 'xlsx',
    font,
    page,
    heading,
    grid: { perRow, blockRows: photoRows.length || 1, order: 'row', seq: null, tableIndent: 0 },
    photo,
    caption: { sizePt: blockRows.flatMap((r) => r.cells).find((c) => c.sizePt)?.sizePt ?? 12 },
    stamp: { on: stampOn, corner: 'bl' },
    block: { cols, rows: blockRows },
    unknown,
  };
}

const REL_RE = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g;

function relMap(xml) {
  const out = new Map();
  REL_RE.lastIndex = 0;
  let m;
  while ((m = REL_RE.exec(xml ?? ''))) out.set(m[1], m[2]);
  return out;
}

/** 'xl/worksheets/sheet1.xml' + '../drawings/drawing1.xml' → 'xl/drawings/drawing1.xml' */
function resolve(base, target) {
  const parts = base.split('/').slice(0, -1);
  for (const seg of String(target).split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/**
 * 直接吃一份 .xlsx（ArrayBuffer）：解壓 → 找出第一張工作表與它的繪圖層 → 解析成 LayoutSpec。
 */
export async function parseTemplateXlsx(buffer, name = '') {
  const files = await unzipText(
    buffer,
    (n) =>
      n === 'xl/workbook.xml' ||
      n === 'xl/_rels/workbook.xml.rels' ||
      n === 'xl/sharedStrings.xml' ||
      n === 'xl/styles.xml' ||
      /^xl\/worksheets\/[^/]+\.xml$/.test(n) ||
      /^xl\/worksheets\/_rels\/[^/]+\.rels$/.test(n) ||
      /^xl\/drawings\/drawing\d*\.xml$/.test(n),
  );
  const workbook = files.get('xl/workbook.xml');
  if (!workbook) throw new Error('這份 xlsx 裡沒有 xl/workbook.xml');

  const wbRels = relMap(files.get('xl/_rels/workbook.xml.rels'));
  const first = kids(find(kids(parseXml(workbook))[0], 'sheets'), 'sheet')[0];
  const sheetPath = resolve('xl/workbook.xml', wbRels.get(attr(first, 'r:id')) ?? 'worksheets/sheet1.xml');
  const sheetXml = files.get(sheetPath);
  if (!sheetXml) throw new Error(`這份 xlsx 裡找不到工作表（${sheetPath}）`);

  const sheetRels = relMap(files.get(sheetPath.replace(/([^/]+)$/, '_rels/$1.rels')));
  const sheet = kids(parseXml(sheetXml))[0];
  const drawingId = attr(find(sheet, 'drawing'), 'r:id');
  const drawingXml = drawingId ? (files.get(resolve(sheetPath, sheetRels.get(drawingId) ?? '')) ?? null) : null;

  return parseXlsxTemplate({
    sheetXml,
    sharedStringsXml: files.get('xl/sharedStrings.xml') ?? null,
    stylesXml: files.get('xl/styles.xml') ?? null,
    drawingXml,
    name,
  });
}
