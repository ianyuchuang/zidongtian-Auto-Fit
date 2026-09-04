// 版型（LayoutSpec）：定義、預設值與純邏輯（無 DOM、不碰 docx 函式庫）。
// 結構與各欄位的意思見 docs/版型.md。預設值＝V1.0 版面（self_check_core.py 的 EMU 換算）。

export const EMU_PER_TWIP = 635;
export const EMU_PER_PX = 9525;

export const DEFAULT_FONT = '標楷體';

/** 說明欄位可以對應到的資料來源（預覽頁的下拉選項）。 */
export const FIELDS = {
  desc: '內容說明',
  design: '設計值',
  actual: '實際值',
  seq: '照片編號',
  photoDate: '拍照日期',
  none: '（留空）',
};

/** 預設版型＝V1.0：A4 直式、每頁 3 列 × 2 張、標楷體、照片左下日期戳。 */
export function defaultSpec() {
  return {
    id: 'v1',
    name: '預設（V1.0 版面）',
    font: DEFAULT_FONT,
    page: {
      w: Math.round(7560310 / EMU_PER_TWIP), // 11906 twips (A4)
      h: Math.round(10692130 / EMU_PER_TWIP), // 16838
      orient: 'portrait',
      margin: {
        t: Math.round(450215 / EMU_PER_TWIP), // 709
        r: Math.round(540385 / EMU_PER_TWIP), // 851
        b: Math.round(540385 / EMU_PER_TWIP), // 851
        l: Math.round(720090 / EMU_PER_TWIP), // 1134
      },
    },
    // place: 'header' 放頁首（Word 自己每頁重印）；'body' 放內文（一頁一張表，每張表前都印一次）。{date} 會換成檢查日期。
    heading: {
      place: 'header',
      lines: [
        { text: '永青營造工程股份有限公司', sizePt: 14, bold: false, align: 'center' },
        { text: '施工自主檢查照片(檢查日期：{date})', sizePt: 14, bold: false, align: 'center' },
      ],
    },
    // order: 'row' 由左至右換行；'col' 由上而下換欄。seq 是拖曳交換後的實際填入順序（null＝照 order）。
    grid: { perRow: 2, blockRows: 3, order: 'row', seq: null, tableIndent: 80 },
    photo: { h: 2232000 / EMU_PER_PX, maxW: 2975500 / EMU_PER_PX }, // px：固定高度、最大寬度
    caption: { sizePt: 8 },
    stamp: { on: true, corner: 'bl' },
    // 一個「區塊」＝一張照片佔的格子；整張表＝區塊橫向重複 perRow 次、縱向重複到照片用完。
    block: {
      cols: [4915], // dxa
      rows: [
        { h: 3798, cells: [{ kind: 'photo', align: 'center', vAlign: 'center' }] },
        {
          h: null,
          cells: [
            {
              kind: 'text',
              lines: [
                { label: '內容說明：', field: 'desc' },
                { label: '設    計：', field: 'design' },
                { label: '實    際：', field: 'actual' },
              ],
            },
          ],
        },
      ],
    },
    unknown: [], // 解析時讀不出來的項目，預覽頁要紅字要求指定
  };
}

/** 整張表的欄寬：一個區塊的欄寬重複 perRow 次。 */
export function tableCols(spec) {
  const out = [];
  for (let i = 0; i < spec.grid.perRow; i++) out.push(...spec.block.cols);
  return out;
}

/** 一個區塊的總寬（dxa）。 */
export function blockWidth(spec) {
  return spec.block.cols.reduce((a, b) => a + b, 0);
}

/** 每頁幾張。 */
export function perPage(spec) {
  return spec.grid.perRow * spec.grid.blockRows;
}

/**
 * 一頁裡「第 k 張照片放第幾格」的對照表（格子編號＝由左至右、由上而下）。
 * 有 grid.seq 就照它（預覽頁拖曳交換的結果），否則照 order 推。
 */
