// 入口頁：只做兩件事——選照片資料夾、選版型。
// 檢查日期改在工作台的資料夾列各自填；AI 辨識在工作台頂列（ui/recognize.js）。
// 版型的讀取與調整在版型調整頁（ui/template-page.js），這裡只顯示目前選了哪一份。

import { memoryTreeFromFileList, MemoryDirectoryHandle } from '../fs/memory.js';
import { scanTree, describeTree, treeSummaryText } from '../fs/adapter.js';
import { saveLastRoot, loadLastRoot, clearLastRoot, ensurePermission } from '../fs/handle-store.js';
import { esc, toast } from './dialog.js';
import { bindFileDrop } from './dnd.js';
import { listTemplates, getTemplate, rememberFor, lastFor } from '../template/library.js';

const FS_OK = typeof globalThis.showDirectoryPicker === 'function';

export function mountEntry(container, app) {
  container.innerHTML = `
  <div class="entry"><div class="entry-card">
    <h1><span>自懂填</span> Auto-Fit</h1>
    <p class="lead muted">選照片資料夾 → 選版型 → 開始讀取。檢查日期與 AI 辨識都在下一頁（工作台）處理。照片只在這台電腦的瀏覽器裡處理，不會上傳。</p>
    ${FS_OK ? '' : '<div class="warn">這個瀏覽器不支援直接讀寫資料夾（請用 Chrome 或 Edge）。目前只能以唯讀複本開啟：可以校對與下載 Word，但拖曳搬移不會真的動到檔案。</div>'}

    <div class="field">
      <span class="label">照片資料夾</span>
      <div class="dropzone" id="dz-folder">
        <div id="folder-text">點選或把資料夾拖到這裡</div>
        <div class="small last-root" id="last-root" hidden></div>
        <div class="small muted hint">會連同子資料夾一起讀取（例：帷幕骨架／4F、5F）</div>
        <div class="small muted alt hint">Chrome 跳出「無法開啟這個資料夾」？那是 Chrome 不讓網頁碰磁碟根目錄、使用者資料夾本身等位置，請改選照片所在的子資料夾；或 <a href="#" id="readonly-pick">改用唯讀方式開啟</a>（可校對、下載 Word，但不會搬動檔案）。</div>
      </div>
      <input type="file" id="folder-input" webkitdirectory multiple hidden>
    </div>

    <div class="field">
      <span class="label">版型</span>
      <div class="dropzone tpl-pickbox" id="dz-template">
        <div id="template-text"></div>
        <div class="small muted hint">拖一份 docx 進來也可以，會直接開調整頁</div>
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
  let template = app.state.template; // 從調整頁回來、或回首頁時帶回上次選的
  const updateStart = () => {
    $('#start').disabled = !rootHandle;
  };

  // ---- 版型：只顯示目前選了哪一份 ＋ 已存的版型下拉 ＋ 讀取版型 ----
  function renderTemplateBox() {
    const saved = listTemplates();
    const cur = template?.spec?.id ?? '';
    const known = cur && saved.some((t) => t.id === cur);
    const name = template ? esc(template.name) : '預設版面（V1.0：A4，每頁 3 列 × 2 張，標楷體）';
    $('#dz-template').classList.toggle('has-pick', !!template);
    $('#template-text').innerHTML = `
      <div class="tpl-now">${template ? `<span class="picked">📄 ${name}</span>` : `<span class="muted">${name}</span>`}</div>
      <div class="tpl-actions">
        ${
          saved.length
            ? `<select id="tpl-pick" title="已存的版型">
                 <option value="">預設版面（V1.0）</option>
                 ${saved.map((t) => `<option value="${esc(t.id)}" ${t.id === cur ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
                 ${template && !known ? `<option value="__cur" selected>${name}（未存）</option>` : ''}
               </select>`
            : ''
        }
        <button type="button" class="btn" id="tpl-open">讀取版型</button>
      </div>`;
    $('#tpl-pick')?.addEventListener('change', (e) => {
      if (e.target.value === '__cur') return;
      const t = e.target.value ? getTemplate(e.target.value) : null;
      setTemplate(t ? { name: t.name, file: null, spec: t.spec } : null);
    });
    $('#tpl-open').addEventListener('click', (e) => {
      e.stopPropagation();
      app.openTemplatePage();
    });
  }

  function setTemplate(tpl) {
    template = tpl;
    app.state.template = tpl; // 回首頁 / 進調整頁再回來時還在
    renderTemplateBox();
  }

  bindFileDrop($('#dz-template'), (dt) => {
    const f = dt.files?.[0];
    if (f && /\.docx$/i.test(f.name)) app.openTemplatePage(f); // 直接進調整頁解析
    else if (f && /\.doc$/i.test(f.name)) toast('舊的 .doc 讀不了，請先用 Word 另存成 .docx', { error: true });
    else toast('請拖入 docx 檔', { error: true });
  });
  renderTemplateBox();

  // ---- 資料夾 ----
  // 選到之後把名稱顯示出來，並掃一次樹列出子資料夾與張數
  //（瀏覽器基於安全限制拿不到完整磁碟路徑，只能顯示資料夾名稱與底下結構）。
  let pickSeq = 0;
  const setFolder = async (handle, ro, label) => {
    rootHandle = handle;
    readOnly = ro;
    if (!template) {
      const last = lastFor(handle.name);
      if (last) {
        setTemplate({ name: last.name, file: null, spec: last.spec });
        toast(`帶回上次用的版型「${last.name}」`);
      }
    }
    const seq = ++pickSeq;
    const roTag = ro ? ' <span class="small muted">（唯讀複本）</span>' : '';
    $('#dz-folder').classList.add('has-pick');
    $('#folder-text').innerHTML = `<span class="picked">🗀 ${esc(label)}</span>${roTag}<div class="small muted summary">讀取資料夾結構中…</div>`;
    $('#start').disabled = true;
    try {
      const summary = treeSummaryText(describeTree(await scanTree(handle)));
      if (seq !== pickSeq) return; // 期間又選了別的資料夾
      $('#folder-text').innerHTML = `<span class="picked">🗀 ${esc(label)}</span>${roTag}<div class="small muted summary">${esc(summary)}</div>`;
      updateStart();
    } catch (e) {
      if (seq !== pickSeq) return;
      console.error(e);
      $('#folder-text').innerHTML = `<span class="picked">🗀 ${esc(label)}</span>${roTag}<div class="small summary" style="color:var(--red-text)">讀取資料夾結構失敗：${esc(e.message)}</div>`;
    }
  };

  // ---- 帶回上次的資料夾 ----
  // 回首頁時 app.state.root 還在，直接接回去；重新整理後 handle 從 IndexedDB 撈，
  // Chrome 需要使用者點一下才會給權限，所以放一顆按鈕。
  if (app.state.root) {
    setFolder(app.state.root, app.state.readOnly, app.state.root.name);
  } else {
    loadLastRoot().then(async (h) => {
      if (!h || rootHandle) return;
      const el = $('#last-root');
      const ready = await ensurePermission(h);
      el.hidden = false;
      el.innerHTML = `上次開的是 <b>${esc(h.name)}</b> <button type="button" class="btn tiny" id="use-last">${ready ? '直接開啟' : '接回這個資料夾'}</button> <button type="button" class="btn tiny" id="forget-last">忘掉</button>`;
      el.querySelector('#use-last').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!(await ensurePermission(h, { request: true }))) {
          toast('沒有取得資料夾的讀寫權限', { error: true });
          return;
        }
        el.hidden = true;
        setFolder(h, false, h.name);
      });
      el.querySelector('#forget-last').addEventListener('click', (e) => {
        e.stopPropagation();
        clearLastRoot();
        el.hidden = true;
      });
    });
  }

  // ---- 資料夾：點選 ----
  $('#readonly-pick').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    $('#folder-input').click();
  });
  $('#dz-folder').addEventListener('click', async () => {
    if (FS_OK) {
      try {
        const h = await showDirectoryPicker({ mode: 'readwrite' });
        setFolder(h, false, h.name);
      } catch (e) {
        if (e.name !== 'AbortError') toast(`無法開啟資料夾：${e.message}`, { error: true });
        else toast('沒有選到資料夾。若 Chrome 說「包含系統檔案」，請改選照片所在的子資料夾，或用「唯讀方式開啟」。', { ms: 6000 });
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
  bindFileDrop($('#dz-folder'), async (dt) => {
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
          // 先把空資料夾也建出來，否則唯讀複本會看不到沒有照片的樓層（bug清單 C8）
          for (const d of idx.dirs ?? []) {
            let dir = root;
            for (const s of d.split('/')) dir = await dir.getDirectoryHandle(s, { create: true });
          }
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

  // ---- 開始讀取 ----
  $('#start').addEventListener('click', async () => {
    $('#start').disabled = true;
    $('#status').textContent = '讀取資料夾中…';
    try {
      rememberFor(rootHandle.name, template?.spec?.id ?? null);
      await app.open({ rootHandle, readOnly, template });
      if (!readOnly) saveLastRoot(rootHandle); // 下次重新整理可以一鍵接回
    } catch (e) {
      console.error(e);
      toast(`讀取失敗：${e.message}`, { error: true });
      $('#start').disabled = false;
      $('#status').textContent = '';
    }
  });
}
