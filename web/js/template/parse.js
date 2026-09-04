// 從 Word 檔的 XML 推出 LayoutSpec（版面描述）。做不到的項目會列進 spec.unknown，
// 由預覽頁要求使用者指定——不猜、不靜靜套預設值。規格見 docs/版型.md。

import { parseXml, find, findAll, kids, attr, num } from './xml.js';
import { EMU_PER_PX } from './spec.js';
import { unzipText } from './unzip.js';

/** 看得見的文字：跳過 Word 的欄位指令（AUTOTEXTLIST 之類）與刪除線內容。 */
function text(node) {
  if (typeof node === 'string') return node;
  if (node.name === 'w:instrText' || node.name === 'w:delText') return '';
  let out = '';
  for (const c of node.children ?? []) out += text(c);
  return out;
}

const DATE_RE = /\d{2,4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{2,3}\.\d{1,2}\.\d{1,2}/;

// 欄位名 → 資料來源。由上而下比對，先中先算。
const FIELD_BY_LABEL = [
  [/設\s*計|標準值/, 'design'],
  [/實\s*際/, 'actual'],
  [/編\s*號/, 'seq'],
  [/日\s*期/, 'photoDate'],
  [/說\s*明/, 'desc'],
];

// 沒有冒號、但本身就是欄位名的字（例：照片編號、拍照日期、圖片說明）
const BARE_LABEL = /^(照片編號|編號|拍照日期|日期|圖片說明|內容說明|說明|設\s*計|標準值|實\s*際|實際值)$/;

const guessField = (label) => FIELD_BY_LABEL.find(([re]) => re.test(label))?.[1] ?? null;

/** 一行文字拆成「欄位名 + 值」；label 是要照印的字，rest 是這份樣本裡的值（會被丟掉）。 */
function splitLine(t) {
  const m = t.match(/^(\s*[^：:]{1,12}[：:])\s*([\s\S]*)$/);
  if (m) return { label: m[1], rest: m[2].trim() };
  if (BARE_LABEL.test(t.trim())) return { label: t, rest: '' };
  return { label: '', rest: t };
}

const isPhotoCell = (tc) => !!find(tc, 'wp:inline');

function cellSpan(tc) {
  return num(find(tc, 'w:gridSpan'), 'w:val') ?? 1;
}

function vMergeOf(tc) {
  const vm = find(tc, 'w:vMerge');
  if (!vm) return null;
  return (attr(vm, 'w:val') ?? 'continue') === 'restart' ? 'restart' : 'continue';
}

/** 一格裡的段落文字（不含浮動文字方塊裡的字）。 */
function cellParas(tc) {
  return kids(tc, 'w:p')
    .map((p) => text(p).replace(/\s+$/, ''))
    .filter((t) => t.trim() !== '');
}

function firstSizePt(node) {
  const sz = findAll(node, 'w:sz')[0];
  const v = num(sz, 'w:val');
  return v ? v / 2 : null;
}

function commonFont(node) {
  const counts = new Map();
  for (const f of findAll(node, 'w:rFonts')) {
    const name = attr(f, 'w:eastAsia') ?? attr(f, 'w:ascii');
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function headingLines(paras) {
  return paras.map((p) => ({
    text: text(p).replace(DATE_RE, '{date}'),
    sizePt: firstSizePt(p) ?? 14,
    bold: !!find(p, 'w:b'),
    align: attr(find(p, 'w:jc'), 'w:val') === 'center' ? 'center' : 'left',
  }));
}

/**
 * documentXml：word/document.xml；headerXml：sectPr 指到的預設頁首（沒有就不用給）。
 * 回傳 LayoutSpec，讀不出來的項目在 spec.unknown。
 */
export function parseTemplate({ documentXml, headerXml = null, name = '' } = {}) {
  const unknown = [];
  const doc = kids(parseXml(documentXml))[0];
  const body = find(doc, 'w:body');
  if (!body) throw new Error('這不是 Word 的 document.xml（找不到 w:body）');

  // ---- 頁面 ----
  const sect = findAll(body, 'w:sectPr').pop();
  const pgSz = find(sect, 'w:pgSz');
  const pgMar = find(sect, 'w:pgMar');
  const page = {
    w: num(pgSz, 'w:w'),
    h: num(pgSz, 'w:h'),
    orient: attr(pgSz, 'w:orient') === 'landscape' ? 'landscape' : 'portrait',
    margin: {
      t: num(pgMar, 'w:top') ?? 709,
      r: num(pgMar, 'w:right') ?? 851,
      b: num(pgMar, 'w:bottom') ?? 851,
      l: num(pgMar, 'w:left') ?? 1134,
    },
  };
  if (!page.w || !page.h) unknown.push('頁面尺寸');

  // ---- 照片表格 ----
  const tables = kids(body, 'w:tbl');
  const tbl = tables.find((t) => findAll(t, 'wp:inline').length) ?? tables[0];
  if (!tbl) {
    unknown.push('照片表格');
    return { id: null, name, font: '標楷體', page, heading: { place: 'body', lines: [] }, grid: {}, photo: {}, caption: {}, stamp: { on: false }, block: { cols: [], rows: [] }, unknown };
  }
  const gridCols = kids(find(tbl, 'w:tblGrid'), 'w:gridCol').map((g) => num(g, 'w:w'));
  const rows = kids(tbl, 'w:tr');
  const photoRows = rows.map((r, i) => (kids(r, 'w:tc').some(isPhotoCell) ? i : -1)).filter((i) => i >= 0);

  if (!photoRows.length) unknown.push('照片格');
  const start = photoRows[0] ?? 0;
  const blockRowCount = photoRows.length > 1 ? photoRows[1] - photoRows[0] : rows.length - start;
  const perRow = kids(rows[start] ?? { children: [] }, 'w:tc').filter(isPhotoCell).length || 1;
  const blockCols = gridCols.length / perRow;
  if (!Number.isInteger(blockCols) || blockCols < 1) unknown.push('欄位配置（欄數不是每列張數的倍數）');
  const cols = Number.isInteger(blockCols) ? gridCols.slice(0, blockCols) : gridCols.slice();

  // ---- 一個區塊的格子 ----
  const blockRows = [];
  const grid = []; // [列][格]，只留第一個區塊的欄位範圍
  for (let r = 0; r < blockRowCount; r++) {
    const tr = rows[start + r];
    if (!tr) break;
    const out = [];
    let col = 0;
    for (const tc of kids(tr, 'w:tc')) {
      const span = cellSpan(tc);
      if (col < cols.length) out.push({ tc, col, span, merge: vMergeOf(tc), photo: isPhotoCell(tc) });
      col += span;
    }
    grid.push(out);
    blockRows.push({ h: num(find(tr, 'w:trHeight'), 'w:val') ?? null, cells: [] });
  }

  // 跨列合併：restart 的格子往下數幾列
  const rowSpanOf = (r, col) => {
    let n = 1;
    for (let k = r + 1; k < grid.length; k++) {
      const c = grid[k].find((x) => x.col === col);
      if (c?.merge === 'continue') n++;
      else break;
    }
    return n;
  };

  // 先把每一格轉成 lines，值的位置先留白（field=null）等 label 來認領
  const slots = []; // 待認領的值格
  const pending = []; // 有欄位名、還沒配到值的 label
  for (let r = 0; r < grid.length; r++) {
    for (const c of grid[r]) {
      if (c.merge === 'continue') continue; // 合併的下半段，輸出時由 rowSpan 產生
      const cell = { kind: c.photo ? 'photo' : 'text', col: c.col };
      if (c.span > 1) cell.colSpan = c.span;
      const span = rowSpanOf(r, c.col);
      if (span > 1) cell.rowSpan = span;
      if (c.photo) {
        cell.align = 'center';
        cell.vAlign = 'center';
        blockRows[r].cells.push(cell);
        continue;
      }
      const paras = cellParas(c.tc);
      const sz = firstSizePt(c.tc);
      if (sz) cell.sizePt = sz;
      cell.lines = [];
      if (!paras.length) {
        cell.lines.push({ label: '', field: null });
        slots.push({ r, cell, line: cell.lines[0] });
      }
      let valueLine = null; // 同一格裡連續的純值段落算同一個欄位（樣本文字換行不代表多欄）
      for (const t of paras) {
        const { label, rest } = splitLine(t);
        if (label && rest) {
          // 欄位名和值在同一行（例：「內容說明：範例說明」）
          cell.lines.push({ label, field: guessField(label) ?? 'none' });
          valueLine = null;
        } else if (label) {
          // 只有欄位名，值在別格
          cell.lines.push({ label, field: 'none' });
          pending.push({ r, col: c.col, field: guessField(label) });
          valueLine = null;
        } else if (!valueLine) {
          valueLine = { label: '', field: null };
          cell.lines.push(valueLine);
          slots.push({ r, cell, line: valueLine });
        }
      }
      blockRows[r].cells.push(cell);
    }
  }

  // label 認領值格：先找同一列右邊的，再找下面幾列的
  for (const p of pending) {
    if (!p.field) continue;
    const hit =
      slots.find((s) => s.line.field === null && s.r === p.r && s.cell.col > p.col) ??
      slots.find((s) => s.line.field === null && s.r > p.r);
    if (hit) hit.line.field = p.field;
  }
  // 認領不到的值格留 field=null，validateSpec 會擋下來，由預覽頁請使用者指定。

  // ---- 照片框 ----
  const photoCell = rows[start] ? kids(rows[start], 'w:tc').find(isPhotoCell) : null;
  const ext = photoCell ? find(photoCell, 'wp:extent') : null;
  const photo = { h: (num(ext, 'cy') ?? 0) / EMU_PER_PX, maxW: (num(ext, 'cx') ?? 0) / EMU_PER_PX };
  if (!photo.h || !photo.maxW) unknown.push('照片框大小');

  // ---- 抬頭 ----
  let heading;
  const before = [];
  for (const ch of kids(body)) {
    if (ch === tbl) break;
    if (ch.name === 'w:p' && text(ch).trim()) before.push(ch);
  }
  if (before.length) {
    heading = { place: 'body', lines: headingLines(before) };
  } else if (headerXml) {
    const hdr = kids(parseXml(headerXml))[0];
    heading = { place: 'header', lines: headingLines(kids(find(hdr, 'w:hdr') ?? hdr, 'w:p').filter((p) => text(p).trim())) };
  } else {
    heading = { place: 'header', lines: [] };
    if (find(sect, 'w:headerReference')) unknown.push('頁首文字');
  }

  // ---- 日期戳（照片上的浮動文字方塊）----
  const stampOn = photoCell ? findAll(photoCell, 'w:txbxContent').some((tb) => DATE_RE.test(text(tb))) : false;

  return {
    id: null,
    name,
    font: commonFont(tbl) ?? '標楷體',
    page,
    heading,
    grid: { perRow, blockRows: photoRows.length || 1, order: 'row', seq: null, tableIndent: num(find(tbl, 'w:tblInd'), 'w:w') ?? 0 },
    photo,
    caption: { sizePt: blockRows.flatMap((r) => r.cells).find((c) => c.sizePt)?.sizePt ?? 12 },
    stamp: { on: stampOn, corner: 'bl' },
    block: { cols, rows: blockRows },
    unknown,
  };
}

const REL_RE = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g;

/**
 * 直接吃一份 .docx（ArrayBuffer）：解壓 → 找出預設頁首 → 解析成 LayoutSpec。
 */
export async function parseTemplateDocx(buffer, name = '') {
  const files = await unzipText(buffer, (n) => n === 'word/document.xml' || n === 'word/_rels/document.xml.rels' || /^word\/header\d*\.xml$/.test(n));
  const documentXml = files.get('word/document.xml');
  if (!documentXml) throw new Error('這份 docx 裡沒有 word/document.xml');

  const rels = files.get('word/_rels/document.xml.rels') ?? '';
  const target = new Map();
  REL_RE.lastIndex = 0;
  let m;
  while ((m = REL_RE.exec(rels))) target.set(m[1], m[2]);

  const doc = kids(parseXml(documentXml))[0];
  const sect = findAll(find(doc, 'w:body'), 'w:sectPr').pop();
  let headerXml = null;
  for (const h of kids(sect, 'w:headerReference')) {
    if (attr(h, 'w:type') === 'default') headerXml = files.get('word/' + target.get(attr(h, 'r:id'))) ?? null;
  }
  return parseTemplate({ documentXml, headerXml, name });
}
