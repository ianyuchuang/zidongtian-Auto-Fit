// 進入點：入口頁 ↔ 工作台切換。

import { createApp } from './app.js';
import { mountEntry } from './ui/entry.js';
import { mountWorkbench } from './ui/workbench.js';

const app = createApp();
globalThis.app = app; // 除錯用

const root = document.getElementById('app');
mountEntry(root, app);
app.subscribe((what) => {
  if (what === 'page' && app.state.page === 'work') mountWorkbench(root, app);
});

window.addEventListener('beforeunload', (e) => {
  if (app.state.page === 'work' && app.state.recognizing) e.preventDefault();
});
