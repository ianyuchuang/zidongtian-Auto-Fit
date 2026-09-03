// 右欄：檢視器（大圖 + 日期戳、白板裁切、三欄同步編輯、跳過 / 確認）。

import { STATUS_LABEL, TRASH_DIR, isTrashDir, isTrashed, ownerOfTrash } from '../state.js';
import { esc, toast, confirmDialog } from './dialog.js';
import { reportMove } from './dnd.js';
import { openLightbox, isLightboxOpen, updateLightbox, closeLightbox } from './lightbox.js';

const FIELDS = [
  ['desc', '內容說明'],
  ['design', '設　計'],
  ['actual', '實　際'],
];

export function mountViewer(container, app) {
  container.className = 'viewer';
  let currentId = null;
  let zoomKind = null; // 燈箱正在看哪張圖：'big' | 'crop' | null
  // 每次換照片就 +1。非同步載圖回來時用它判斷有沒有過期——不能用 p.id，
  // 因為搬移資料夾時 app 會就地改掉 p.id，導致回呼永遠對不上、圖片停在沒有 src 的狀態。
  let viewSeq = 0;
  let bigLoading = false;

  function zoomTitle(p, kind) {
    return `${p ? p.name : ''}${kind === 'crop' ? '（白板裁切）' : ''}`;
  }

  // 換照片時，開著的燈箱跟著換圖（「確認，下一張」不必重開）
  function syncLightbox(p, kind, url) {
    if (!url || zoomKind !== kind || !isLightboxOpen()) return;
    updateLightbox(url, zoomTitle(p, kind));
  }

  function renderFull(p) {
    container.innerHTML = `
      <div class="head">
        <span class="name" title="${esc(p.name)}">${esc(p.name)}</span>
        <span class="badge ${isTrashed(p) ? 'trashed' : p.status}">${isTrashed(p) ? '已刪除' : STATUS_LABEL[p.status]}</span>
        <span class="nav"><button data-nav="-1" title="上一張">‹</button><button data-nav="1" title="下一張">›</button></span>
      </div>
      <div class="big"><img alt=""><span class="stamp">${esc(app.dateInfo().stamp)}</span></div>
      <div class="err small" ${p.status === 'error' ? '' : 'hidden'}>❌ ${esc(p.error ?? '')}</div>
      <div class="crop-title">白板裁切（AI 定位後從原圖裁出，供對照）</div>
      <div class="crop"><span>尚無裁切</span></div>
      ${FIELDS.map(([f, label]) => `<div class="f"><label>${label}</label><input type="text" data-f="${f}" value="${esc(p[f])}"></div>`).join('')}
      <div class="actions">
        ${
          isTrashed(p)
            ? `<button class="btn" data-act="restore" title="搬回「${esc(ownerOfTrash(p.dir) || '根資料夾')}」">↩ 還原</button>`
            : `<button class="btn btn-danger" data-act="trash" title="移到「${TRASH_DIR}」（會留在原位反灰，隨時可還原）">🗑</button>`
        }
        <button class="btn" data-act="skip">跳過</button>
        <button class="btn btn-primary" data-act="confirm">✓ 確認，下一張<kbd>Enter</kbd></button>
      </div>`;
    loadBig(p, viewSeq);
    loadCrop(p, viewSeq);
  }

  /** 大圖：載入失敗要在畫面上講清楚並給「重試」，不能只 console.error 讓圖悄悄空著。 */
  function loadBig(p, seq) {
    const box = container.querySelector('.big');
    const img = box?.querySelector('img');
    if (!img || bigLoading) return;
    box.querySelector('.load-err')?.remove();
    box.classList.remove('failed');
    bigLoading = true;
    app
      .fullUrl(p)
      .then((u) => {
        if (seq !== viewSeq) return;
        img.src = u;
        syncLightbox(p, 'big', u);
      })
      .catch((e) => {
        console.error('讀取照片失敗', p.name, e);
        if (seq !== viewSeq) return;
        box.classList.add('failed');
        const el = document.createElement('div');
        el.className = 'load-err';
        el.innerHTML = `<div>❌ 讀不到這張照片</div><div class="small">${esc(e.message)}</div><button class="btn" data-act="reload">重試</button>`;
        box.appendChild(el);
      })
      .finally(() => {
        bigLoading = false;
      });
  }

  function loadCrop(p, seq) {
    app
      .cropUrl(p)
      .then((u) => {
        if (seq !== viewSeq) return;
        const c = container.querySelector('.crop');
        if (!c) return;
        c.innerHTML = u ? `<img alt="白板裁切" src="${u}">` : `<span>${p.source === 'filename' ? '檔名解析，無需辨識' : '尚無裁切'}</span>`;
        syncLightbox(p, 'crop', u);
        if (!u && zoomKind === 'crop') closeLightbox();
      })
      .catch((e) => {
        console.error('白板裁切失敗', p.name, e);
        if (seq !== viewSeq) return;
        const c = container.querySelector('.crop');
        if (c) c.innerHTML = `<span>裁切失敗：${esc(e.message)}</span>`;
      });
  }

  function patch(p) {
    // 上一輪載圖失敗或被取消時，這裡補救——否則畫面會一直停在黑框、點了也沒反應
    const bigImg = container.querySelector('.big img');
    if (bigImg && !bigImg.getAttribute('src')) loadBig(p, viewSeq);
    const badge = container.querySelector('.head .badge');
    badge.className = `badge ${isTrashed(p) ? 'trashed' : p.status}`;
    badge.textContent = isTrashed(p) ? '已刪除' : STATUS_LABEL[p.status];
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
        if (!u || currentId !== p.id) return;
        container.querySelector('.crop').innerHTML = `<img alt="白板裁切" src="${u}">`;
        syncLightbox(p, 'crop', u);
      });
    }
  }

  function render() {
    const p = app.photo(app.state.selectedId);
    if (!p) {
      container.className = 'viewer';
      container.innerHTML = '<div class="empty">左邊點一列，這裡會顯示大圖與白板裁切。</div>';
      currentId = null;
      viewSeq += 1;
      bigLoading = false;
      closeLightbox();
      return;
    }
    container.className = `viewer ${p.status}`;
    if (currentId === p.id) {
      patch(p);
    } else {
      currentId = p.id;
      viewSeq += 1;
      bigLoading = false;
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
      const kind = zoomable.closest('.crop') ? 'crop' : 'big';
      zoomKind = kind;
      openLightbox(zoomable.src, {
        title: zoomTitle(p, kind),
        onClose: () => {
          zoomKind = null;
        },
      });
      return;
    }
    const nav = e.target.closest('[data-nav]');
    if (nav) return app.stepSelection(Number(nav.dataset.nav));
    const act = e.target.closest('[data-act]');
    if (!act || !currentId) return;
    const what = act.dataset.act;
    if (what === 'confirm') app.confirm(currentId);
    else if (what === 'trash') trashCurrent();
    else if (what === 'reload') loadBig(app.photo(currentId), viewSeq);
    else if (what === 'restore') restoreCurrent();
    else if (what === 'skip') app.skip(currentId);
  });

  async function restoreCurrent() {
    const p = app.photo(currentId);
    if (!p) return;
    try {
      const r = await app.restore([p.id]);
      if (r.moved) toast(`已還原「${p.name}」`);
      if (r.failed.length) toast(`還原失敗：${r.failed[0].error}`, { error: true });
    } catch (err) {
      console.error(err);
      toast(`還原失敗：${err.message}`, { error: true });
    }
  }

  async function trashCurrent() {
    const p = app.photo(currentId);
    if (!p) return;
    const ok = await confirmDialog('刪除照片', `把「${esc(p.name)}」搬到這個資料夾的「${TRASH_DIR}」？（不會真的刪檔，會留在原位反灰，按「↩ 還原」就回來。）`);
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
  return () => {
    closeLightbox();
    unsubscribe();
  };
}
