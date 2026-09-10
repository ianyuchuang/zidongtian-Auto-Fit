// 左欄：資料夾樹（點選篩選、拖列到資料夾即搬移）、新增資料夾、底部進度。

import { isTrashDir, ownerOfTrash } from '../state.js';
import { esc, promptDialog, toast } from './dialog.js';
import { DND_MULTI, DND_SINGLE, dropIds, reportMove } from './dnd.js';

/**
 * 點了某個節點要套哪個資料夾篩選。根節點與根層的 `_回收桶` 都是「全部」（null）：
 * ownerOfTrash('_回收桶') 是 ''，之前直接把 '' 塞進 dirFilter，左樹沒有節點反白、子資料夾全部消失。
 */
export function dirFilterFor(path) {
  const dir = isTrashDir(path) ? ownerOfTrash(path) : path;
  return dir ? dir : null;
}

export function mountTree(container, app) {
  container.className = 'sidebar';
  container.innerHTML = `
    <div class="hint muted small">資料夾（拖列到這裡即搬移）</div>
    <div class="tree"></div>
    <button class="tree-add">＋ 新增資料夾</button>
    <div class="stats"></div>`;
  const treeEl = container.querySelector('.tree');
  const statsEl = container.querySelector('.stats');

  function render() {
    const { dirs, dirFilter } = app.state;
    treeEl.innerHTML = dirs
      .map(
        (d) => `
      <div class="tree-node ${(dirFilter ?? null) === (d.depth === 0 ? null : d.path) ? 'active' : ''} ${isTrashDir(d.path) ? 'trash' : ''}"
           data-path="${esc(d.path)}" style="padding-left:${10 + d.depth * 16}px" title="${esc(d.path || d.name)}${isTrashDir(d.path) ? '（這個資料夾的回收桶：不輸出 Word；表格裡按「↩ 還原」或拖到別的資料夾即可還原）' : ''}">
        <span>${isTrashDir(d.path) ? '🗑' : '🗀'}</span><span>${esc(d.name)}</span>
        <span class="count">${d.fileCount}</span>
      </div>`,
      )
      .join('');
  }

  function renderStats() {
    const c = app.counts();
    statsEl.innerHTML =
      `辨識進度 ${c.recognized} / ${c.all}<br>已確認 ${c.confirmed}・待校對 ${c.toReview}` + (c.trashed ? `<br>已刪除 ${c.trashed}（不輸出 Word）` : '');
  }

  treeEl.addEventListener('click', (e) => {
    const node = e.target.closest('.tree-node');
    if (!node) return;
    // 點回收桶＝看它所屬的那個資料夾（已刪除的照片本來就掛在原資料夾底下反灰顯示）
    app.setDirFilter(dirFilterFor(node.dataset.path));
  });

  // 拖曳搬移
  treeEl.addEventListener('dragover', (e) => {
    const node = e.target.closest('.tree-node');
    if (!node || !(e.dataTransfer.types.includes(DND_MULTI) || e.dataTransfer.types.includes(DND_SINGLE))) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    node.classList.add('over');
  });
  treeEl.addEventListener('dragleave', (e) => e.target.closest('.tree-node')?.classList.remove('over'));
  treeEl.addEventListener('drop', async (e) => {
    const node = e.target.closest('.tree-node');
    if (!node) return;
    e.preventDefault();
    node.classList.remove('over');
    const ids = dropIds(e.dataTransfer);
    if (!ids.length) return;
    try {
      const r = await app.moveManyToDir(ids, node.dataset.path);
      reportMove(app, r, app.dirOf(node.dataset.path)?.name ?? node.dataset.path);
    } catch (err) {
      console.error(err);
      toast(`搬移失敗：${err.message}`, { error: true });
    }
  });

  container.querySelector('.tree-add').addEventListener('click', async () => {
    const name = await promptDialog('新增資料夾', { label: '在根資料夾下建立：', placeholder: '例如 6F' });
    if (!name) return;
    try {
      await app.addFolder(name);
      toast(`已建立資料夾「${name.trim()}」`);
    } catch (err) {
      toast(err.message, { error: true });
    }
  });

  const unsubscribe = app.subscribe((what) => {
    if (what === 'tree' || what === 'filter' || what === 'page') render();
    if (what === 'photos' || what === 'tree' || what === 'page') renderStats();
  });
  render();
  renderStats();
  return unsubscribe;
}
