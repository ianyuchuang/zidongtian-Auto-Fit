// 中欄：篩選 chip、搜尋、依資料夾分組的可編輯表格、拖曳換序 / 拖到群組列搬移、
// 勾選多選（批次搬到資料夾、刪除到 _回收桶；拖任一勾選列＝整批拖走）。

import { CHIPS, CHIP_LABEL, STATUS_LABEL, TRASH_DIR, isTrashDir, isTrashed, groupDirOf } from '../state.js';
import { esc, toast, confirmDialog } from './dialog.js';
import { DND_MULTI, DND_SINGLE, dropIds, reportMove } from './dnd.js';

const FIELDS = ['desc', 'design', 'actual'];

export function mountTable(container, app) {
  container.className = 'main';
  container.innerHTML = `
    <div class="filters">
      ${CHIPS.map((c) => `<button class="chip" data-chip="${c}">${CHIP_LABEL[c]}<span class="n"></span></button>`).join('')}
      <input type="text" class="search" placeholder="搜尋內容說明…">
    </div>
    <div class="bulkbar off">
      <span>已勾選 <b class="n">0</b> 張<span class="hidden-note muted"></span></span>
      <select class="move-to" title="把勾選的照片搬到資料夾"><option value="">搬到資料夾…</option></select>
      <button class="btn btn-danger" data-bulk="trash" title="搬到根資料夾下的 ${TRASH_DIR}，可再拖回來">🗑 刪除（移到 ${TRASH_DIR}）</button>
      <button class="btn" data-bulk="clear">取消勾選</button>
    </div>
    <div class="table-wrap">
      <table class="photos">
        <thead><tr><th class="c-handle"></th><th class="c-thumb">縮圖</th><th class="c-desc">內容說明</th><th class="c-design">設計</th><th class="c-actual">實際</th><th class="c-conf">信心</th><th class="c-status">狀態</th><th class="chk"><input type="checkbox" data-chk-all title="全選 / 取消目前顯示的照片"></th></tr></thead>
        <tbody></tbody>
      </table>
      <div class="empty" hidden>沒有符合的照片</div>
    </div>
    <div class="table-hint">拖把手改順序（＝Word 順序）；拖到左側資料夾或群組列即搬移。右側勾選可多選：批次搬移、刪除（移到該資料夾的 ${TRASH_DIR}）；刪掉的會留在原位反灰，按「↩ 還原」就回來。點列 → 右側顯示大圖與白板裁切。Tab / Enter 在儲存格間移動。</div>`;

  const tbody = container.querySelector('tbody');
  const emptyEl = container.querySelector('.empty');
  const bulkbar = container.querySelector('.bulkbar');
  const moveSel = bulkbar.querySelector('.move-to');
  const chkAll = container.querySelector('[data-chk-all]');
  const rows = new Map(); // id → tr
  let lastKey = '';

  /** 已刪除、或正在辨識中 → 欄位鎖住（辨識中打的字會被 AI 蓋掉，乾脆不讓打）。 */
  const locked = (p) => isTrashed(p) || app.state.recognizing;

  function rowHtml(p) {
    const gone = isTrashed(p); // 已刪除：留在原位反灰、欄位鎖住，只留「還原」
    const dis = locked(p) ? ' disabled' : '';
    return `
      <td class="handle" draggable="true" title="拖曳改順序 / 搬移">⋮⋮</td>
      <td><img class="thumb" alt="" ${p.thumbUrl ? `src="${p.thumbUrl}"` : ''}></td>
      <td class="desc"><input type="text" data-f="desc" value="${esc(p.desc)}"${dis}></td>
      <td class="design"><input type="text" data-f="design" value="${esc(p.design)}"${dis}></td>
      <td class="actual"><input type="text" data-f="actual" value="${esc(p.actual)}"${dis}></td>
      <td class="conf"></td>
      <td class="status"><span class="badge"></span>${gone ? '<button class="btn tiny" data-act="restore" title="搬回原本的資料夾">↩ 還原</button>' : ''}</td>
      <td class="chk"><input type="checkbox" data-chk tabindex="-1" title="勾選（批次搬移 / 刪除）"${dis}></td>`;
  }

  function patchRow(tr, p) {
    const gone = isTrashed(p);
    tr.className = `photo ${p.status} ${gone ? 'trashed' : ''} ${p.id === app.state.selectedId ? 'selected' : ''} ${app.isChecked(p.id) ? 'checked' : ''}`;
    const lock = locked(p);
    for (const f of FIELDS) {
      const inp = tr.querySelector(`input[data-f="${f}"]`);
      if (inp !== document.activeElement && inp.value !== p[f]) inp.value = p[f];
      inp.disabled = lock;
    }
    tr.querySelector('.conf').textContent = p.confidence == null ? '—' : `${Math.round(p.confidence)}%`;
    const badge = tr.querySelector('.badge');
    badge.className = `badge ${gone ? 'trashed' : p.status}`;
    badge.textContent = gone ? '已刪除' : (STATUS_LABEL[p.status] ?? p.status);
    badge.title = gone ? '已搬到這個資料夾的回收桶，按「↩ 還原」搬回來' : (p.error ?? '');
    const chk = tr.querySelector('[data-chk]');
    chk.checked = app.isChecked(p.id);
    chk.disabled = lock;
    const img = tr.querySelector('.thumb');
    if (p.thumbUrl && img.getAttribute('src') !== p.thumbUrl) img.src = p.thumbUrl;
  }

  function render() {
    const visible = app.visiblePhotos();
    const { dirs, collapsed } = app.state;
    const key = visible.map((p) => p.id).join('|') + '#' + [...collapsed].join('|');
    if (key === lastKey) {
      for (const p of visible) rows.has(p.id) && patchRow(rows.get(p.id), p);
      renderChecks();
      return;
    }
    lastKey = key;
    rows.clear();
    tbody.innerHTML = '';
    emptyEl.hidden = visible.length > 0;
    for (const d of dirs) {
      if (isTrashDir(d.path)) continue; // 回收桶不自成群組：裡面的照片掛在原資料夾底下反灰顯示
      const group = visible.filter((p) => groupDirOf(p) === d.path);
      if (!group.length) continue;
      const live = group.filter((p) => !isTrashed(p)).length;
      const gone = group.length - live;
      const gtr = document.createElement('tr');
      gtr.className = `group ${collapsed.has(d.path) ? 'collapsed' : ''}`;
      gtr.dataset.dir = d.path;
      gtr.innerHTML = `<td colspan="7"><span class="toggle">▾</span> 🗀 ${esc(d.path || d.name)}<span class="n">${live} 張${gone ? `・已刪除 ${gone}` : ''}</span>
          <label class="dir-date" title="這個資料夾的檢查日期：docx 檔名、頁首日期、照片日期戳都用它">📅 檢查日期
            <input type="text" data-dir-date value="${esc(app.dateInfo(d.path).compact)}" maxlength="9" size="8">
          </label></td>
        <td class="chk"><input type="checkbox" data-chk-group tabindex="-1" title="全選 / 取消這個資料夾顯示中的照片"></td>`;
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
    renderChecks();
  }

  /** 目前看得到、而且還沒被刪除的照片（勾選只作用在這些上面）。 */
  const selectable = () => app.visiblePhotos().filter((p) => !isTrashed(p));

  /** 勾選狀態：列的 checkbox / 群組與全選框（含半選）/ 工具列。 */
  function renderChecks() {
    const pickable = selectable();
    for (const [id, tr] of rows) {
      const on = app.isChecked(id);
      tr.classList.toggle('checked', on);
      tr.querySelector('[data-chk]').checked = on;
    }
    for (const gtr of tbody.querySelectorAll('tr.group')) {
      const ids = pickable.filter((p) => groupDirOf(p) === gtr.dataset.dir).map((p) => p.id);
      setTri(gtr.querySelector('[data-chk-group]'), ids.filter((id) => app.isChecked(id)).length, ids.length);
    }
    setTri(chkAll, pickable.filter((p) => app.isChecked(p.id)).length, pickable.length);

    // 勾選會跨篩選累積（換 chip 再勾下一批也留著），所以要明講有幾張現在看不到，
    // 否則按下刪除會刪到畫面上看不見的照片。
    const n = app.state.checked.size;
    const shown = new Set(pickable.map((p) => p.id));
    const hidden = [...app.state.checked].filter((id) => !shown.has(id)).length;
    // 用 visibility 而不是 hidden：工具列出現／消失若改變表格高度，整張表會上下跳（bug清單 A3）
    bulkbar.classList.toggle('off', n === 0);
    bulkbar.querySelector('.n').textContent = n;
    bulkbar.querySelector('.hidden-note').textContent = hidden ? `（其中 ${hidden} 張目前被篩選隱藏）` : '';
    const opts = app.state.dirs
      .filter((d) => !isTrashDir(d.path)) // 回收桶不放進搬移下拉，刪除請用「刪除」按鈕（會跳確認）
      .map((d) => `<option value="d:${esc(d.path)}">🗀 ${esc(d.path || `${d.name}（根資料夾）`)}</option>`)
      .join('');
    moveSel.innerHTML = `<option value="">搬到資料夾…</option>${opts}`;
    // setTri 只看有沒有照片，辨識中要再壓一次，否則每跑完一張就被重新打開
    if (app.state.recognizing) {
      chkAll.disabled = true;
      for (const b of tbody.querySelectorAll('[data-chk-group]')) b.disabled = true;
    }
  }
  function setTri(box, on, total) {
    box.checked = total > 0 && on === total;
    box.indeterminate = on > 0 && on < total;
    box.disabled = total === 0;
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

  chkAll.addEventListener('change', () => {
    app.setChecked(
      selectable().map((p) => p.id),
      chkAll.checked,
    );
  });
  moveSel.addEventListener('change', async () => {
    const v = moveSel.value; // 'd:' + 路徑（根資料夾的路徑是空字串，所以要加前綴）
    moveSel.value = '';
    if (!v.startsWith('d:')) return;
    await bulkMove(app.checkedPhotos().map((p) => p.id), v.slice(2));
  });
  bulkbar.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-bulk]')?.dataset.bulk;
    if (act === 'clear') app.clearChecked();
    else if (act === 'trash') await bulkTrash(app.checkedPhotos().map((p) => p.id));
  });

  async function bulkMove(ids, dir) {
    try {
      const r = await app.moveManyToDir(ids, dir);
      reportMove(app, r, app.dirOf(dir)?.name ?? dir);
    } catch (err) {
      console.error(err);
      toast(`搬移失敗：${err.message}`, { error: true });
    }
  }
  async function bulkTrash(ids) {
    if (!ids.length) return;
    // 勾選會跨篩選累積，所以一定要把要刪的檔名列出來，不能只講「勾選的 N 張」
    const names = ids.map((id) => app.photo(id)?.name ?? id);
    const shown = names.slice(0, 15).map((n) => `<li>${esc(n)}</li>`).join('');
    const more = names.length > 15 ? `<li class="muted">…等 ${names.length} 張</li>` : '';
    const ok = await confirmDialog(
      '刪除照片',
      `把這 ${ids.length} 張搬到各自資料夾的「${TRASH_DIR}」？（不會真的刪檔，會留在原位反灰，按「↩ 還原」就回來。）<ul class="name-list">${shown}${more}</ul>`,
    );
    if (!ok) return;
    try {
      const r = await app.trash(ids);
      reportMove(app, r, TRASH_DIR);
      if (r.alreadyTrashed) toast(`${r.alreadyTrashed} 張本來就已經刪除了`);
    } catch (err) {
      console.error(err);
      toast(`刪除失敗：${err.message}`, { error: true });
    }
  }

  async function bulkRestore(ids) {
    if (!ids.length) return;
    try {
      const r = await app.restore(ids);
      if (r.moved) toast(`已還原 ${r.moved} 張`);
      if (r.failed.length)
        toast(`${r.failed.length} 張還原失敗：${r.failed.map((f) => `${f.name}（${f.error}）`).join('；')}`, { error: true, ms: 6000 });
    } catch (err) {
      console.error(err);
      toast(`還原失敗：${err.message}`, { error: true });
    }
  }

  tbody.addEventListener('change', (e) => {
    if (e.target.matches('[data-chk]')) {
      app.setChecked([e.target.closest('tr.photo').dataset.id], e.target.checked);
    } else if (e.target.matches('[data-chk-group]')) {
      const dir = e.target.closest('tr.group').dataset.dir;
      app.setChecked(
        selectable()
          .filter((p) => groupDirOf(p) === dir)
          .map((p) => p.id),
        e.target.checked,
      );
    }
  });
  tbody.addEventListener('click', (e) => {
    if (e.target.matches('input[type="checkbox"]')) return; // 勾選不觸發選列 / 收合
    if (e.target.closest('.dir-date')) return; // 在日期格裡點不要收合資料夾
    const restoreBtn = e.target.closest('[data-act="restore"]');
    if (restoreBtn) {
      bulkRestore([restoreBtn.closest('tr.photo').dataset.id]);
      return;
    }
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
    if (tr && e.target.tagName === 'INPUT' && e.target.type === 'text') app.select(tr.dataset.id);
  });
  tbody.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.matches('[data-dir-date]')) return;
    const dir = el.closest('tr.group').dataset.dir;
    try {
      app.setDirDate(dir, el.value.replace(/\D/g, ''));
      el.value = app.dateInfo(dir).compact;
    } catch (err) {
      toast(err.message, { error: true });
      el.value = app.dateInfo(dir).compact; // 大聲失敗：退回原本的日期，不要靜靜存個壞的
      el.focus();
    }
  });
  tbody.addEventListener('input', (e) => {
    const tr = e.target.closest('tr.photo');
    if (tr && e.target.dataset.f) app.setField(tr.dataset.id, e.target.dataset.f, e.target.value);
  });
  tbody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || !e.target.dataset.f) return;
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
  let draggingIds = [];
  tbody.addEventListener('dragstart', (e) => {
    const handle = e.target.closest('.handle');
    if (!handle) return;
    const tr = handle.closest('tr.photo');
    draggingId = tr.dataset.id;
    // 拖的是勾選列 → 整批一起拖
    draggingIds = app.isChecked(draggingId) ? app.checkedPhotos().map((p) => p.id) : [draggingId];
    e.dataTransfer.setData(DND_MULTI, JSON.stringify(draggingIds));
    e.dataTransfer.setData(DND_SINGLE, draggingId);
    e.dataTransfer.setData('text/plain', draggingIds.join('\n'));
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setDragImage(tr, 10, 10);
    tr.classList.add('dragging');
    if (draggingIds.length > 1) for (const id of draggingIds) rows.get(id)?.classList.add('dragging');
  });
  tbody.addEventListener('dragend', () => {
    for (const el of tbody.querySelectorAll('.dragging')) el.classList.remove('dragging');
    clearMarks();
    draggingId = null;
    draggingIds = [];
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
    if (!tr || tr.dataset.id === draggingId || draggingIds.length > 1) return; // 整批只能拖到資料夾 / 群組列
    const moving = app.photo(draggingId);
    const target = app.photo(tr.dataset.id);
    if (!moving || !target || moving.dir !== target.dir) return; // 跨資料夾請拖到群組列或左樹
    e.preventDefault();
    tr.classList.add(placeOf(e, tr) === 'before' ? 'drop-before' : 'drop-after');
  });
  tbody.addEventListener('drop', async (e) => {
    const ids = dropIds(e.dataTransfer);
    clearMarks();
    if (!ids.length) return;
    const g = e.target.closest('tr.group');
    if (g) {
      e.preventDefault();
      await bulkMove(ids, g.dataset.dir);
      return;
    }
    const tr = e.target.closest('tr.photo');
    if (!tr || ids.length > 1) return;
    e.preventDefault();
    app.reorder(ids[0], tr.dataset.id, placeOf(e, tr));
  });

  /** 辨識中：篩選區與勾選一起反灰，避免中途換範圍造成混亂。 */
  function renderLock() {
    const busy = !!app.state.recognizing;
    container.querySelector('.filters').classList.toggle('locked', busy);
    container.querySelector('.search').disabled = busy;
    for (const b of container.querySelectorAll('.chip')) b.disabled = busy;
    chkAll.disabled = busy || app.visiblePhotos().filter((p) => !isTrashed(p)).length === 0;
    bulkbar.classList.toggle('locked', busy);
  }

  const unsubscribe = app.subscribe((what) => {
    if (what === 'recognize-progress') {
      renderLock();
      render();
      renderChips();
    } else if (what === 'photos' || what === 'filter' || what === 'tree' || what === 'page') {
      render();
      renderChips();
    } else if (what === 'selection') {
      for (const [id, tr] of rows) tr.classList.toggle('selected', id === app.state.selectedId);
      rows.get(app.state.selectedId)?.scrollIntoView({ block: 'nearest' });
    } else if (what === 'checked') {
      renderChecks();
    } else if (what === 'thumb') {
      for (const [id, tr] of rows) {
        const p = app.photo(id);
        if (p) patchRow(tr, p);
      }
    }
  });
  render();
  renderChips();
  renderLock();
  return unsubscribe;
}
