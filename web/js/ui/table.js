// 中欄：篩選 chip、搜尋、依資料夾分組的可編輯表格、拖曳換序 / 拖到群組列搬移。

import { CHIPS, CHIP_LABEL, STATUS_LABEL } from '../state.js';
import { esc, toast } from './dialog.js';

const FIELDS = ['desc', 'design', 'actual'];

export function mountTable(container, app) {
  container.className = 'main';
  container.innerHTML = `
    <div class="filters">
      ${CHIPS.map((c) => `<button class="chip" data-chip="${c}">${CHIP_LABEL[c]}<span class="n"></span></button>`).join('')}
      <input type="text" class="search" placeholder="搜尋內容說明…">
    </div>
    <div class="table-wrap">
      <table class="photos">
        <thead><tr><th></th><th>縮圖</th><th>內容說明</th><th>設計</th><th>實際</th><th style="text-align:right">信心</th><th>狀態</th></tr></thead>
        <tbody></tbody>
      </table>
      <div class="empty" hidden>沒有符合的照片</div>
    </div>
    <div class="table-hint">拖把手改順序（＝Word 順序）；拖到左側資料夾或群組列即搬移。點列 → 右側顯示大圖與白板裁切。Tab / Enter 在儲存格間移動。</div>`;

  const tbody = container.querySelector('tbody');
  const emptyEl = container.querySelector('.empty');
  const rows = new Map(); // id → tr
  let lastKey = '';

  function rowHtml(p) {
    return `
      <td class="handle" draggable="true" title="拖曳改順序 / 搬移">⋮⋮</td>
      <td><img class="thumb" alt="" ${p.thumbUrl ? `src="${p.thumbUrl}"` : ''}></td>
      <td class="desc"><input type="text" data-f="desc" value="${esc(p.desc)}"></td>
      <td class="design"><input type="text" data-f="design" value="${esc(p.design)}"></td>
      <td class="actual"><input type="text" data-f="actual" value="${esc(p.actual)}"></td>
      <td class="conf"></td>
      <td><span class="badge"></span></td>`;
  }

  function patchRow(tr, p) {
    tr.className = `photo ${p.status} ${p.id === app.state.selectedId ? 'selected' : ''}`;
    for (const f of FIELDS) {
      const inp = tr.querySelector(`input[data-f="${f}"]`);
      if (inp !== document.activeElement && inp.value !== p[f]) inp.value = p[f];
    }
    tr.querySelector('.conf').textContent = p.confidence == null ? '—' : `${Math.round(p.confidence)}%`;
    const badge = tr.querySelector('.badge');
    badge.className = `badge ${p.status}`;
    badge.textContent = STATUS_LABEL[p.status] ?? p.status;
    badge.title = p.error ?? '';
    const img = tr.querySelector('.thumb');
    if (p.thumbUrl && img.getAttribute('src') !== p.thumbUrl) img.src = p.thumbUrl;
  }

  function render() {
    const visible = app.visiblePhotos();
    const { dirs, collapsed } = app.state;
    const key = visible.map((p) => p.id).join('|') + '#' + [...collapsed].join('|');
    if (key === lastKey) {
      for (const p of visible) rows.has(p.id) && patchRow(rows.get(p.id), p);
      return;
    }
    lastKey = key;
    rows.clear();
    tbody.innerHTML = '';
    emptyEl.hidden = visible.length > 0;
    for (const d of dirs) {
      const group = visible.filter((p) => p.dir === d.path);
      if (!group.length) continue;
      const gtr = document.createElement('tr');
      gtr.className = `group ${collapsed.has(d.path) ? 'collapsed' : ''}`;
      gtr.dataset.dir = d.path;
      gtr.innerHTML = `<td colspan="7"><span class="toggle">▾</span> 🗀 ${esc(d.path || d.name)}<span class="n">${group.length} 張</span></td>`;
      tbody.appendChild(gtr);
      if (collapsed.has(d.path)) continue;
      for (const p of group) {
        const tr = document.createElement('tr');
        tr.dataset.id = p.id;
        tr.innerHTML = rowHtml(p);
        patchRow(tr, p);
        tbody.appendChild(tr);
        rows.set(p.id, tr);
      }
    }
  }

  function renderChips() {
    const c = app.counts();
    for (const b of container.querySelectorAll('.chip')) {
      const k = b.dataset.chip;
      b.classList.toggle('active', k === app.state.chip);
      b.querySelector('.n').textContent = ` ${c[k] ?? 0}`;
    }
  }

  // ---- 事件 ----
  container.querySelector('.filters').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (b) app.setChip(b.dataset.chip);
  });
  container.querySelector('.search').addEventListener('input', (e) => app.setQuery(e.target.value));

  tbody.addEventListener('click', (e) => {
    const g = e.target.closest('tr.group');
    if (g) {
      app.toggleCollapse(g.dataset.dir);
      return;
    }
    const tr = e.target.closest('tr.photo');
    if (tr) app.select(tr.dataset.id);
  });
  tbody.addEventListener('focusin', (e) => {
    const tr = e.target.closest('tr.photo');
    if (tr && e.target.tagName === 'INPUT') app.select(tr.dataset.id);
  });
  tbody.addEventListener('input', (e) => {
    const tr = e.target.closest('tr.photo');
    if (tr && e.target.dataset.f) app.setField(tr.dataset.id, e.target.dataset.f, e.target.value);
  });
  tbody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    const tr = e.target.closest('tr.photo');
    const f = e.target.dataset.f;
    let next = tr.nextElementSibling;
    while (next && !next.classList.contains('photo')) next = next.nextElementSibling;
    const inp = next?.querySelector(`input[data-f="${f}"]`);
    if (inp) {
      inp.focus();
      inp.select();
    }
  });

  // ---- 拖曳 ----
  let draggingId = null;
  tbody.addEventListener('dragstart', (e) => {
    const handle = e.target.closest('.handle');
    if (!handle) return;
    const tr = handle.closest('tr.photo');
    draggingId = tr.dataset.id;
    e.dataTransfer.setData('text/autofit-photo', draggingId);
    e.dataTransfer.setData('text/plain', draggingId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setDragImage(tr, 10, 10);
    tr.classList.add('dragging');
  });
  tbody.addEventListener('dragend', () => {
    tbody.querySelector('.dragging')?.classList.remove('dragging');
    clearMarks();
    draggingId = null;
  });
  const clearMarks = () => {
    for (const el of tbody.querySelectorAll('.drop-before, .drop-after, .over')) el.classList.remove('drop-before', 'drop-after', 'over');
  };
  const placeOf = (e, tr) => {
    const r = tr.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  };
  tbody.addEventListener('dragover', (e) => {
    if (!draggingId) return;
    const g = e.target.closest('tr.group');
    const tr = e.target.closest('tr.photo');
    clearMarks();
    if (g) {
      e.preventDefault();
      g.classList.add('over');
      return;
    }
    if (!tr || tr.dataset.id === draggingId) return;
    const moving = app.photo(draggingId);
    const target = app.photo(tr.dataset.id);
    if (!moving || !target || moving.dir !== target.dir) return; // 跨資料夾請拖到群組列或左樹
    e.preventDefault();
    tr.classList.add(placeOf(e, tr) === 'before' ? 'drop-before' : 'drop-after');
  });
  tbody.addEventListener('drop', async (e) => {
    const id = e.dataTransfer.getData('text/autofit-photo') || draggingId;
    clearMarks();
    if (!id) return;
    const g = e.target.closest('tr.group');
    if (g) {
      e.preventDefault();
      try {
        const ok = await app.moveToDir(id, g.dataset.dir);
        if (ok) toast(`已搬到「${app.dirOf(g.dataset.dir)?.name}」${app.state.readOnly ? '（唯讀複本，未動到實際檔案）' : ''}`);
      } catch (err) {
        toast(`搬移失敗：${err.message}`, { error: true });
      }
      return;
    }
    const tr = e.target.closest('tr.photo');
    if (!tr) return;
    e.preventDefault();
    app.reorder(id, tr.dataset.id, placeOf(e, tr));
  });

  const unsubscribe = app.subscribe((what) => {
    if (what === 'photos' || what === 'filter' || what === 'tree' || what === 'page') {
      render();
      renderChips();
    } else if (what === 'selection') {
      for (const [id, tr] of rows) tr.classList.toggle('selected', id === app.state.selectedId);
      rows.get(app.state.selectedId)?.scrollIntoView({ block: 'nearest' });
    } else if (what === 'thumb') {
      for (const [id, tr] of rows) {
        const p = app.photo(id);
        if (p) patchRow(tr, p);
      }
    }
  });
  render();
  renderChips();
  return unsubscribe;
}
