// 版型頁：兩個步驟。
//   1. 選版型：列出這台電腦存過的版型，或點選／拖入一份 docx（Word）或 xlsx（Excel）來讀。
//   2. 版型調整：整頁畫出接近實際大小的版面，直接在頁面上改——抬頭與說明格點下去就能打字，
//      要填值的位置是一顆「欄位膠囊」（下拉可換欄位、選「（留空）」就移除），
//      從上面的工具列把欄位拖進句子裡就多一個，拖到行與行之間就多一行，也可以拖到別格或刪掉。
//      Enter＝分段（切成上下兩行）、Shift+Enter＝段落內換行，和 Word 一樣。
//      格子上按右鍵可選這一格的水平／垂直對齊（照片格也可以）。
// 版型的資料結構與純邏輯在 template/spec.js。

import { esc, toast, confirmDialog } from './dialog.js';
import { bindFileDrop, templateKind } from './dnd.js';
import { parseTemplateDocx } from '../template/parse.js';
import { parseTemplateXlsx } from '../template/parse-xlsx.js';
import {
  defaultSpec,
  FIELDS,
  ALIGNS,
  VALIGNS,
  slotOrder,
  swapSlots,
  validateSpec,
  blockWidth,
  addLine,
  removeLine,
  moveLine,
  perPage,
  lineParts,
  makeLine,
  cellAlign,
  setCellAlign,
} from '../template/spec.js';
import { listTemplates, getTemplate, saveTemplate, removeTemplate } from '../template/library.js';

const PX = (twips) => twips / 15; // 1440 twips = 1 吋 = 96px
const PT = (pt) => (pt * 4) / 3; // 1pt = 96/72 px

// 可以拖進表格的欄位（「拖到表格中新增選項」）
const ADDABLE = [
  ['desc', '內容說明'],
  ['design', '設計值'],
  ['actual', '實際值'],
  ['seq', '照片編號'],
  ['photoDate', '拍照日期'],
  ['none', '文字'],
];

const newLine = (field) => (field === 'none' ? { label: '文字', field: 'none' } : { label: '', field });

const FIELD_OPTIONS = (sel) =>
  [['', '（未指定）'], ...Object.entries(FIELDS)]
    .map(([k, label]) => `<option value="${k}" ${(sel ?? '') === k ? 'selected' : ''}>${esc(label)}</option>`)
    .join('');

const at = (k) => k.split('.').map(Number);

/** 要填值的位置：一顆可換欄位的膠囊。field 為 null＝還沒指定（紅字）。 */
function tagHtml(field) {
  const need = field == null;
  const title = need ? '還沒指定要填什麼' : `這裡會填「${FIELDS[field] ?? ''}」，選「（留空）」可以移除`;
  return `<span class="tp-tag" contenteditable="false" data-field="${field ?? ''}" title="${esc(title)}"
    ><select class="tp-field ${need ? 'need' : ''}">${FIELD_OPTIONS(field)}</select></span>`;
}

/**
 * 一行的內容畫成 HTML：文字、<br>、欄位膠囊。field 'none' 不畫（畫面才不會到處是「（留空）」）。
 * 結尾是換行時多補一顆 <br>：contenteditable 把最後一顆 <br> 當佔位符不顯示，
 * 只畫一顆的話那個換行看不見、readParts 讀回來也會被當佔位符丟掉（和瀏覽器在結尾按 Shift+Enter 補兩顆一樣）。
 */
export function partsHtml(parts) {
  const shown = parts.filter((p) => p.br || p.text != null || p.field !== 'none');
  const html = shown.map((p) => (p.br ? '<br>' : p.text != null ? esc(p.text) : tagHtml(p.field))).join('');
  return shown.length && shown[shown.length - 1].br ? html + '<br>' : html;
}

