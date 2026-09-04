// 入口頁的版型預覽：左邊照 LayoutSpec 畫出版面示意（可拖曳交換填入順序），
// 右邊校正解析結果（抬頭、每頁幾張、欄位對應、日期戳）。純邏輯在 template/spec.js。

import { FIELDS, slotOrder, swapSlots, fieldRows, validateSpec } from '../template/spec.js';
import { esc } from './dialog.js';

const PAGE_W = 300; // 示意圖寬度（px）
const LINE_H = 420; // 沒寫高度的列：照行數估一個相對高度，示意圖才不會擠成一團

let seq = 0; // 同一頁可能有多個預覽，radio 的 name 要分開

const FIELD_OPTIONS = (sel) =>
  [['', '（未指定）'], ...Object.entries(FIELDS)]
    .map(([k, label]) => `<option value="${k}" ${(sel ?? '') === k ? 'selected' : ''}>${esc(label)}</option>`)
    .join('');

const cellLabels = (cell) => (cell.lines ?? []).map((l) => l.label || FIELDS[l.field] || '');

/** 一個區塊：照 block.cols / block.rows 排出來，照片格與說明格的相對位置才看得出來。 */
function blockHtml(spec) {
  const cols = spec.block.cols.map((w) => `${w}fr`).join(' ');
  const rows = spec.block.rows
    .map((r) => {
      if (r.h) return `${r.h}fr`;
      const lines = Math.max(1, ...(r.cells ?? []).map((c) => (c.lines ?? []).length));
      return `${lines * LINE_H}fr`;
    })
    .join(' ');
  const cells = spec.block.rows
    .flatMap((row, r) =>
      (row.cells ?? []).map((c) => {
        const area = `grid-area:${r + 1}/${(c.col ?? 0) + 1}/span ${c.rowSpan ?? 1}/span ${c.colSpan ?? 1}`;
        if (c.kind === 'photo') return `<div class="tpl-photo" style="${area}">📷</div>`;
        const labels = cellLabels(c)
          .map((l) => `<div class="tpl-cap">${esc(l)}</div>`)
          .join('');
        return `<div class="tpl-cell" style="${area}">${labels}</div>`;
      }),
    )
    .join('');
  return `<div class="tpl-block" style="grid-template-columns:${cols};grid-template-rows:${rows}">${cells}</div>`;
}

function pageHtml(spec) {
  const { perRow, blockRows } = spec.grid;
  const ratio = spec.page.h / spec.page.w;
  const order = slotOrder(spec);
  const block = blockHtml(spec);
  const slots = [];
  for (let i = 0; i < perRow * blockRows; i++) {
    slots.push(
      `<div class="tpl-slot" draggable="true" data-slot="${i}" title="拖曳可以和別格交換順序">
        <span class="tpl-no">${order.indexOf(i) + 1}</span>${block}
      </div>`,
    );
  }
  const heading = (spec.heading.lines ?? []).map((l) => `<div class="tpl-head">${esc(l.text)}</div>`).join('');
  return `
    <div class="tpl-page" style="width:${PAGE_W}px;height:${Math.round(PAGE_W * ratio)}px">
      ${heading}
      <div class="tpl-grid" style="grid-template-columns:repeat(${perRow},1fr)">${slots.join('')}</div>
    </div>`;
}

