// 右欄：檢視器（大圖 + 日期戳、白板裁切、三欄同步編輯、跳過 / 確認）。

import { STATUS_LABEL, TRASH_DIR, isTrashDir } from '../state.js';
import { esc, toast, confirmDialog } from './dialog.js';
import { reportMove } from './dnd.js';
import { openLightbox } from './lightbox.js';

const FIELDS = [
  ['desc', '內容說明'],
  ['design', '設　計'],
  ['actual', '實　際'],
];

export function mountViewer(container, app) {
  container.className = 'viewer';
  let currentId = null;

  function renderFull(p) {
    container.innerHTML = `
      <div class="head">
        <span class="name" title="${esc(p.name)}">${esc(p.name)}</span>
        <span class="badge ${p.status}">${STATUS_LABEL[p.status]}</span>
        <span class="nav"><button data-nav="-1" title="上一張">‹</button><button data-nav="1" title="下一張">›</button></span>
      </div>
      <div class="big"><img alt=""><span class="stamp">${esc(app.dateInfo().stamp)}</span></div>
      <div class="err small" ${p.status === 'error' ? '' : 'hidden'}>❌ ${esc(p.error ?? '')}</div>
      <div class="crop-title">白板裁切（AI 定位後從原圖裁出，供對照）</div>
      <div class="crop"><span>尚無裁切</span></div>
      ${FIELDS.map(([f, label]) => `<div class="f"><label>${label}</label><input type="text" data-f="${f}" value="${esc(p[f])}"></div>`).join('')}
      <div class="actions">
        <button class="btn btn-danger" data-act="trash" title="${isTrashDir(p.dir) ? `已在「${TRASH_DIR}」，拖回其他資料夾即還原` : `移到「${TRASH_DIR}」（可從左側資料夾樹拖回來）`}" ${isTrashDir(p.dir) ? 'disabled' : ''}>🗑</button>
        <button class="btn" data-act="skip">跳過</button>
        <button class="btn btn-primary" data-act="confirm">✓ 確認，下一張<kbd>Enter</kbd></button>
      </div>`;
    const img = container.querySelector('.big img');
    app.fullUrl(p).then((u) => currentId === p.id && (img.src = u)).catch(console.error);
    app
      .cropUrl(p)
      .then((u) => {
        if (currentId !== p.id) return;
        const c = container.querySelector('.crop');
        c.innerHTML = u ? `<img alt="白板裁切" src="${u}">` : `<span>${p.source === 'filename' ? '檔名解析，無需辨識' : '尚無裁切'}</span>`;
      })
      .catch(console.error);
  }

  function patch(p) {
    const badge = container.querySelector('.head .badge');
    badge.className = `badge ${p.status}`;
    badge.textContent = STATUS_LABEL[p.status];
    const err = container.querySelector('.err');
    if (err) {
      err.hidden = p.status !== 'error';
      err.textContent = p.status === 'error' ? `❌ ${p.error ?? ''}` : '';
    }
    for (const [f] of FIELDS) {
      const inp = container.querySelector(`input[data-f="${f}"]`);
      if (inp !== document.activeElement && inp.value !== p[f]) inp.value = p[f];
    }
    // 辨識完成後才有裁切
    if (p.bbox && !container.querySelector('.crop img')) {
      app.cropUrl(p).then((u) => {
        if (u && currentId === p.id) container.querySelector('.crop').innerHTML = `<img alt="白板裁切" src="${u}">`;
      });
    }
  }

  function render() {
    const p = app.photo(app.state.selectedId);
    if (!p) {
      container.className = 'viewer';
      container.innerHTML = '<div class="empty">左邊點一列，這裡會顯示大圖與白板裁切。</div>';
      currentId = null;
      return;
    }
    container.className = `viewer ${p.status}`;
    if (currentId === p.id) {
      patch(p);
    } else {
      currentId = p.id;
      renderFull(p);
    }
  }

  container.addEventListener('input', (e) => {
    if (e.target.dataset.f && currentId) app.setField(currentId, e.target.dataset.f, e.target.value);
  });
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && currentId) {
      e.preventDefault();
      app.confirm(currentId);
    }
  });
  container.addEventListener('click', (e) => {
    const zoomable = e.target.closest('.big img, .crop img');
    if (zoomable && zoomable.getAttribute('src')) {
      const p = app.photo(currentId);
      const inCrop = !!zoomable.closest('.crop');
      return openLightbox(zoomable.src, { title: `${p ? p.name : ''}${inCrop ? '（白板裁切）' : ''}` });
    }
    const nav = e.target.closest('[data-nav]');
    if (nav) return app.stepSelection(Number(nav.dataset.nav));
    const act = e.target.closest('[data-act]');
    if (!act || !currentId) return;
    if (act.dataset.act === 'confirm') app.confirm(currentId);
    else if (act.dataset.act === 'trash') trashCurrent();
    else app.skip(currentId);
  });

  async function trashCurrent() {
    const p = app.photo(currentId);
    if (!p) return;
    const ok = await confirmDialog('刪除照片', `把「${esc(p.name)}」搬到「${TRASH_DIR}」？（不會真的刪檔，之後可從左側資料夾樹拖回來。）`);
    if (!ok) return;
    try {
      const r = await app.trash([p.id]);
      reportMove(app, r, TRASH_DIR);
      if (r.moved) app.gotoNextPending(app.state.selectedId);
    } catch (err) {
      console.error(err);
      toast(`刪除失敗：${err.message}`, { error: true });
    }
  }

  const unsubscribe = app.subscribe((what) => {
    if (what === 'date') {
      const s = container.querySelector('.stamp');
      if (s) s.textContent = app.dateInfo().stamp;
    } else if (what === 'selection' || what === 'page' || what === 'photos') {
      render();
    }
  });
  render();
  return unsubscribe;
}