/**
 * 把畫面上的一行讀回資料：文字節點是文字，膠囊是欄位，<br> 是段落內換行。
 * 結尾連著兩顆 <br> 時最後那顆是瀏覽器補的佔位符（結尾按 Shift+Enter 會這樣），只留一顆；
 * 單獨一顆結尾 <br> 是使用者的換行（partsHtml 畫出來就是兩顆），不能丟。
 */
export function readParts(el) {
  const nodes = [...el.childNodes];
  const n = nodes.length;
  if (n >= 2 && nodes[n - 1].nodeName === 'BR' && nodes[n - 2].nodeName === 'BR') nodes.pop();
  const out = [];
  for (const node of nodes) {
    if (node.nodeType === 3) out.push({ text: node.nodeValue }); // TEXT_NODE
    else if (node.nodeName === 'BR') out.push({ br: true });
    else if (node.nodeType === 1 && node.classList.contains('tp-tag')) out.push({ field: node.dataset.field || null });
    else if (node.nodeType === 1) out.push({ text: node.textContent }); // 瀏覽器自己塞的 <div> 之類
  }
  return out;
}

/** 格子右鍵選單的內容：水平／垂直各三項，目前的選擇打勾。r、c 由呼叫端放在選單的 dataset 上。 */
export function alignMenuHtml(cell) {
  const cur = cellAlign(cell);
  const items = (title, key, opts) =>
    `<div class="tp-menu-title">${title}</div>` +
    Object.entries(opts)
      .map(
        ([v, label]) =>
          `<button type="button" class="tp-menu-item ${cur[key] === v ? 'on' : ''}" data-${key === 'align' ? 'align' : 'valign'}="${v}">${cur[key] === v ? '<span class="tp-menu-tick">✓</span>' : ''}${esc(label)}</button>`,
      )
      .join('');
  return items('水平', 'align', ALIGNS) + items('垂直', 'vAlign', VALIGNS);
}

/** 數字框讀回來：不是數字就用 fallback，四捨五入成整數再夾進 [min, max]（打 2.5、空白、0 都不會漏成 0×0）。 */
export function clampInt(value, min, max, fallback) {
  const n = Number(value);
  const base = value === '' || value == null || !Number.isFinite(n) ? fallback : n;
  return Math.min(max, Math.max(min, Math.round(Number(base) || min)));
}

/**
 * 掛版型頁。回傳 unmount：拆頁時要呼叫，把掛在共用容器與 window 上的事件收掉。
 * 不收的話每進一次版型頁就多一套舊閉包（spec 是舊的）：按「存成版型」會跳好幾個
 * 「儲存成功」、實際套用的卻是上一次的版型（2026-09-04 的 bug）。
 */
