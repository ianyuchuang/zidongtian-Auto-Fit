// 左欄：資料夾樹（點選篩選、拖列到資料夾即搬移）、新增資料夾、底部進度。

import { esc, promptDialog, toast } from './dialog.js';

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
      <div class="tree-node ${(dirFilter ?? null) === (d.depth === 0 ? null : d.path) ? 'active' : ''}"
           data-path="${esc(d.path)}" style="padding-left:${10 + d.depth * 16}px" title="${esc(d.path || d.name)}">
        <span>${d.depth === 0 ? '🗀' : '🗀'}</span><span>${esc(d.name)}</span>
        <span class="count">${d.fileCount}</span>
      </div>`,
      )
      .join('');
  }

  function renderStats() {
    const c = app.counts();
    statsEl.innerHTML = `辨識進度 ${c.recognized} / ${c.all}<br>已確認 ${c.confirmed}・待校對 ${c.toReview}`;
  }

  treeEl.addEventListener('click', (e) => {
    const node = e.target.closest('.tree-node');
    if (!node) return;
    const path = node.dataset.path;
    app.setDirFilter(path === '' ? null : path);
  });

  // 拖曳搬移
  treeEl.addEventListener('dragover', (e) => {
    const node = e.target.closest('.tree-node');
    if (!node || !e.dataTransfer.types.includes('text/autofit-photo')) return;
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
    const id = e.dataTransfer.getData('text/autofit-photo');
    if (!id) return;
    try {
      const ok = await app.moveToDir(id, node.dataset.path);
      if (ok) toast(`已搬到「${app.dirOf(node.dataset.path)?.name}」${app.state.readOnly ? '（唯讀複本，未動到實際檔案）' : ''}`);
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