export function slotOrder(spec) {
  const { perRow, blockRows, order, seq } = spec.grid;
  const n = perRow * blockRows;
  if (Array.isArray(seq) && seq.length === n) return seq.slice();
  const out = [];
  if (order === 'col') {
    for (let c = 0; c < perRow; c++) for (let r = 0; r < blockRows; r++) out.push(r * perRow + c);
  } else {
    for (let i = 0; i < n; i++) out.push(i);
  }
  return out;
}

/** 交換兩個格子的填入順序（預覽頁拖曳用）。會寫進 spec.grid.seq。 */
export function swapSlots(spec, slotA, slotB) {
  const order = slotOrder(spec);
  const ia = order.indexOf(slotA);
  const ib = order.indexOf(slotB);
  if (ia < 0 || ib < 0) return spec;
  [order[ia], order[ib]] = [order[ib], order[ia]];
  spec.grid.seq = order;
  return spec;
}

/**
 * 把照片排進版面：回傳 [頁][區塊列][格] 的照片（沒排到的格是 null）。
 * 最後一頁整列都空的區塊列會去掉，不會多印空白列。
 */
export function layoutPages(spec, photos) {
  const order = slotOrder(spec);
  const n = order.length;
  const { perRow, blockRows } = spec.grid;
  const pages = [];
  for (let i = 0; i < photos.length; i += n) {
    const chunk = photos.slice(i, i + n);
    const slots = new Array(n).fill(null);
    chunk.forEach((p, k) => {
      slots[order[k]] = p;
    });
    const rows = [];
    for (let r = 0; r < blockRows; r++) rows.push(slots.slice(r * perRow, (r + 1) * perRow));
    while (rows.length && rows[rows.length - 1].every((p) => p === null)) rows.pop();
    pages.push(rows);
  }
  return pages;
}

/** 依 V1.0 規則算照片在 Word 裡的尺寸（px）：固定高度，太寬改以最大寬度為準。 */
export function fitPhoto(spec, width, height) {
  if (!(width > 0) || !(height > 0)) throw new Error(`照片尺寸不合法：${width}x${height}`);
  let h = spec.photo.h;
  let w = (width / height) * h;
  if (w > spec.photo.maxW) {
    w = spec.photo.maxW;
    h = (height / width) * w;
  }
  return { width: Math.round(w * 100) / 100, height: Math.round(h * 100) / 100 };
}

function valueOf(field, photo, ctx) {
  switch (field) {
    case 'desc':
      return photo?.desc ?? '';
    case 'design':
      return photo?.design ?? '';
    case 'actual':
      return photo?.actual ?? '';
    case 'seq':
      return ctx.seq == null ? '' : String(ctx.seq);
    case 'photoDate':
      return ctx.photoDate ?? '';
    default:
      return '';
  }
}

/** 一個格子從區塊的第幾欄開始：有寫 col 就照它（跨列合併的格子讓出來的位置），否則接在前一格後面。 */
export function cellColumns(row) {
  const out = [];
  let cursor = 0;
  for (const c of row.cells ?? []) {
    const col = c.col ?? cursor;
    out.push(col);
    cursor = col + (c.colSpan ?? 1);
  }
  return out;
}

/**
 * 一行的內容一律看成「文字／欄位交錯的多段」：`{text}` 照原樣印，`{field}` 換成該欄位的值，
 * `{br:true}` 是段落內的換行（Word 的 Shift+Enter，`<w:br/>`）。
 * 舊格式 `{label, field}` 等於 `[{text:label}, {field}]`——同一行要放兩個以上欄位
 * （例：「內容說明，設計值，實際值」）才會存成 `parts`。
 */
const isText = (p) => p?.text != null;
const isField = (p) => p != null && 'field' in p;
const isBreak = (p) => p?.br === true;

export function lineParts(line) {
  if (Array.isArray(line?.parts)) return line.parts;
  const out = [];
  if (line?.label) out.push({ text: line.label });
  out.push({ field: line?.field ?? null });
  return out;
}

/**
 * 把編輯後的多段收乾淨（相鄰文字併起來、空文字丟掉）再包成一行。
 * 收完只剩「一段文字＋一個欄位」以內的，存回舊的簡單格式，版型 JSON 才不會無謂變胖。
 */
