// 進入點：入口頁 ↔ 版型調整頁 ↔ 工作台切換。

import { createApp } from './app.js';
import { mountEntry } from './ui/entry.js';
import { mountWorkbench } from './ui/workbench.js';
import { mountTemplatePage } from './ui/template-page.js';

const app = createApp();
globalThis.app = app; // 除錯用

// 拖檔案到頁面上沒有接住的地方，瀏覽器預設會去「開」那個檔案：從 http://localhost
// 跳到 file:// 會被 Chrome 擋掉，畫面就變成一片空白（2026-09-04 回報：拖照片資料夾
// 沒對準拖放框就跳空白頁）。全域擋掉預設行為，拖歪了頂多沒反應。
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (e) => e.preventDefault());
}

const root = document.getElementById('app');
mountEntry(root, app);
let unmount = null;
let mounted = app.state.page; // 已經掛在畫面上的是哪一頁
// 只有「真的換頁」才重掛。工作台拆掉時會 history.back() 收回自己推的那筆歷史，
// 白重掛一次就會被自己的 popstate 打回首頁（bug 2026-09-03）。
app.subscribe((what) => {
  if (what !== 'page' || app.state.page === mounted) return;
  mounted = app.state.page;
  unmount?.();
  unmount = null;
  if (app.state.page === 'work') unmount = mountWorkbench(root, app);
  else if (app.state.page === 'template') mountTemplatePage(root, app);
  else mountEntry(root, app);
});

window.addEventListener('beforeunload', (e) => {
  if (app.state.page === 'work' && app.state.recognizing) e.preventDefault();
});