export function mountTemplatePage(container, app) {
  let spec = null;
  let name = '';
  let fileName = '';
  let drag = null; // 正在拖的說明欄位：{ line } 新增 | { from:{r,c,i} } 搬移
  const ac = new AbortController();
  const { signal } = ac; // 掛在容器／window 上（不隨 render 重畫）的監聽都帶這個 signal

  container.innerHTML = `
    <div class="tplpage">
      <div class="tplhead">
        <div class="tplbar">
          <button class="btn" data-act="back">← 回入口頁</button>
          <b id="tpl-title">選版型</b>
          <span class="small muted" id="tpl-file"></span>
          <span class="spacer"></span>
          <input type="text" id="tpl-name" placeholder="版型名稱" hidden>
          <button class="btn" data-act="save" hidden>存成版型</button>
          <button class="btn btn-primary" data-act="use" hidden>完成，使用這個版型</button>
        </div>
        <div class="tpltools" id="tpl-tools" hidden></div>
        <div class="tplerrs" id="tpl-errs" hidden></div>
      </div>
      <div class="tplstage" id="tpl-stage"></div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  const stage = $('#tpl-stage');

  // ---------- 步驟 1：選版型 ----------
  function pickHtml() {
    const saved = listTemplates();
    const cards = saved
      .map((t) => {
        const s = t.spec;
        const summary = `${s.page?.orient === 'landscape' ? '橫式' : '直式'}・每頁 ${perPage(s)} 張（${s.grid.blockRows} 列 × ${s.grid.perRow}）`;
        return `
          <div class="tplcard" data-id="${esc(t.id)}">
            <div class="tplcard-name">📄 ${esc(t.name)}</div>
            <div class="small muted">${esc(summary)}</div>
            <div class="tplcard-btns">
              <button class="btn btn-primary" data-act="pick-use" data-id="${esc(t.id)}">使用</button>
              <button class="btn" data-act="pick-edit" data-id="${esc(t.id)}">調整</button>
              <button class="btn btn-danger" data-act="pick-del" data-id="${esc(t.id)}">刪除</button>
            </div>
          </div>`;
      })
      .join('');
    return `
      <div class="tplpick">
        <div class="tplpick-sec">這台電腦存過的版型</div>
        <div class="tplpick-list">
          ${cards || '<div class="small muted">還沒存過版型。讀一份 docx 或 xlsx、調好之後按「存成版型」就會出現在這裡。</div>'}
          <div class="tplcard default">
            <div class="tplcard-name">預設版面（V1.0）</div>
            <div class="small muted">直式・每頁 6 張（3 列 × 2）・標楷體</div>
            <div class="tplcard-btns">
              <button class="btn" data-act="use-default">使用</button>
              <button class="btn" data-act="edit-default">調整</button>
            </div>
          </div>
        </div>
        <div class="tplpick-sec">或讀一份新的版型</div>
        <div class="tpl-drop" id="tpl-drop">
          <div><b>點選或把 docx／xlsx 拖到這裡</b></div>
          <div class="small muted">Word 或 Excel 的自檢表都可以：會讀出它的版面（頁面大小、抬頭、每頁幾張、說明欄位、照片日期戳），讀完就進調整頁。</div>
          <input type="file" id="tpl-file-input" accept=".docx,.xlsx" hidden>
        </div>
      </div>`;
  }

  function bindPick() {
    const dz = $('#tpl-drop');
    if (!dz) return;
    dz.addEventListener('click', () => $('#tpl-file-input').click());
    $('#tpl-file-input').addEventListener('change', (e) => e.target.files[0] && load(e.target.files[0]));
    bindFileDrop(dz, (dt) => {
      const f = dt.files?.[0];
      if (f && templateKind(f.name)) return load(f);
      if (f && /\.(doc|xls)$/i.test(f.name)) toast('舊的 .doc／.xls 讀不了，請先用 Word 或 Excel 另存成 .docx／.xlsx', { error: true });
      else toast('請拖入 docx 或 xlsx 檔', { error: true });
    });
  }

  async function load(file) {
    stage.innerHTML = '<div class="tpl-drop"><div class="muted">解析中…</div></div>';
    try {
      const kind = templateKind(file.name);
      if (!kind) throw new Error('只讀得懂 docx（Word）與 xlsx（Excel）');
      const base = file.name.replace(/\.(docx|xlsx)$/i, '');
      const parse = kind === 'xlsx' ? parseTemplateXlsx : parseTemplateDocx;
      spec = await parse(await file.arrayBuffer(), base);
      name = spec.name || base;
      fileName = file.name;
      render();
    } catch (e) {
      console.error(e);
      spec = null;
      render();
      toast(`讀不懂這份版型：${e.message}`, { error: true });
    }
  }

  // ---------- 步驟 2：版型調整（所見即所得） ----------

  /** 一行＝可以直接打字的一段，中間穿插欄位膠囊。 */
  function lineHtml(spec, r, c, l, i) {
    const key = `${r}.${c}.${i}`;
    const inner = partsHtml(lineParts(l));
    const tools = `<span class="tp-grip" draggable="true" data-grip="${key}" title="拖曳搬到別的位置">⠿</span>`;
    const del = `<button type="button" class="tp-del" data-del="${key}" title="刪掉這一行">×</button>`;
    const body = `<span class="tp-parts" contenteditable="true" spellcheck="false" data-parts="${key}"
      title="可以直接打字（逗號、單位…），欄位從上面的工具列拖進來">${inner}</span>`;
    return `<div class="tp-line" data-line="${key}">${tools}${body}${del}</div>`;
  }

  function cellHtml(spec, r, cell, c) {
    const area = `grid-area:${r + 1}/${(cell.col ?? 0) + 1}/span ${cell.rowSpan ?? 1}/span ${cell.colSpan ?? 1}`;
    const { align, vAlign } = cellAlign(cell);
    if (cell.kind === 'photo') {
      return `<div class="tp-cell tp-photo" data-cell="${r}.${c}" data-align="${align}" data-valign="${vAlign}" style="${area}">
        <div class="tp-photobox" style="width:${Math.round(spec.photo.maxW)}px;height:${Math.round(spec.photo.h)}px">
          <span>照片</span><span class="small">${Math.round(spec.photo.maxW)}×${Math.round(spec.photo.h)}</span>
        </div>
      </div>`;
    }
    const size = PT(cell.sizePt ?? spec.caption.sizePt);
    const lines = (cell.lines ?? []).map((l, i) => lineHtml(spec, r, c, l, i)).join('');
    return `<div class="tp-cell tp-text" data-cell="${r}.${c}" data-align="${align}" data-valign="${vAlign}" style="${area};font-size:${size}px">${lines}</div>`;
  }

  function blockHtml(spec) {
    const cols = spec.block.cols.map((w) => `${PX(w)}px`).join(' ');
    // 列高用 minmax：Word 的 trHeight 是「至少」，內容多了就撐開，預覽也照這樣長
    const rows = spec.block.rows.map((r) => (r.h ? `minmax(${PX(r.h)}px, auto)` : 'auto')).join(' ');
    const cells = spec.block.rows.map((row, r) => (row.cells ?? []).map((cell, c) => cellHtml(spec, r, cell, c)).join('')).join('');
    return `<div class="tp-block" style="grid-template-columns:${cols};grid-template-rows:${rows}">${cells}</div>`;
  }

  function pageHtml(spec) {
    const order = slotOrder(spec);
    const block = blockHtml(spec);
    const slots = [];
    for (let i = 0; i < perPage(spec); i++) {
      slots.push(
        `<div class="tp-slot" draggable="true" data-slot="${i}"><span class="tp-no" title="填照順序，可拖曳交換">${order.indexOf(i) + 1}</span>${block}</div>`,
      );
    }
    const heading = (spec.heading.lines ?? [])
      .map(
        (l, i) =>
          `<div class="tp-head" contenteditable="plaintext-only" data-hd="${i}"
                style="font-size:${PT(l.sizePt)}px;font-weight:${l.bold ? 700 : 400};text-align:${l.align === 'center' ? 'center' : 'left'}">${esc(l.text)}</div>`,
      )
      .join('');
    return `
      <div class="tp-page" style="width:${PX(spec.page.w)}px;height:${PX(spec.page.h)}px;
        padding:${PX(spec.page.margin.t)}px ${PX(spec.page.margin.r)}px ${PX(spec.page.margin.b)}px ${PX(spec.page.margin.l)}px;
        font-family:'標楷體','DFKai-SB',serif">
        <div class="tp-heading">${heading}</div>
        <div class="tp-grid" style="grid-template-columns:repeat(${spec.grid.perRow},${PX(blockWidth(spec))}px)">${slots.join('')}</div>
      </div>`;
  }

  function toolsHtml(spec) {
    return `
      <label class="small">每列張數 <input type="number" class="tp-num" data-grid="perRow" value="${spec.grid.perRow}" min="1" max="6"></label>
      <label class="small">每頁列數 <input type="number" class="tp-num" data-grid="blockRows" value="${spec.grid.blockRows}" min="1" max="12"></label>
      <label class="small">照片框 <input type="number" class="tp-num" data-photo="maxW" value="${Math.round(spec.photo.maxW)}" min="10" max="2000"> × <input type="number" class="tp-num" data-photo="h" value="${Math.round(spec.photo.h)}" min="10" max="2000"> px</label>
      <span class="tp-sep"></span>
      <span class="small">填照順序</span>
      <label class="small"><input type="radio" name="tp-order" value="row" ${spec.grid.order === 'row' ? 'checked' : ''}> 由左至右</label>
      <label class="small"><input type="radio" name="tp-order" value="col" ${spec.grid.order === 'col' ? 'checked' : ''}> 由上而下</label>
      <button type="button" class="btn tiny" data-act="reset-order">重設</button>
      <span class="tp-sep"></span>
      <label class="small"><input type="checkbox" data-stamp ${spec.stamp.on ? 'checked' : ''}> 照片左下角印檢查日期</label>
      <span class="tp-sep"></span>
      <span class="tp-palette">
        <span class="small muted">拖到表格中新增選項</span>
        ${ADDABLE.map(([k, label]) => `<span class="tp-chip" draggable="true" data-add="${k}">${esc(label)}</span>`).join('')}
      </span>`;
  }

  // ---------- 畫面 ----------
  function render() {
    const has = !!spec;
    $('#tpl-title').textContent = has ? '版型調整' : '選版型';
    $('#tpl-file').textContent = has ? fileName : '';
    for (const sel of ['#tpl-name', '[data-act="save"]', '[data-act="use"]']) $(sel).hidden = !has;
    $('#tpl-tools').hidden = !has;
    if (!has) {
      $('#tpl-errs').hidden = true;
      stage.style.height = '';
      stage.innerHTML = pickHtml();
      bindPick();
      return;
    }
    $('#tpl-name').value = name;
    $('#tpl-tools').innerHTML = toolsHtml(spec);
    refreshErrs();
    stage.innerHTML = pageHtml(spec);
    fit();
    bindPage();
  }

  /** 只更新錯誤列與「完成」鈕（打字時要用，重畫會把游標弄掉）。 */
  function refreshErrs() {
    const errs = validateSpec(spec);
    $('#tpl-errs').hidden = errs.length === 0;
    $('#tpl-errs').innerHTML = errs.length ? `這個版型還不能用：<ul>${errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : '';
    $('[data-act="use"]').disabled = errs.length > 0;
  }

  /** 頁面比畫面寬就整頁縮小（只縮顯示，不動版型本身）。 */
  function fit() {
    const page = stage.querySelector('.tp-page');
    if (!page) return;
    const avail = stage.clientWidth - 40;
    const scale = Math.min(1, avail / page.offsetWidth);
    page.style.transform = `scale(${scale})`;
    stage.style.height = `${page.offsetHeight * scale + 40}px`;
  }
  window.addEventListener('resize', fit, { signal });

  // ---------- 拖曳：新增 / 搬移說明欄位 ----------
  const clearDropMarks = () => stage.querySelectorAll('.drop-into').forEach((el) => el.classList.remove('drop-into'));

  /** 滑鼠停在哪一行的上半／下半，決定插在第幾個位置；沒停在行上就放最後。 */
  function dropIndex(cellEl, e) {
    const line = e.target.closest('.tp-line');
    if (!line || !cellEl.contains(line)) return null;
    const [, , i] = at(line.dataset.line);
    const box = line.getBoundingClientRect();
    return e.clientY > box.top + box.height / 2 ? i + 1 : i;
  }

  /** 把一個欄位（或「文字」）插進某一行，位置照滑鼠落點的游標。 */
  function insertIntoLine(partsEl, add, x, y) {
    const [r, c, i] = at(partsEl.dataset.parts);
    let node;
    if (add === 'none') {
      node = document.createTextNode('文字');
    } else {
      const tmp = document.createElement('span');
      tmp.innerHTML = tagHtml(add);
      node = tmp.firstElementChild;
    }
    const range = document.caretRangeFromPoint?.(x, y);
    if (range && partsEl.contains(range.startContainer)) range.insertNode(node);
    else partsEl.appendChild(node);
    spec.block.rows[r].cells[c].lines[i] = makeLine(readParts(partsEl));
  }

  /** Enter：從游標處把一行切成兩行（＝Word 的分段）。 */
  function splitLineAtCaret(el, r, c, i) {
    const sel = getSelection();
    const holder = document.createElement('span');
    if (sel?.rangeCount && el.lastChild) {
      const caret = sel.getRangeAt(0);
      const tail = document.createRange();
      tail.setStart(caret.endContainer, caret.endOffset);
      tail.setEndAfter(el.lastChild);
      holder.appendChild(tail.extractContents()); // 游標之後的內容搬到新的一行
    }
    spec.block.rows[r].cells[c].lines[i] = makeLine(readParts(el));
    addLine(spec, r, c, makeLine(readParts(holder)), i + 1);
    render();
    const next = container.querySelector(`[data-parts="${r}.${c}.${i + 1}"]`);
    if (next) caretToStart(next);
  }

  /** 把游標放到某一行的最前面。 */
  function caretToStart(el) {
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(true);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  /** 把游標放到某一行的最後面。 */
  function caretToEnd(el) {
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  /**
   * 點說明格的空白處也要能打字：格子比字高（例如圖片說明那種高格），
   * 或字被欄位膠囊佔滿時，點不到那一行就打不了字。這裡把游標接到最近的一行後面。
   */
  stage.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // 右鍵是開對齊選單，不動游標
    const cell = e.target.closest('.tp-text');
    if (!cell || e.target.closest('.tp-parts, select, button, .tp-grip')) return; // 本來就點在能操作的東西上
    const lines = [...cell.querySelectorAll('.tp-parts')];
    if (!lines.length) return;
    e.preventDefault(); // 不要讓瀏覽器把選取清掉
    let best = null;
    for (const el of lines) {
      const box = el.getBoundingClientRect();
      const d = Math.abs(e.clientY - (box.top + box.height / 2));
      if (!best || d < best.d) best = { el, d };
    }
    caretToEnd(best.el);
  }, { signal });

  function bindFieldDrag() {
    stage.addEventListener('dragover', (e) => {
      if (!drag) return;
      const cell = e.target.closest('.tp-text');
      clearDropMarks();
      if (!cell) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = drag.from ? 'move' : 'copy';
      cell.classList.add('drop-into');
    }, { signal });
    stage.addEventListener('drop', (e) => {
      if (!drag) return;
      const cell = e.target.closest('.tp-text');
      clearDropMarks();
      if (!cell) {
        drag = null;
        return;
      }
      e.preventDefault();
      const [r, c] = at(cell.dataset.cell);
      const partsEl = drag.add ? e.target.closest('.tp-parts') : null;
      if (partsEl) insertIntoLine(partsEl, drag.add, e.clientX, e.clientY);
      else if (drag.from) moveLine(spec, drag.from, { r, c, index: dropIndex(cell, e) });
      else addLine(spec, r, c, newLine(drag.add), dropIndex(cell, e));
      drag = null;
      render();
    }, { signal });
    stage.addEventListener('dragleave', (e) => {
      if (drag && !stage.contains(e.relatedTarget)) clearDropMarks();
    }, { signal });
  }
  bindFieldDrag();

  // 工具列的小標籤（新增選項）
  container.addEventListener('dragstart', (e) => {
    const chip = e.target.closest('.tp-chip');
    if (!chip) return;
    drag = { add: chip.dataset.add };
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', chip.dataset.add);
  }, { signal });
  container.addEventListener('dragend', () => {
    drag = null;
    clearDropMarks();
  }, { signal });

  function bindPage() {
    const $$ = (s) => [...container.querySelectorAll(s)];

    // 抬頭與欄位名：直接打字，不重畫（重畫會把游標弄掉）
    $$('[data-hd]').forEach((el) =>
      el.addEventListener('input', () => {
        spec.heading.lines[Number(el.dataset.hd)].text = el.textContent;
      }),
    );
    // 說明格：整行可以直接打字，欄位膠囊夾在字中間
    $$('[data-parts]').forEach((el) => {
      const [r, c, i] = at(el.dataset.parts);
      const sync = () => {
        spec.block.rows[r].cells[c].lines[i] = makeLine(readParts(el));
        refreshErrs();
      };
      el.addEventListener('input', sync);
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if (e.shiftKey) return; // Shift+Enter＝段落內換行，交給瀏覽器插 <br>
        e.preventDefault(); // Enter＝分段，切成上下兩行
        splitLineAtCaret(el, r, c, i);
      });
      el.addEventListener('paste', (e) => {
        e.preventDefault(); // 只收純文字，不要把 Word 的樣式和換行貼進來
        const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\s+/g, ' ');
        document.execCommand('insertText', false, text);
      });
      el.addEventListener('change', (e) => {
        const sel = e.target.closest('select');
        if (!sel) return;
        sel.closest('.tp-tag').dataset.field = sel.value; // 選「（留空）」＝這顆膠囊重畫時就不見了
        sync();
        render();
      });
    });
    $$('[data-del]').forEach((el) =>
      el.addEventListener('click', () => {
        const [r, c, i] = at(el.dataset.del);
        removeLine(spec, r, c, i);
        render();
      }),
    );
    // 說明欄位的拖曳把手
    $$('[data-grip]').forEach((el) =>
      el.addEventListener('dragstart', (e) => {
        e.stopPropagation(); // 不要被格子的「換填照順序」接走
        const [r, c, i] = at(el.dataset.grip);
        drag = { from: { r, c, i } };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', el.dataset.grip);
      }),
    );

    // 拖曳交換填照順序（拖整個格子）
    let from = null;
    $$('.tp-slot').forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        if (e.target !== el) return; // 從把手開始拖的不算
        from = Number(el.dataset.slot);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(from));
      });
      el.addEventListener('dragover', (e) => {
        if (drag) return; // 正在拖說明欄位
        e.preventDefault();
        el.classList.add('over');
      });
      el.addEventListener('dragleave', () => el.classList.remove('over'));
      el.addEventListener('dragend', () => {
        from = null; // 拖到一半放掉也要清，不然下次的 drop 會拿舊的來換
      });
      el.addEventListener('drop', (e) => {
        el.classList.remove('over');
        if (drag) return;
        e.preventDefault();
        const a = from ?? Number(e.dataTransfer.getData('text/plain'));
        from = null;
        const b = Number(el.dataset.slot);
        if (Number.isInteger(a) && a !== b) {
          swapSlots(spec, a, b);
          render();
        }
      });
    });
  }

  // ---------- 格子右鍵：選這一格的水平／垂直對齊 ----------
  let menu = null; // 一次只開一個
  const closeMenu = () => {
    menu?.remove();
    menu = null;
  };
  function openMenu(cellEl, x, y) {
    closeMenu();
    const [r, c] = at(cellEl.dataset.cell);
    menu = document.createElement('div');
    menu.className = 'tp-menu';
    menu.dataset.cell = cellEl.dataset.cell;
    menu.innerHTML = alignMenuHtml(spec.block.rows[r].cells[c]);
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);
    // 貼著視窗右／下緣時往回挪，別跑出畫面
    const box = menu.getBoundingClientRect();
    if (box.right > innerWidth) menu.style.left = `${Math.max(0, x - box.width)}px`;
    if (box.bottom > innerHeight) menu.style.top = `${Math.max(0, y - box.height)}px`;
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.tp-menu-item');
      if (!item) return;
      const change = item.dataset.align ? { align: item.dataset.align } : { vAlign: item.dataset.valign };
      setCellAlign(spec, r, c, change);
      closeMenu();
      render(); // 使用者這時沒在打字，整頁重畫沒關係
    });
  }
  container.addEventListener('contextmenu', (e) => {
    const cellEl = e.target.closest('.tp-cell');
    if (!spec || !cellEl?.dataset.cell) return; // 只擋格子上的右鍵，其他地方照瀏覽器預設
    e.preventDefault();
    openMenu(cellEl, e.clientX, e.clientY);
  }, { signal });
  // 點別處、按 Esc、捲動都關掉；拆頁時也要收掉（選單掛在 body 上，不會跟著容器消失）
  window.addEventListener('mousedown', (e) => {
    if (menu && !menu.contains(e.target)) closeMenu();
  }, { signal });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  }, { signal });
  window.addEventListener('scroll', closeMenu, { signal, capture: true });
  signal.addEventListener('abort', closeMenu);

  // ---------- 工具列與頂列（掛在容器上，重畫也不會掉） ----------
  container.addEventListener('change', (e) => {
    if (!spec) return;
    const t = e.target;
    if (t.dataset.grid) {
      spec.grid[t.dataset.grid] = clampInt(t.value, 1, Number(t.max) || 12, 1); // 打 2.5 或空白就修回整數
      spec.grid.seq = null; // 格數變了，之前拖出來的順序不再適用
      render();
    } else if (t.dataset.photo) {
      spec.photo[t.dataset.photo] = clampInt(t.value, Number(t.min) || 1, Number(t.max) || 2000, spec.photo[t.dataset.photo]);
      render();
    } else if (t.name === 'tp-order') {
      spec.grid.order = t.value;
      spec.grid.seq = null;
      render();
    } else if (t.dataset.stamp !== undefined && t.type === 'checkbox') {
      spec.stamp.on = t.checked;
    } else if (t.id === 'tpl-name') {
      name = t.value;
    }
  }, { signal });

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    const act = btn?.dataset.act;
    if (!act) return;
    if (act === 'back') {
      app.closeTemplatePage();
    } else if (act === 'use-default') {
      app.applyTemplate(null);
    } else if (act === 'pick-use') {
      const t = getTemplate(btn.dataset.id);
      if (t) app.applyTemplate({ name: t.name, file: null, spec: t.spec });
    } else if (act === 'edit-default') {
      // 預設版面也能拿來改（換抬頭、格數…），改完「完成」會存成一份新版型，預設本身不會被動到
      spec = defaultSpec();
      spec.name = ''; // 名稱留給使用者取，不要存成「預設（V1.0 版面）」
      name = '';
      fileName = '';
      render();
    } else if (act === 'pick-edit') {
      const t = getTemplate(btn.dataset.id);
      if (!t) return;
      spec = structuredClone(t.spec); // 改的是複本，不要動到庫裡那份
      name = t.name;
      fileName = '';
      render();
    } else if (act === 'pick-del') {
      const t = getTemplate(btn.dataset.id);
      if (!t) return;
      if (!(await confirmDialog('刪除版型', `要刪掉版型「${t.name}」嗎？`))) return;
      removeTemplate(t.id);
      render();
    } else if (act === 'reset-order') {
      if (!spec) return;
      spec.grid.seq = null;
      render();
    } else if (act === 'save') {
      if (!spec) return;
      const entry = saveTemplate(spec, $('#tpl-name').value || name);
      spec = entry.spec;
      name = entry.name;
      render();
      toast(`已存成版型「${entry.name}」`);
    } else if (act === 'use') {
      const errs = validateSpec(spec);
      if (errs.length) {
        toast(errs[0], { error: true });
        return;
      }
      // 「完成」＝先存進版型庫再使用：出去的 spec 一定帶著庫裡的 id，入口頁替資料夾記住的才是這一份。
      const entry = saveTemplate(spec, $('#tpl-name').value || name);
      toast(`已存成版型「${entry.name}」`);
      app.applyTemplate({ name: entry.name, file: null, spec: entry.spec });
    }
  }, { signal });

  render();
  if (app.state.templateFile) load(app.state.templateFile);
  return () => ac.abort();
}
