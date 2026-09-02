// 工作台：頂列 + 左樹 + 中表格 + 右檢視器，以及全域快捷鍵。

import { mountTopbar } from './topbar.js';
import { mountTree } from './tree.js';
import { mountTable } from './table.js';
import { mountViewer } from './viewer.js';

export function mountWorkbench(container, app) {
  container.innerHTML = '<div class="work"><div></div><div></div><div></div><div></div></div>';
  const [top, left, mid, right] = container.querySelector('.work').children;
  const unsubs = [mountTopbar(top, app), mountTree(left, app), mountTable(mid, app), mountViewer(right, app)];

  const onKey = (e) => {
    if (app.state.page !== 'work') return;
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (document.querySelector('.overlay')) return;
    if (e.key === 'Enter' && !typing && app.state.selectedId) {
      e.preventDefault();
      app.confirm(app.state.selectedId);
    } else if (e.key === 'ArrowRight' && !typing) {
      app.stepSelection(1);
    } else if (e.key === 'ArrowLeft' && !typing) {
      app.stepSelection(-1);
    }
  };
  document.addEventListener('keydown', onKey);
  return () => {
    document.removeEventListener('keydown', onKey);
    for (const u of unsubs) u();
    container.innerHTML = '';
  };
}