export function makeLine(parts) {
  const p = [];
  for (const x of parts ?? []) {
    if (isBreak(x)) {
      p.push({ br: true });
      continue;
    }
    if (isField(x)) {
      if (x.field === 'none') continue; // 「（留空）」＝這個位置不填東西，不必留著
      p.push({ field: x.field ?? null });
      continue;
    }
    const t = x?.text ?? '';
    if (!t) continue;
    if (isText(p[p.length - 1])) p[p.length - 1].text += t;
    else p.push({ text: t });
  }
  if (!p.length) return { label: '', field: 'none' }; // 空的一行＝空白段落，不是「還沒指定欄位」
  if (p.length === 1 && isText(p[0])) return { label: p[0].text, field: 'none' };
  if (p.length === 1 && isField(p[0])) return { label: '', field: p[0].field };
  if (p.length === 2 && isText(p[0]) && isField(p[1])) return { label: p[0].text, field: p[1].field };
  return { parts: p };
}

/**
 * 一個文字格要印的每一行（＝Word 的一段）：多段串起來。空值照原樣留空（分隔用的逗號不會自己消失）。
 * 回傳字串裡的 `\n` 是段落內的換行，由 `docx-export.js` 轉成 `<w:br/>`。ctx: {seq, photoDate}。
 */
export function cellText(cell, photo, ctx = {}) {
  return (cell.lines ?? []).map((ln) =>
    lineParts(ln)
      .map((p) => (isBreak(p) ? '\n' : isText(p) ? p.text : p.field && p.field !== 'none' ? valueOf(p.field, photo, ctx) : ''))
      .join(''),
  );
}

// ---------- 格子的對齊（版型頁右鍵選單） ----------

/** 水平對齊的選項；每一格沒寫就是靠左（照手改的正確版）。 */
export const ALIGNS = { left: '靠左', center: '置中', right: '靠右' };
/** 垂直對齊的選項；沒寫就是置中。 */
export const VALIGNS = { top: '靠上', center: '置中', bottom: '靠下' };

/** 一格目前的對齊（補上預設值）。 */
export function cellAlign(cell) {
  return { align: cell?.align ?? 'left', vAlign: cell?.vAlign ?? 'center' };
}

/** 設定某一格的水平／垂直對齊。只給其中一個就只改那一個；值不合法直接丟錯（寧可大聲失敗）。 */
export function setCellAlign(spec, r, c, { align, vAlign } = {}) {
  const cell = spec?.block?.rows?.[r]?.cells?.[c];
  if (!cell) throw new Error(`沒有這一格：${r}.${c}`);
  if (align !== undefined) {
    if (!(align in ALIGNS)) throw new Error(`不合法的水平對齊：${align}`);
    cell.align = align;
  }
  if (vAlign !== undefined) {
    if (!(vAlign in VALIGNS)) throw new Error(`不合法的垂直對齊：${vAlign}`);
    cell.vAlign = vAlign;
  }
  return cell;
}

/** 版型檢查：回傳錯誤訊息陣列（空陣列＝可用）。寧可在這裡擋下來，不要產出錯的 Word。 */
export function validateSpec(spec) {
  const errs = [];
  if (!spec) return ['沒有版型'];
  if (!(spec.page?.w > 0) || !(spec.page?.h > 0)) errs.push('缺頁面尺寸');
  const posInt = (v) => Number.isInteger(v) && v > 0;
  if (!posInt(spec.grid?.perRow)) errs.push('每列張數要是正整數');
  if (!posInt(spec.grid?.blockRows)) errs.push('每頁列數要是正整數');
  if (!(spec.photo?.maxW > 0) || !(spec.photo?.h > 0)) errs.push('照片框寬高要大於 0');
  if (!spec.block?.cols?.length) errs.push('缺欄寬');
  if (!spec.block?.rows?.length) errs.push('缺區塊列');
  const cells = (spec.block?.rows ?? []).flatMap((r) => r.cells ?? []);
  const photos = cells.filter((c) => c.kind === 'photo');
  if (photos.length !== 1) errs.push(`一個區塊要正好一個照片格（目前 ${photos.length} 個）`);
  for (const c of cells) {
    if (c.align != null && !(c.align in ALIGNS)) errs.push(`格子的水平對齊不合法：${c.align}`);
    if (c.vAlign != null && !(c.vAlign in VALIGNS)) errs.push(`格子的垂直對齊不合法：${c.vAlign}`);
  }
  for (const r of spec.block?.rows ?? []) {
    let cursor = 0;
    for (const c of r.cells ?? []) {
      const col = c.col ?? cursor;
      cursor = col + (c.colSpan ?? 1);
    }
    if (cursor > (spec.block.cols?.length ?? 0)) errs.push('區塊某一列的欄數超過欄寬定義');
  }
  const blank = cells
    .flatMap((c) => c.lines ?? [])
    .flatMap(lineParts)
    .filter((p) => isField(p) && p.field == null).length;
  if (blank) errs.push(`有 ${blank} 個說明格還沒指定欄位`);
  if (spec.unknown?.length) errs.push(`版型有 ${spec.unknown.length} 項沒解析出來：${spec.unknown.join('、')}`);
  return errs;
}

