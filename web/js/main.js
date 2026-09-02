// 進入點：入口頁 ↔ 工作台切換。

import { createApp } from './app.js';
import { mountEntry } from './ui/entry.js';
import { mountWorkbench } from './ui/workbench.js';

const app = createApp();
globalThis.app = app; // 除錯用

const root = document.getElementById('app');
mountEntry(root, app);
let unmount = null;
app.subscribe((what) => {
  if (what !== 'page') return;
  unmount?.();
  unmount = null;
  if (app.state.page === 'work') unmount = mountWorkbench(root, app);
  else mountEntry(root, app);
});

window.addEventListener('beforeunload', (e) => {
  if (app.state.page === 'work' && app.state.recognizing) e.preventDefault();
});
