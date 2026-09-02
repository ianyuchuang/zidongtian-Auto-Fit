// 對話框與提示（DOM）。

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * 顯示對話框。buttons: [{label, value, primary}]；resolve 按下按鈕的 value（Esc → null）。
 * onOpen(dialogEl) 可用來綁事件；beforeClose(value, dialogEl) 回傳 false 可阻止關閉。
 */
export function showDialog({ title, body = '', buttons = [{ label: '確定', value: true, primary: true }], onOpen, beforeClose }) {
  const root = document.getElementById('dialog-root');
  return new Promise((resolve) => {
    const overlay = el(`
      <div class="overlay">
        <div class="dialog" role="dialog" aria-modal="true">
          <h3>${esc(title)}</h3>
          <div class="body">${body}</div>
          <div class="btns"></div>
        </div>
      </div>`);
    const btns = overlay.querySelector('.btns');
    const close = (v) => {
      if (beforeClose && beforeClose(v, overlay) === false) return;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    for (const b of buttons) {
      const btn = el(`<button class="btn ${b.primary ? 'btn-primary' : ''}">${esc(b.label)}</button>`);
      btn.addEventListener('click', () => close(b.value));
      btns.appendChild(btn);
    }
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        const p = buttons.find((b) => b.primary);
        if (p) {
          e.preventDefault();
          close(p.value);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    root.appendChild(overlay);
    onOpen?.(overlay);
    overlay.querySelector('input, select, textarea, button')?.focus();
  });
}

export async function alertDialog(title, body) {
  await showDialog({ title, body });
}

export async function confirmDialog(title, body) {
  return (await showDialog({
    title,
    body,
    buttons: [
      { label: '取消', value: false },
      { label: '確定', value: true, primary: true },
    ],
  })) === true;
}

export async function promptDialog(title, { label = '', value = '', placeholder = '' } = {}) {
  let input;
  const v = await showDialog({
    title,
    body: `<label>${esc(label)}<input type="text" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>`,
    buttons: [
      { label: '取消', value: false },
      { label: '確定', value: true, primary: true },
    ],
    onOpen: (d) => {
      input = d.querySelector('input');
      input.focus();
      input.select();
    },
  });
  return v === true ? input.value : null;
}

export function toast(message, { error = false, ms = 3500 } = {}) {
  const root = document.getElementById('toast-root');
  const t = el(`<div class="toast ${error ? 'error' : ''}">${esc(message)}</div>`);
  root.appendChild(t);
  setTimeout(() => t.remove(), error ? ms * 2 : ms);
}