/** 這個版型會用到哪些資料欄位（'desc'、'seq'…）。 */
export function usedFields(spec) {
  const out = new Set();
  for (const row of spec?.block?.rows ?? []) {
    for (const cell of row.cells ?? []) {
      for (const line of cell.lines ?? []) {
        for (const p of lineParts(line)) if (p.field && p.field !== 'none') out.add(p.field);
      }
    }
  }
  return out;
}

/**
 * 預覽頁要編輯的說明欄位清單：把「只有欄位名的行」和它後面的「值」配成一組。
 * 回傳 [{ labelLine, valueLine }]；valueLine 是 null 代表這個欄位名沒配到值。
 */
export function fieldRows(spec) {
  const out = [];
  let pending = null;
  for (const row of spec.block?.rows ?? []) {
    for (const cell of row.cells ?? []) {
      if (cell.kind === 'photo') continue;
      for (const line of cell.lines ?? []) {
        const labelOnly = (line.field === 'none' || line.field == null) && line.label;
        if (labelOnly && !pending) {
          pending = line;
          continue;
        }
        out.push({ labelLine: pending ?? line, valueLine: line });
        pending = null;
      }
    }
  }
  if (pending) out.push({ labelLine: pending, valueLine: null });
  return out;
}

// ---------- 說明欄位的增／刪／搬（預覽頁拖曳用；純資料操作） ----------

const cellAt = (spec, r, c) => spec?.block?.rows?.[r]?.cells?.[c] ?? null;

/** 新增一行說明欄位。index 省略或超出範圍＝加在最後。回傳有沒有成功。 */
export function addLine(spec, r, c, line, index = null) {
  const cell = cellAt(spec, r, c);
  if (!cell || cell.kind === 'photo') return false; // 照片格不能放欄位
  cell.lines = cell.lines ?? [];
  const at = index == null ? cell.lines.length : Math.max(0, Math.min(index, cell.lines.length));
  cell.lines.splice(at, 0, line);
  return true;
}

/** 刪掉一行說明欄位。 */
export function removeLine(spec, r, c, i) {
  const cell = cellAt(spec, r, c);
  if (!cell?.lines?.[i]) return false;
  cell.lines.splice(i, 1);
  return true;
}

/**
 * 把一行搬到別的位置。from: {r,c,i}；to: {r,c,index}（index 省略＝放最後）。
 * 放不進去（例如目標是照片格）就原封不動。
 */
export function moveLine(spec, from, to) {
  const src = cellAt(spec, from.r, from.c);
  if (!src?.lines?.[from.i]) return false;
  const dst = cellAt(spec, to.r, to.c);
  if (!dst || dst.kind === 'photo') return false;
  const [line] = src.lines.splice(from.i, 1);
  let index = to.index;
  // 同一格往後搬：抽掉自己之後，後面的位置會往前挪一格
  if (index != null && to.r === from.r && to.c === from.c && index > from.i) index -= 1;
  addLine(spec, to.r, to.c, line, index);
  return true;
}
