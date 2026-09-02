// 頂列：資料夾 / 板型 / 日期 pill、批次修改設計值、產生 Word 檔。

import { parseRocInput } from '../rocdate.js';
import { esc, showDialog, alertDialog, confirmDialog, promptDialog, toast } from './dialog.js';

export function mountTopbar(container, app) {
  container.className = 'topbar';

  function render() {
    const { root, readOnly, template } = app.state;
    const d = app.dateInfo();
    container.innerHTML = `
      <div class="brand" data-act="home" title="回首頁"><span>自懂填</span> Auto-Fit</div>
      <span class="pill" title="${esc(root?.name ?? '')}">🗀 資料夾 ${esc(root?.name ?? '')}${readOnly ? '（唯讀複本）' : ''}</span>
      <span class="pill" title="${esc(template?.name ?? '')}">📄 板型 ${template ? esc(template.name) + '（尚未套用，輸出用預設）' : '預設（每頁 3 列 × 2 張）'}</span>
      <span class="pill clickable" data-act="date" title="點選修改">📅 檢查日期 ${d.compact}</span>
      <span class="spacer"></span>
      <button class="btn" data-act="batch">批次修改設計值</button>
      <button class="btn btn-primary" data-act="export">產生 Word 檔</button>`;
  }

  container.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'home') {
      const ok = await confirmDialog('回首頁', '校對結果已暫存在瀏覽器裡，下次開同一個資料夾會接回來。要回首頁嗎？');
      if (ok) app.goHome();
    } else if (act === 'date') {
      const v = await promptDialog('修改檢查日期', { label: '民國格式，例如 1150725', value: app.dateInfo().compact });
      if (v == null) return;
      try {
        app.setDate(parseRocInput(v));
        render();
      } catch (err) {
        toast(err.message, { error: true });
      }
    } else if (act === 'batch') {
      await batchDesign(app);
    } else if (act === 'export') {
      await exportWord(app);
    }
  });

  const unsubscribe = app.subscribe((what) => (what === 'page' || what === 'date') && render());
  render();
  return unsubscribe;
}

async function batchDesign(app) {
  const visibleN = app.visiblePhotos().length;
  const dirName = app.state.dirFilter == null ? '（未選資料夾）' : app.dirOf(app.state.dirFilter)?.name;
  let scope;
  let value;
  const ok = await showDialog({
    title: '批次修改設計值',
    body: `
      <div class="opt"><label>套用範圍
        <select id="scope">
          <option value="visible">目前篩選出的 ${visibleN} 列</option>
          <option value="dir" ${app.state.dirFilter == null ? 'disabled' : ''}>目前選取的資料夾 ${esc(dirName)}</option>
          <option value="all">全部 ${app.state.photos.length} 張</option>
        </select></label></div>
      <div class="opt"><label>設計值<input type="text" id="val" placeholder="例如 700mm±10"></label></div>`,
    buttons: [
      { label: '取消', value: false },
      { label: '套用', value: true, primary: true },
    ],
    onOpen: (d) => d.querySelector('#val').focus(),
    beforeClose: (v, d) => {
      scope = d.querySelector('#scope').value;
      value = d.querySelector('#val').value.trim();
      if (v === true && !value) {
        toast('請輸入設計值', { error: true });
        return false;
      }
      return true;
    },
  });
  if (ok !== true) return;
  const n = app.batchDesign(value, scope);
  toast(`已把 ${n} 張的設計值改成「${value}」`);
}

async function exportWord(app) {
  const plan = app.exportPlan();
  if (!plan.groups.length) {
    await alertDialog('無法產生', '沒有可輸出的照片（內容說明都是空的）。');
    return;
  }
  const list = plan.groups.map((g) => `<li>${esc(g.folderName)}：${g.photos.length} 張</li>`).join('');
  const trashed = plan.trashed?.length ? `<p class="muted">回收桶（_回收桶）裡的 ${plan.trashed.length} 張不輸出。</p>` : '';
  const warn = plan.warnings.length ? `<p style="color:var(--yellow-text)">${plan.warnings.map(esc).join('<br>')}</p>` : '';
  const go = await showDialog({
    title: '產生 Word 檔',
    body: `<p>每個資料夾各產生一份，存在該資料夾${app.state.readOnly ? '（唯讀模式改為下載）' : ''}，檔名「${esc(app.dateInfo().compact)} 資料夾名.docx」。</p><ul>${list}</ul>${trashed}${warn}`,
    buttons: [
      { label: '取消', value: false },
      { label: '產生', value: true, primary: true },
    ],
  });
  if (go !== true) return;

  let progressEl;
  const done = showDialog({
    title: '產生中…',
    body: '<div id="pg">準備中</div><div class="progress-bar"><div style="width:0"></div></div>',
    buttons: [],
    onOpen: (d) => (progressEl = d),
  });
  try {
    const { results, skipped } = await app.exportWord({
      onProgress: ({ group, groups, i, n, folder }) => {
        if (!progressEl) return;
        progressEl.querySelector('#pg').textContent = `資料夾 ${folder}（${group}/${groups}）：照片 ${i}/${n}`;
        progressEl.querySelector('.progress-bar > div').style.width = `${Math.round((i / n) * 100)}%`;
      },
    });
    progressEl.remove();
    const lines = results.map(
      (r) =>
        `<li>${esc(r.file)}（${r.count} 張）${r.failures.length ? `<br><span style="color:var(--red-text)">${r.failures.map(esc).join('<br>')}</span>` : ''}</li>`,
    );
    const skip = skipped.length ? `<p class="muted">略過（內容說明為空）：${skipped.map((p) => esc(p.name)).join('、')}</p>` : '';
    await alertDialog('完成', `<ul>${lines.join('')}</ul>${skip}`);
  } catch (err) {
    progressEl?.remove();
    console.error(err);
    await alertDialog('產生失敗', `<pre style="white-space:pre-wrap">${esc(err.message)}</pre>`);
  }
  done.catch(() => {});
}
