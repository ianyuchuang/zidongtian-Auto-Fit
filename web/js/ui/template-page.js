// 版型調整頁：整頁畫出接近實際大小的版面，直接在頁面上改。
// 抬頭與欄位名是可直接打字的文字；每個值的位置放一個下拉選它要填什麼；
// 格子上的號碼＝填照順序，可以拖曳交換。版型的資料結構與純邏輯在 template/spec.js。

import { esc, toast } from './dialog.js';
import { bindFileDrop } from './dnd.js';
import { parseTemplateDocx } from '../template/parse.js';
import { FIELDS, slotOrder, swapSlots, validateSpec, blockWidth } from '../template/spec.js';
import { saveTemplate } from '../template/library.js';

const PX = (twips) => twips / 15; // 1440 twips = 1 吋 = 96px
const PT = (pt) => (pt * 4) / 3; // 1pt = 96/72 px

const FIELD_OPTIONS = (sel) =>
  [['', '（未指定）'], ...Object.entries(FIELDS)]
    .map(([k, label]) => `<option value="${k}" ${(sel ?? '') === k ? 'selected' : ''}>${esc(label)}</option>`)
    .join('');

export function mountTemplatePage(container, app) {
  let spec = null;
  let name = '';
  let fileName = '';

  container.innerHTML = `
    <div class="tplpage">
      <div class="tplbar">
        <button class="btn" data-act="back">← 回入口頁</button>
        <b>版型調整</b>
        <span class="small muted" id="tpl-file"></span>
        <span class="spacer"></span>
        <input type="text" id="tpl-name" placeholder="版型名稱" hidden>
        <button class="btn" data-act="save" hidden>存成版型</button>
        <button class="btn btn-primary" data-act="use" hidden>完成，使用這個版型</button>
      </div>
      <div class="tpltools" id="tpl-tools" hidden></div>
      <div class="tplerrs" id="tpl-errs" hidden></div>
      <div class="tplstage" id="tpl-stage"></div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  const stage = $('#tpl-stage');

  // ---------- 讀檔 ----------
  function dropzoneHtml() {
    return `
      <div class="tpl-drop" id="tpl-drop">
        <div><b>點選或把 docx 拖到這裡</b></div>
        <div class="small muted">會讀出它的版面（頁面大小、抬頭、每頁幾張、說明欄位、照片日期戳），讀完可以在這一頁直接改。</div>
        <input type="file" id="tpl-file-input" accept=".docx" hidden>
      </div>`;
  }

  async function load(file) {
    stage.innerHTML = `<div class="tpl-drop"><div class="muted">解析中…</div></div>`;
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

  function bindDropzone() {
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

  // ---------- 版面（所見即所得） ----------
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
    const lines = (cell.lines ?? [])
      .map((l, i) => {
        const label = `<span class="tp-label" contenteditable="plaintext-only" data-lb="${r}.${c}.${i}">${esc(l.label)}</span>`;
        // 只有欄位名、沒有值的行（例：獨立一格的「拍照日期」）就純顯示文字，
        // 它的值在別格，那一格才有下拉，畫面才不會到處都是「（留空）」。
        if (l.field === 'none' && l.label) return `<div class="tp-line">${label}</div>`;
        const title = l.field == null ? '還沒指定要填什麼' : `這裡會填「${FIELDS[l.field] ?? ''}」`;
        return `<div class="tp-line">${label}
          <select class="tp-field ${l.field == null ? 'need' : ''}" data-fd="${r}.${c}.${i}" title="${esc(title)}">${FIELD_OPTIONS(l.field)}</select>
        </div>`;
      })
      .join('');
    return `<div class="tp-cell tp-text" style="${area};font-size:${size}px">${lines}</div>`;
  }

  function blockHtml(spec) {
    const cols = spec.block.cols.map((w) => `${PX(w)}px`).join(' ');
    const rows = spec.block.rows.map((r) => (r.h ? `${PX(r.h)}px` : 'auto')).join(' ');
    const cells = spec.block.rows
      .map((row, r) => (row.cells ?? []).map((cell, c) => cellHtml(spec, r, cell, c)).join(''))
      .join('');
    return `<div class="tp-block" style="grid-template-columns:${cols};grid-template-rows:${rows}">${cells}</div>`;
  }

  function pageHtml(spec) {
    const order = slotOrder(spec);
    const block = blockHtml(spec);
    const n = spec.grid.perRow * spec.grid.blockRows;
    const slots = [];
    for (let i = 0; i < n; i++) {
      slots.push(`<div class="tp-slot" draggable="true" data-slot="${i}"><span class="tp-no" title="填照順序，可拖曳交換">${order.indexOf(i) + 1}</span>${block}</div>`);
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
        <div class="tp-heading" data-place="${spec.heading.place}">${heading}</div>
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
      <span class="small muted">抬頭在${spec.heading.place === 'header' ? '頁首（每頁重複）' : '內文（只有第一頁）'}；{date} 會換成該資料夾的檢查日期</span>`;
  }

  // ---------- 畫面 ----------
  function render() {
    const has = !!spec;
    $('#tpl-file').textContent = has ? fileName : '';
    for (const sel of ['#tpl-name', '[data-act="save"]', '[data-act="use"]']) $(sel).hidden = !has;
    $('#tpl-tools').hidden = !has;
    if (!has) {
      $('#tpl-errs').hidden = true;
      stage.innerHTML = dropzoneHtml();
      bindDropzone();
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

  const at = (k) => k.split('.').map(Number);

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

    // 拖曳交換填照順序
    let from = null;
    $$('.tp-slot').forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        from = Number(el.dataset.slot);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(from));
      });
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        el.classList.add('over');
      });
      el.addEventListener('dragleave', () => el.classList.remove('over'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('over');
        const a = from ?? Number(e.dataTransfer.getData('text/plain'));
        const b = Number(el.dataset.slot);
        if (Number.isInteger(a) && a !== b) {
          swapSlots(spec, a, b);
          render();
        }
      });
    });
  }

  // 工具列與頂列（掛在容器上，重畫也不會掉）
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

  container.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'back') {
      app.closeTemplatePage();
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
