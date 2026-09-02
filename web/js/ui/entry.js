// 入口頁：選資料夾、板型、提示詞、檢查日期、辨識方式 → 開始讀取。

import { RECOGNIZERS, DEFAULT_PROMPT } from '../recognizer/index.js';
import { PROVIDERS, getProvider } from '../recognizer/api/providers.js';
import { loadApiKeys, saveApiKeys } from '../recognizer/api/keys.js';
import { testConnection } from '../recognizer/api/call.js';
import { todayRoc, parseRocInput } from '../rocdate.js';
import { memoryTreeFromFileList, MemoryDirectoryHandle } from '../fs/memory.js';
import { scanTree, describeTree, treeSummaryText } from '../fs/adapter.js';
import { esc, toast, showDialog } from './dialog.js';

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
        <div class="small muted hint">會連同子資料夾一起讀取（例：帷幕骨架／4F、5F）</div>
        <div class="small muted alt hint">Chrome 跳出「無法開啟這個資料夾」？那是 Chrome 不讓網頁碰磁碟根目錄、使用者資料夾本身等位置，請改選照片所在的子資料夾；或 <a href="#" id="readonly-pick">改用唯讀方式開啟</a>（可校對、下載 Word，但不會搬動檔案）。</div>
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

    <div class="api-panel" id="api-panel" hidden>
      <div class="warn small">選 LLM API 時，照片會縮圖後送到所選公司的伺服器辨識（機密照片請改用本地模型）。金鑰只存在這台電腦的瀏覽器，不會傳給別人。</div>
      <div class="providers">
        ${PROVIDERS.map(
          (p) => `<div class="provider ${p.available ? '' : 'disabled'}">
            <label><input type="radio" name="api-provider" value="${p.id}" ${p.available ? '' : 'disabled'}>
              <span class="name">${esc(p.label)}</span>${p.available ? '' : ` <span class="small muted">（${esc(p.note)}）</span>`}</label>
            <span class="links small"><button type="button" class="btn guide" data-guide="${p.id}">申請教學</button> <a href="${p.apply}" target="_blank" rel="noopener">前往申請頁 ↗</a></span>
          </div>`,
        ).join('')}
      </div>
      <div class="api-key-row" id="api-key-row" hidden>
        <label for="api-key" id="api-key-label">API 金鑰</label>
        <div class="api-key-inputs">
          <input type="password" id="api-key" autocomplete="off" spellcheck="false">
          <button class="btn" id="api-key-eye" type="button" title="顯示／隱藏金鑰">👁</button>
          <button class="btn" id="api-test" type="button">測試連線</button>
          <button class="btn" id="api-clear" type="button">清除</button>
        </div>
        <div class="small muted" id="api-model"></div>
        <div class="small" id="api-status"></div>
      </div>
      <label class="small remember"><input type="checkbox" id="api-forget"> 不要記住金鑰（關閉分頁就清掉；預設會存在這台電腦的瀏覽器，下次自動帶入）</label>
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

  // 選到資料夾後，像板型一樣把名稱顯示出來，並掃一次樹列出子資料夾與張數
  //（瀏覽器基於安全限制拿不到完整磁碟路徑，只能顯示資料夾名稱與底下結構）。
  let pickSeq = 0;
  const setFolder = async (handle, ro, label) => {
    rootHandle = handle;
    readOnly = ro;
    const seq = ++pickSeq;
    const roTag = ro ? ' <span class="small muted">（唯讀複本）</span>' : '';
    $('#dz-folder').classList.add('has-pick');
    $('#folder-text').innerHTML = `<span class="picked">🗀 ${esc(label)}</span>${roTag}<div class="small muted summary">讀取資料夾結構中…</div>`;
    $('#start').disabled = true;
    try {
      const summary = treeSummaryText(describeTree(await scanTree(handle)));
      if (seq !== pickSeq) return; // 期間又選了別的資料夾
      $('#folder-text').innerHTML = `<span class="picked">🗀 ${esc(label)}</span>${roTag}<div class="small muted summary">${esc(summary)}</div>`;
      $('#start').disabled = false;
    } catch (e) {
      if (seq !== pickSeq) return;
      console.error(e);
      $('#folder-text').innerHTML = `<span class="picked">🗀 ${esc(label)}</span>${roTag}<div class="small summary" style="color:var(--red-text)">讀取資料夾結構失敗：${esc(e.message)}</div>`;
    }
  };

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

  // ---- LLM API：選到「LLM API」才展開四家；選到某家才出現金鑰輸入格 ----
  const apiState = loadApiKeys(); // { provider, remember, keys }
  const persistApi = () => saveApiKeys(apiState);
  const setApiStatus = (text, cls = '') => {
    const el = $('#api-status');
    el.textContent = text;
    el.className = `small ${cls}`.trim();
  };
  const showProvider = (id) => {
    const p = getProvider(id);
    apiState.provider = id;
    $('#api-key-row').hidden = false;
    $('#api-key-label').textContent = `${p.label} API 金鑰`;
    $('#api-key').placeholder = `貼上金鑰（長得像 ${p.keyHint}）`;
    $('#api-key').value = apiState.keys[id] || '';
    $('#api-model').textContent = `使用型號：${p.model}`;
    setApiStatus('');
    persistApi();
  };
  const updateApiPanel = () => {
    $('#api-panel').hidden = container.querySelector('input[name="rec"]:checked')?.value !== 'api';
  };
  for (const r of container.querySelectorAll('input[name="rec"]')) r.addEventListener('change', updateApiPanel);
  for (const r of container.querySelectorAll('input[name="api-provider"]')) {
    r.addEventListener('change', () => r.checked && showProvider(r.value));
  }
  for (const b of container.querySelectorAll('button[data-guide]')) {
    b.addEventListener('click', () => showApiGuide(getProvider(b.dataset.guide)));
  }
  $('#api-forget').checked = !apiState.remember;
  $('#api-forget').addEventListener('change', (e) => {
    apiState.remember = !e.target.checked;
    persistApi(); // 不記住 → 立刻把先前存的金鑰清掉（記憶體裡的這次仍可用）
  });
  $('#api-key').addEventListener('input', (e) => {
    if (!apiState.provider) return;
    apiState.keys[apiState.provider] = e.target.value.trim();
    setApiStatus('');
    persistApi();
  });
  $('#api-key-eye').addEventListener('click', () => {
    const i = $('#api-key');
    i.type = i.type === 'password' ? 'text' : 'password';
  });
  $('#api-clear').addEventListener('click', () => {
    if (!apiState.provider) return;
    apiState.keys[apiState.provider] = '';
    $('#api-key').value = '';
    setApiStatus('');
    persistApi();
  });
  $('#api-test').addEventListener('click', async () => {
    const pid = apiState.provider;
    const key = (apiState.keys[pid] || '').trim();
    if (!key) {
      setApiStatus('請先貼上金鑰', 'err');
      $('#api-key').focus();
      return;
    }
    const btn = $('#api-test');
    btn.disabled = true;
    setApiStatus('連線中…');
    try {
      const reply = await testConnection(pid, { apiKey: key, model: getProvider(pid).model });
      setApiStatus(`✅ 連線成功（模型回覆：${reply.trim().slice(0, 40)}）`, 'ok');
    } catch (e) {
      setApiStatus(`❌ ${e.message}`, 'err');
    } finally {
      btn.disabled = false;
    }
  });
  // 上次選過的供應商自動帶回
  if (apiState.provider) {
    const r = container.querySelector(`input[name="api-provider"][value="${apiState.provider}"]`);
    if (r && !r.disabled) {
      r.checked = true;
      showProvider(apiState.provider);
    }
  }
  updateApiPanel();

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
    let api = null;
    if (recognizerId === 'api') {
      const pid = apiState.provider;
      if (!pid) {
        toast('請選一家 LLM API', { error: true });
        return;
      }
      const key = (apiState.keys[pid] || '').trim();
      if (!key) {
        toast(`請貼上 ${getProvider(pid).label} 的 API 金鑰`, { error: true });
        $('#api-key').focus();
        return;
      }
      api = { provider: pid, apiKey: key, model: getProvider(pid).model };
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
        api,
      });
    } catch (e) {
      console.error(e);
      toast(`讀取失敗：${e.message}`, { error: true });
      $('#start').disabled = false;
      $('#status').textContent = '';
    }
  });
}

/** 「申請教學」彈窗：步驟、付費方式、價格、官方連結；「前往申請頁」另開分頁。 */
async function showApiGuide(p) {
  const body = `
    <ol class="guide-steps">${p.steps.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
    <p class="small"><b>付費方式：</b>${esc(p.billing)}</p>
    ${p.price ? `<p class="small"><b>價格：</b>${esc(p.price)}</p>` : ''}
    <p class="small muted">金鑰只存在這台電腦的瀏覽器；請到該公司主控台設用量上限。官方說明：<a href="${p.guide}" target="_blank" rel="noopener">${esc(p.guide)}</a></p>`;
  const v = await showDialog({
    title: `${p.label} API 金鑰申請教學`,
    body,
    buttons: [
      { label: '關閉', value: null },
      { label: '前往申請頁 ↗', value: 'go', primary: true },
    ],
  });
  if (v === 'go') window.open(p.apply, '_blank', 'noopener');
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
