// 圖片燈箱：點圖放大，滾輪縮放、拖曳平移。獨立模組，壞掉不影響檢視器其他區塊。

import { esc } from './dialog.js';

export const MIN_SCALE = 1;
export const MAX_SCALE = 8;
export const IDENTITY = { scale: 1, tx: 0, ty: 0 };

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** 滾輪 deltaY 換算縮放倍率（往上放大、往下縮小），連續平滑。 */
export function wheelFactor(deltaY, step = 0.0015) {
  return Math.exp(-deltaY * step);
}

/** 以 (px,py)（相對容器左上角）為錨點縮放；錨點在畫面上的位置維持不變。 */
export function zoomAt(view, { factor, px, py }, { min = MIN_SCALE, max = MAX_SCALE } = {}) {
  const scale = clamp(view.scale * factor, min, max);
  const k = scale / view.scale;
  return { scale, tx: px - (px - view.tx) * k, ty: py - (py - view.ty) * k };
}

/** 限制平移：圖不會被拖離容器；scale=1 時固定貼齊（tx=ty=0）。 */
export function clampPan(view, { w, h }) {
  return {
    scale: view.scale,
    tx: clamp(view.tx, Math.min(0, w - w * view.scale), 0),
    ty: clamp(view.ty, Math.min(0, h - h * view.scale), 0),
  };
}

/**
 * 點 (x,y) 是否落在 rect 內。
 * 判斷「有沒有點在圖片上」只能用實際外框，不能用 e.target：圖片放大後 pointerdown 會
 * setPointerCapture 到舞台上，之後 click 的 target 會變成舞台而不是 <img>，
 * 用 target 判斷會把「點在圖上」誤判成「點空白處」而把燈箱關掉。
 */
export function hitsRect(rect, x, y) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** 焦點是否在可打字的欄位上（燈箱是非強制視窗，快捷鍵不能搶走輸入）。 */
export function isTypingTarget(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

// 同一時間只留一個燈箱；不擋右欄檢視器，開著也能繼續打字。
let current = null;

/** 燈箱是否開著。 */
export function isLightboxOpen() {
  return !!current;
}

/** 換掉燈箱裡的圖（例如「確認，下一張」後跟著跳圖），縮放歸零。 */
export function updateLightbox(src, title = '') {
  if (!current || !src) return false;
  current.setImage(src, title);
  return true;
}

/** 關閉目前的燈箱。 */
export function closeLightbox() {
  current?.close();
}

/**
 * 開啟燈箱（非強制視窗：右欄檢視器仍可點、可打字）。回傳 close()。
 */
export function openLightbox(src, { title = '', root = null, onClose = null } = {}) {
  const host = root || document.getElementById('dialog-root') || document.body;
  if (!src || !host) return () => {};
  current?.close();

  const overlay = document.createElement('div');
  overlay.className = 'overlay lightbox';
  overlay.innerHTML = `
    <div class="lb-bar">
      <span class="lb-title" title="${esc(title)}">${esc(title)}</span>
      <span class="lb-zoom">100%</span>
      <button class="lb-btn" data-lb="out" title="縮小">−</button>
      <button class="lb-btn" data-lb="in" title="放大">＋</button>
      <button class="lb-btn" data-lb="reset" title="還原原始大小">⟲</button>
      <button class="lb-btn" data-lb="close" title="關閉（Esc）">✕</button>
    </div>
    <div class="lb-stage"><img alt="${esc(title)}" draggable="false"></div>
    <div class="lb-hint">滾輪縮放 · 拖曳平移 · 雙擊還原 · Esc 關閉；右欄三個欄位照樣可以打字</div>`;

  const stage = overlay.querySelector('.lb-stage');
  const img = overlay.querySelector('img');
  const zoomLabel = overlay.querySelector('.lb-zoom');
  const titleEl = overlay.querySelector('.lb-title');

  let view = { ...IDENTITY };
  const boxOf = () => {
    const r = stage.getBoundingClientRect();
    return { w: r.width || 1, h: r.height || 1 };
  };

  function apply() {
    view = clampPan(view, boxOf());
    img.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
    zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
    stage.classList.toggle('zoomed', view.scale > 1);
  }

  function zoom(factor, clientX, clientY) {
    const r = stage.getBoundingClientRect();
    const px = clientX == null ? r.width / 2 : clientX - r.left;
    const py = clientY == null ? r.height / 2 : clientY - r.top;
    view = zoomAt(view, { factor, px, py });
    apply();
  }

  function reset() {
    view = { ...IDENTITY };
    apply();
  }

  function setImage(nextSrc, nextTitle = '') {
    img.src = nextSrc;
    img.alt = nextTitle;
    titleEl.textContent = nextTitle;
    titleEl.title = nextTitle;
    reset();
  }

  function close() {
    if (current && current.close === close) current = null;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    // 游標在輸入格裡時，鍵盤讓給打字
    if (isTypingTarget(e.target)) return;
    if (e.key === '+' || e.key === '=') zoom(1.25);
    else if (e.key === '-' || e.key === '_') zoom(1 / 1.25);
    else if (e.key === '0') reset();
  }

  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoom(wheelFactor(e.deltaY), e.clientX, e.clientY);
    },
    { passive: false },
  );

  // 拖曳平移（放大後才有意義）
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || view.scale <= 1) return;
    drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
    view = { scale: view.scale, tx: drag.tx + dx, ty: drag.ty + dy };
    apply();
  });
  const endDrag = (e) => {
    if (!drag) return;
    stage.classList.remove('dragging');
    try {
      stage.releasePointerCapture(e.pointerId);
    } catch {
      /* 已釋放 */
    }
    const moved = drag.moved;
    drag = null;
    if (moved) stage.dataset.suppressClick = '1';
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  stage.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (view.scale > 1) reset();
    else zoom(2.5, e.clientX, e.clientY);
  });

  overlay.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-lb]');
    if (btn) {
      const a = btn.dataset.lb;
      if (a === 'in') zoom(1.25);
      else if (a === 'out') zoom(1 / 1.25);
      else if (a === 'reset') reset();
      else close();
      return;
    }
    if (stage.dataset.suppressClick) {
      delete stage.dataset.suppressClick;
      return;
    }
    if (e.detail > 1) return; // 雙擊的第二下交給 dblclick（還原縮放），不要關窗
    if (!stage.contains(e.target) && e.target !== overlay) return; // 工具列 / 提示列不關
    if (hitsRect(img.getBoundingClientRect(), e.clientX, e.clientY)) return; // 點在圖上不關
    close();
  });

  document.addEventListener('keydown', onKey);
  host.appendChild(overlay);
  img.addEventListener('load', apply);
  setImage(src, title);
  current = { close, setImage };
  return close;
}
