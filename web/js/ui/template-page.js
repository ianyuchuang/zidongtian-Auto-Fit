// 版型頁：兩個步驟。
//   1. 選版型：列出這台電腦存過的版型，或點選／拖入一份 docx 來讀。
//   2. 版型調整：整頁畫出接近實際大小的版面，直接在頁面上改——抬頭與欄位名點下去就能打字，
//      值的位置放下拉選它要填什麼，說明欄位可以從上面的工具列拖進來、也可以拖到別格或刪掉。
// 版型的資料結構與純邏輯在 template/spec.js。

import { esc, toast, confirmDialog } from './dialog.js';
import { bindFileDrop } from './dnd.js';
import { parseTemplateDocx } from '../template/parse.js';
import { FIELDS, slotOrder, swapSlots, validateSpec, blockWidth, addLine, removeLine, moveLine, perPage } from '../template/spec.js';
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

export function mountTemplatePage(container, app) {
  let spec = null;
  let name = '';
  let fileName = '';
  let drag = null; // 正在拖的說明欄位：{ line } 新增 | { from:{r,c,i} } 搬移

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
          ${cards || '<div class="small muted">還沒存過版型。讀一份 docx、調好之後按「存成版型」就會出現在這裡。</div>'}
          <div class="tplcard default">
            <div class="tplcard-name">預設版面（V1.0）</div>
            <div class="small muted">直式・每頁 6 張（3 列 × 2）・標楷體</div>
            <div class="tplcard-btns"><button class="btn" data-act="use-default">使用</button></div>
          </div>
        </div>
        <div class="tplpick-sec">或讀一份新的版型</div>
        <div class="tpl-drop" id="tpl-drop">
          <div><b>點選或把 docx 拖到這裡</b></div>
          <div class="small muted">會讀出它的版面（頁面大小、抬頭、每頁幾張、說明欄位、照片日期戳），讀完就進調整頁。</div>
          <input type="file" id="tpl-file-input" accept=".docx" hidden>
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
      if (f && /\.docx$/i.test(f.name)) return load(f);
      if (f && /\.doc$/i.test(f.name)) toast('舊的 .doc 讀不了，請先用 Word 另存成 .docx', { error: true });
      else toast('請拖入 docx 檔', { error: true });
    });
  }

  async function load(file) {
    stage.innerHTML = '<div class="tpl-drop"><div class="muted">解析中…</div></div>';
    try {
      spec = await parseTemplateDocx(await file.arrayBuffer(), file.name.replace(/\.docx$/i, ''));
      name = spec.name || file.name.replace(/\.docx$/i, '');
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
  function lineHtml(spec, r, c, l, i) {
    const key = `${r}.${c}.${i}`;
    const label = `<span class="tp-label" contenteditable="plaintext-only" data-lb="${key}">${esc(l.label)}</span>`;
    const tools = `<span class="tp-grip" draggable="true" data-grip="${key}" title="拖曳搬到別的位置">⠿</span>`;
    const del = `<button type="button" class="tp-del" data-del="${key}" title="刪掉這一行">×</button>`;
    // 只有欄位名、值在別格的行不放下拉，畫面才不會到處都是「（留空）」
    const select =
      l.field === 'none' && l.label
        ? ''
        : `<select class="tp-field ${l.field == null ? 'need' : ''}" data-fd="${key}"
             title="${esc(l.field == null ? '還沒指定要填什麼' : `這裡會填「${FIELDS[l.field] ?? ''}」`)}">${FIELD_OPTIONS(l.field)}</select>`;
    return `<div class="tp-line" data-line="${key}">${tools}${label}${select}${del}</div>`;
  }

  function cellHtml(spec, r, cell, c) {
    const area = `grid-area:${r + 1}/${(cell.col ?? 0) + 1}/span ${cell.rowSpan ?? 1}/span ${cell.colSpan ?? 1}`;
    if (cell.kind === 'photo') {
      return `<div class="tp-cell tp-photo" style="${area}">
        <div class="tp-photobox" style="width:${Math.round(spec.photo.maxW)}px;height:${Math.round(spec.photo.h)}px">
          <span>照片</span><span class="small">${Math.round(spec.photo.maxW)}×${Math.round(spec.photo.h)}</span>
        </div>
      </div>`;
    }
    const size = PT(cell.sizePt ?? spec.caption.sizePt);
    const lines = (cell.lines ?? []).map((l, i) => lineHtml(spec, r, c, l, i)).join('');
    return `<div class="tp-cell tp-text" data-cell="${r}.${c}" style="${area};font-size:${size}px">${lines}</div>`;
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
    const errs = validateSpec(spec);
    $('#tpl-errs').hidden = errs.length === 0;
    $('#tpl-errs').innerHTML = errs.length ? `這個版型還不能用：<ul>${errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : '';
    $('[data-act="use"]').disabled = errs.length > 0;
    stage.innerHTML = pageHtml(spec);
    fit();
    bindPage();
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
  window.addEventListener('resize', fit);

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

  function bindFieldDrag() {
    stage.addEventListener('dragover', (e) => {
      if (!drag) return;
      const cell = e.target.closest('.tp-text');
      clearDropMarks();
      if (!cell) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = drag.from ? 'move' : 'copy';
      cell.classList.add('drop-into');
    });
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
      const index = dropIndex(cell, e);
      if (drag.from) moveLine(spec, drag.from, { r, c, index });
      else addLine(spec, r, c, drag.line, index);
      drag = null;
      render();
    });
    stage.addEventListener('dragleave', (e) => {
      if (drag && !stage.contains(e.relatedTarget)) clearDropMarks();
    });
  }
  bindFieldDrag();

  // 工具列的小標籤（新增選項）
  container.addEventListener('dragstart', (e) => {
    const chip = e.target.closest('.tp-chip');
    if (!chip) return;
    drag = { line: newLine(chip.dataset.add) };
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', chip.dataset.add);
  });
  container.addEventListener('dragend', () => {
    drag = null;
    clearDropMarks();
  });

  function bindPage() {
    const $$ = (s) => [...container.querySelectorAll(s)];

    // 抬頭與欄位名：直接打字，不重畫（重畫會把游標弄掉）
    $$('[data-hd]').forEach((el) =>
      el.addEventListener('input', () => {
        spec.heading.lines[Number(el.dataset.hd)].text = el.textContent;
      }),
    );
    $$('[data-lb]').forEach((el) =>
      el.addEventListener('input', () => {
        const [r, c, i] = at(el.dataset.lb);
        spec.block.rows[r].cells[c].lines[i].label = el.textContent;
      }),
    );
    $$('[data-fd]').forEach((el) =>
      el.addEventListener('change', () => {
        const [r, c, i] = at(el.dataset.fd);
        spec.block.rows[r].cells[c].lines[i].field = el.value || null;
        render();
      }),
    );
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
      el.addEventListener('drop', (e) => {
        el.classList.remove('over');
        if (drag) return;
        e.preventDefault();
        const a = from ?? Number(e.dataTransfer.getData('text/plain'));
        const b = Number(el.dataset.slot);
        if (Number.isInteger(a) && a !== b) {
          swapSlots(spec, a, b);
          render();
        }
      });
    });
  }

  // ---------- 工具列與頂列（掛在容器上，重畫也不會掉） ----------
  container.addEventListener('change', (e) => {
    if (!spec) return;
    const t = e.target;
    if (t.dataset.grid) {
      spec.grid[t.dataset.grid] = Math.max(1, Number(t.value) || 1);
      spec.grid.seq = null; // 格數變了，之前拖出來的順序不再適用
      render();
    } else if (t.dataset.photo) {
      spec.photo[t.dataset.photo] = Number(t.value) || 0;
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
  });

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
    } else if (act === 'pick-edit') {
      const t = getTemplate(btn.dataset.id);
      if (!t) return;
      spec = t.spec;
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
      spec.grid.seq = null;
      render();
    } else if (act === 'save') {
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
      spec.name = $('#tpl-name').value || name;
      app.applyTemplate({ name: spec.name, file: null, spec });
    }
  });

  render();
  if (app.state.templateFile) load(app.state.templateFile);
}
