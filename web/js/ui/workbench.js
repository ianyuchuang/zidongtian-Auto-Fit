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
    if (document.querySelector('.overlay:not(.lightbox)')) return; // 燈箱是非強制視窗，快捷鍵照舊
    // 焦點在按鈕上時 Enter 就是按那顆鈕（瀏覽器會自己發 click），這裡不能再確認一次，
    // 否則按「跳過」「🗑」或 Tab 到任何按鈕上按 Enter 都會多確認一張（bug W9）
    if (e.key === 'Enter' && e.target?.closest?.('button')) return;
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

  // 進工作台推一筆歷史，讓瀏覽器「上一頁」＝回首頁，而不是整個離開網站（bug清單 B4）
  history.pushState({ autofit: 'work' }, '');
  const onPop = () => {
    if (app.state.page === 'work') app.goHome();
  };
  window.addEventListener('popstate', onPop);

  return () => {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('popstate', onPop);
    for (const u of unsubs) u();
    container.innerHTML = '';
    // 從工作台按「回首頁」離開時，把剛才推的那一筆收回去（被 popstate 觸發的話已經退掉了）
    if (history.state?.autofit === 'work') history.back();
  };
}