function formHtml(spec, rows, name) {
  const errs = validateSpec(spec);
  const heading = (spec.heading.lines ?? [])
    .map(
      (l, i) => `
      <div class="tpl-line">
        <input type="text" data-head="${i}" value="${esc(l.text)}">
        <input type="number" class="tpl-num" data-head-size="${i}" value="${l.sizePt}" min="6" max="48" title="字級 pt">
      </div>`,
    )
    .join('');
  const fields = rows
    .map(
      ({ labelLine, valueLine }, i) => `
      <div class="tpl-line">
        <input type="text" data-label="${i}" value="${esc(labelLine.label)}" placeholder="（沒有欄位名）">
        <select data-field="${i}" ${valueLine ? '' : 'disabled'} class="${valueLine && valueLine.field == null ? 'tpl-need' : ''}">
          ${FIELD_OPTIONS(valueLine ? valueLine.field : 'none')}
        </select>
      </div>`,
    )
    .join('');
  return `
    ${errs.length ? `<div class="tpl-errs">這個版型還不能用：<ul>${errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
    <label class="tpl-sec">抬頭（{date} 會換成這次的檢查日期）</label>
    <div class="tpl-sub small muted">位置：${spec.heading.place === 'header' ? '頁首（每頁重複）' : '內文（只有第一頁）'}</div>
    ${heading || '<div class="small muted">這份版型沒有抬頭</div>'}

    <label class="tpl-sec">版面</label>
    <div class="tpl-line">
      <span class="small">每列張數</span><input type="number" class="tpl-num" data-grid="perRow" value="${spec.grid.perRow}" min="1" max="6">
      <span class="small">每頁列數</span><input type="number" class="tpl-num" data-grid="blockRows" value="${spec.grid.blockRows}" min="1" max="12">
    </div>
    <div class="tpl-line">
      <span class="small">照片框</span>
      <input type="number" class="tpl-num" data-photo="maxW" value="${Math.round(spec.photo.maxW)}" min="10" max="2000" title="最大寬度 px">
      <span class="small">×</span>
      <input type="number" class="tpl-num" data-photo="h" value="${Math.round(spec.photo.h)}" min="10" max="2000" title="高度 px">
      <span class="small muted">px</span>
    </div>

    <label class="tpl-sec">填入順序（也可以直接拖曳左邊的格子交換）</label>
    <div class="tpl-line">
      <label class="small"><input type="radio" name="${name}" value="row" ${spec.grid.order === 'row' ? 'checked' : ''}> 由左至右</label>
      <label class="small"><input type="radio" name="${name}" value="col" ${spec.grid.order === 'col' ? 'checked' : ''}> 由上而下</label>
      <button type="button" class="btn tiny" data-reset-order>重設編號</button>
    </div>

    <label class="tpl-sec">說明欄位對應</label>
    ${fields || '<div class="small muted">這份版型沒有說明格</div>'}

    <label class="tpl-sec">照片日期戳</label>
    <label class="small"><input type="checkbox" data-stamp ${spec.stamp.on ? 'checked' : ''}> 在照片左下角印上檢查日期</label>`;
}

/**
 * 把預覽掛到 container。spec 會被就地修改；每次改動呼叫 onChange(spec)。
 */
export function renderTemplatePreview(container, spec, onChange) {
  const name = `tpl-order-${++seq}`;

  const draw = () => {
    const rows = fieldRows(spec);
    container.innerHTML = `<div class="tpl">${pageHtml(spec)}<div class="tpl-form">${formHtml(spec, rows, name)}</div></div>`;
    bind(rows);
  };
  const changed = () => {
    onChange?.(spec);
    draw();
  };

  function bind(rows) {
    const $$ = (s) => [...container.querySelectorAll(s)];
    const on = (sel, fn, ev = 'change') => $$(sel).forEach((el) => el.addEventListener(ev, () => fn(el)));

    on('[data-head]', (el) => {
      spec.heading.lines[Number(el.dataset.head)].text = el.value;
      changed();
    });
    on('[data-head-size]', (el) => {
      spec.heading.lines[Number(el.dataset.headSize)].sizePt = Number(el.value) || 14;
      changed();
    });
    on('[data-grid]', (el) => {
      spec.grid[el.dataset.grid] = Math.max(1, Number(el.value) || 1);
      spec.grid.seq = null; // 格數變了，之前拖出來的順序不再適用
      changed();
    });
    on('[data-photo]', (el) => {
      spec.photo[el.dataset.photo] = Number(el.value) || 0;
      changed();
    });
    on('[data-label]', (el) => {
      rows[Number(el.dataset.label)].labelLine.label = el.value;
      changed();
    });
    on('[data-field]', (el) => {
      const row = rows[Number(el.dataset.field)];
      if (row.valueLine) row.valueLine.field = el.value || null;
      changed();
    });
    on(`input[name="${name}"]`, (el) => {
      if (!el.checked) return;
      spec.grid.order = el.value;
      spec.grid.seq = null;
      changed();
    });
    on('[data-stamp]', (el) => {
      spec.stamp.on = el.checked;
      changed();
    });
    on(
      '[data-reset-order]',
      () => {
        spec.grid.seq = null;
        changed();
      },
      'click',
    );

    // 拖曳交換填入順序
    let from = null;
    $$('.tpl-slot').forEach((el) => {
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
          changed();
        }
      });
    });
  }

  draw();
}
