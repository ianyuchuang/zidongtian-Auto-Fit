// 入口頁：選資料夾、板型、提示詞、檢查日期、辨識方式 → 開始讀取。

import { RECOGNIZERS, DEFAULT_PROMPT } from '../recognizer/index.js';
import { todayRoc, parseRocInput } from '../rocdate.js';
import { memoryTreeFromFileList, MemoryDirectoryHandle } from '../fs/memory.js';
import { esc, toast } from './dialog.js';

const FS_OK = typeof globalThis.showDirectoryPicker === 'function';

export function mountEntry(container, app) {
  container.innerHTML = `
  <div class="entry"><div class="entry-card">
    <h1><span>自懂填</span> Auto-Fit</h1>
    <p class="lead muted">選照片資料夾 → 自動填「內容說明／設計／實際」→ 校對 → 產生 Word。照片只在這台電腦的瀏覽器裡處理，不會上傳。</p>
    ${FS_OK ? '' : '<div class="warn">這個瀏覽器不支援直接讀寫資料夾（請用 Chrome 或 Edge）。目前只能以唯讀複本開啟：可以校對與下載 Word，但拖曳搬移不會真的動到檔案。</div>'}

    <div class="field">
      <span class="label">照片資料夾</span>
      <div class="dropzone" id="dz-folder">
        <div id="folder-text">點選或把資料夾拖到這裡</div>
        <div class="small muted">會連同子資料夾一起讀取（例：帷幕骨架／4F、5F）</div>
      </div>
      <input type="file" id="folder-input" webkitdirectory multiple hidden>
    </div>

    <div class="field">
      <span class="label">板型</span>
      <div class="dropzone" id="dz-template">
        <div id="template-text">預設＝V1.0 版面（A4，每頁 3 列 × 2 張，標楷體）。點選或拖入 docx 可換板型</div>
      </div>
      <input type="file" id="template-input" accept=".docx,.doc" hidden>
    </div>

    <div class="field">
      <label for="prompt">提示詞（白板欄位位置；留空用預設）</label>
      <textarea id="prompt" placeholder="${esc(DEFAULT_PROMPT)}"></textarea>
    </div>

    <div class="row">
      <div class="field">
        <label for="date">檢查日期（民國）</label>
        <input type="text" id="date" value="${todayRoc()}" placeholder="例如 1150725">
      </div>
      <div class="field">
        <span class="label">辨識方式</span>
        <div class="radios">
          ${RECOGNIZERS.map(
            (r, i) => `<label class="${r.available ? '' : 'disabled'}">
              <input type="radio" name="rec" value="${r.id}" ${r.available && i === 0 ? 'checked' : ''} ${r.available ? '' : 'disabled'}>
              ${esc(r.label)}${r.available ? '' : ` <span class="small">（${esc(r.note)}）</span>`}
            </label>`,
          ).join('')}
        </div>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-primary" id="start" disabled>開始讀取</button>
      <span id="sample-slot"></span>
      <span class="muted small" id="status"></span>
    </div>
  </div></div>`;

  const $ = (s) => container.querySelector(s);
  let rootHandle = null;
  let readOnly = false;
  let template = null;

  const setFolder = (handle, ro, label) => {
    rootHandle = handle;
    readOnly = ro;
    $('#folder-text').innerHTML = `<span class="picked">${esc(label)}</span>${ro ? ' <span class="small muted">（唯讀複本）</span>' : ''}`;
    $('#start').disabled = !rootHandle;
  };

  // ---- 資料夾：點選 ----
  $('#dz-folder').addEventListener('click', async () => {
    if (FS_OK) {
      try {
        const h = await showDirectoryPicker({ mode: 'readwrite' });
        setFolder(h, false, h.name);
      } catch (e) {
        if (e.name !== 'AbortError') toast(`無法開啟資料夾：${e.message}`, { error: true });
      }
    } else {
      $('#folder-input').click();
    }
  });
  $('#folder-input').addEventListener('change', (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const h = memoryTreeFromFileList(files);
    setFolder(h, true, h.name);
  });

  // ---- 資料夾：拖放 ----
  bindDrop($('#dz-folder'), async (dt) => {
    const item = dt.items?.[0];
    if (item && typeof item.getAsFileSystemHandle === 'function') {
      const h = await item.getAsFileSystemHandle();
      if (h?.kind === 'directory') {
        if ((await h.requestPermission?.({ mode: 'readwrite' })) === 'denied') {
          toast('沒有取得資料夾的寫入權限', { error: true });
          return;
        }
        setFolder(h, false, h.name);
        return;
      }
      toast('請拖入資料夾，不是檔案', { error: true });
      return;
    }
    toast('這個瀏覽器不支援拖放資料夾，請改用點選', { error: true });
  });

  // ---- 板型 ----
  const setTemplate = (file) => {
    template = { name: file.name, file };
    $('#template-text').innerHTML = `<span class="picked">${esc(file.name)}</span> <span class="small muted">（目前只記錄檔名，輸出仍用預設版面）</span>`;
  };
  $('#dz-template').addEventListener('click', () => $('#template-input').click());
  $('#template-input').addEventListener('change', (e) => e.target.files[0] && setTemplate(e.target.files[0]));
  bindDrop($('#dz-template'), (dt) => {
    const f = dt.files?.[0];
    if (f && /\.docx?$/i.test(f.name)) setTemplate(f);
    else toast('請拖入 doc / docx 檔', { error: true });
  });

  // ---- 範例（開發用，由 dev_server 的 /samples/ 提供）----
  fetch('samples/index.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((idx) => {
      if (!idx?.files?.length) return;
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = `載入範例：${idx.root}（唯讀複本）`;
      b.addEventListener('click', async () => {
        b.disabled = true;
        $('#status').textContent = '下載範例中…';
        try {
          const root = new MemoryDirectoryHandle(idx.root);
          for (const f of idx.files) {
            const blob = await (await fetch(f.url, { cache: 'no-store' })).blob();
            const parts = f.path.split('/');
            let dir = root;
            for (const s of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(s, { create: true });
            const name = parts[parts.length - 1];
            dir.putFile(name, new File([blob], name, { type: blob.type }));
          }
          setFolder(root, true, `${idx.root}（範例）`);
          $('#status').textContent = '';
        } catch (e) {
          toast(`範例載入失敗：${e.message}`, { error: true });
        } finally {
          b.disabled = false;
        }
      });
      $('#sample-slot').appendChild(b);
    })
    .catch(() => {});

  // ---- 開始 ----
  $('#start').addEventListener('click', async () => {
    let date;
    try {
      date = parseRocInput($('#date').value);
    } catch (e) {
      toast(e.message, { error: true });
      $('#date').focus();
      return;
    }
    const recognizerId = container.querySelector('input[name="rec"]:checked')?.value;
    if (!recognizerId) {
      toast('請選辨識方式', { error: true });
      return;
    }
    $('#start').disabled = true;
    $('#status').textContent = '讀取資料夾中…';
    try {
      await app.open({
        rootHandle,
        readOnly,
        date,
        template,
        prompt: $('#prompt').value.trim(),
        recognizerId,
      });
    } catch (e) {
      console.error(e);
      toast(`讀取失敗：${e.message}`, { error: true });
      $('#start').disabled = false;
      $('#status').textContent = '';
    }
  });
}

function bindDrop(zone, onDrop) {
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    try {
      await onDrop(e.dataTransfer);
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
}
