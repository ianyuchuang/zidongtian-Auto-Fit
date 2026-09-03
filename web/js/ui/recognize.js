// 頂列「🤖 AI 辨識」：選辨識方式（模擬 / 本地 / LLM API＋金鑰）、提示詞與範圍，然後跑辨識。
// 辨識設定從入口頁搬到這裡——沒有 AI 也能純手打三欄，要用 AI 時才需要處理金鑰。

import { RECOGNIZERS, DEFAULT_PROMPT } from '../recognizer/index.js';
import { PROVIDERS, getProvider } from '../recognizer/api/providers.js';
import { loadApiKeys, saveApiKeys } from '../recognizer/api/keys.js';
import { testConnection } from '../recognizer/api/call.js';
import { esc, showDialog, alertDialog, toast } from './dialog.js';

/** 目前引擎的顯示文字（頂列 pill 用）。沒設定過回 null。 */
export function engineLabel({ recognizerId, api }) {
  if (!recognizerId) return null;
  const short = (s) => String(s).split('（')[0];
  if (recognizerId === 'api' && api) {
    const p = PROVIDERS.find((x) => x.id === api.provider);
    const model = api.model ?? p?.model ?? '';
    return {
      text: `${short(p?.label ?? api.provider)} ${model}`.trim(),
      title: `LLM API：${p?.label ?? api.provider}，型號 ${model}（照片會送到這家的伺服器辨識）`,
    };
  }
  let label = recognizerId;
  try {
    label = RECOGNIZERS.find((r) => r.id === recognizerId)?.label ?? recognizerId;
  } catch {
    /* 用 id 當名字 */
  }
  return { text: short(label), title: label };
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

/**
 * 開設定對話框。回傳 { recognizerId, api, prompt, photos } 或 null（取消）。
 * photos＝這次要辨識的照片陣列。
 */
async function askSettings(app) {
  const apiState = loadApiKeys(); // { provider, remember, keys }
  const pending = app.pendingPhotos();
  const checked = app.checkedPhotos().filter((p) => !p.trashed);
  const redoAll = app.redoablePhotos();
  let picked = null;

  const scopes = [
    { id: 'pending', label: `尚未辨識的 ${pending.length} 張`, n: pending.length },
    { id: 'checked', label: `目前勾選的 ${checked.length} 張`, n: checked.length },
    { id: 'all', label: `全部重新辨識（${redoAll.length} 張，不含已確認）`, n: redoAll.length },
  ];

  const ok = await showDialog({
    title: '🤖 AI 辨識',
    body: `
      <div class="opt"><label>辨識方式</label>
        <div class="radios">
          ${RECOGNIZERS.map(
            (r, i) => `<label class="${r.available ? '' : 'disabled'}">
              <input type="radio" name="rec" value="${esc(r.id)}" ${r.available && i === 0 ? 'checked' : ''} ${r.available ? '' : 'disabled'}>
              ${esc(r.label)}${r.available ? '' : ` <span class="small">（${esc(r.note)}）</span>`}
            </label>`,
          ).join('')}
        </div>
      </div>

      <div class="api-panel" id="api-panel" hidden>
        <div class="warn small">照片會縮圖後送到所選公司的伺服器辨識（機密照片請改用本地模型）。金鑰只存在這台電腦的瀏覽器。</div>
        <div class="providers">
          ${PROVIDERS.map(
            (p) => `<div class="provider ${p.available ? '' : 'disabled'}">
              <label><input type="radio" name="api-provider" value="${esc(p.id)}" ${p.available ? '' : 'disabled'}>
                <span class="name">${esc(p.label)}</span>${p.available ? '' : ` <span class="small muted">（${esc(p.note)}）</span>`}</label>
              <span class="links small"><button type="button" class="btn guide" data-guide="${esc(p.id)}">申請教學</button> <a href="${p.apply}" target="_blank" rel="noopener">前往申請頁 ↗</a></span>
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
        <label class="small remember"><input type="checkbox" id="api-forget"> 不要記住金鑰（關閉分頁就清掉）</label>
      </div>

      <div class="opt"><label for="rec-prompt">提示詞（白板欄位位置；留空用預設）</label>
        <textarea id="rec-prompt" rows="3" placeholder="${esc(DEFAULT_PROMPT)}"></textarea></div>

      <div class="opt"><label for="rec-scope">辨識範圍
        <select id="rec-scope">
          ${scopes.map((s) => `<option value="${s.id}" ${s.n ? '' : 'disabled'}>${esc(s.label)}</option>`).join('')}
        </select></label>
        <label class="small remember"><input type="checkbox" id="rec-confirmed"> 連「已確認」的也一起重跑</label>
      </div>`,
    buttons: [
      { label: '取消', value: false },
      { label: '開始辨識', value: true, primary: true },
    ],
    onOpen: (d) => {
      const $ = (s) => d.querySelector(s);
      const setStatus = (text, cls = '') => {
        $('#api-status').textContent = text;
        $('#api-status').className = `small ${cls}`.trim();
      };
      const showProvider = (id) => {
        const p = getProvider(id);
        apiState.provider = id;
        $('#api-key-row').hidden = false;
        $('#api-key-label').textContent = `${p.label} API 金鑰`;
        $('#api-key').placeholder = `貼上金鑰（長得像 ${p.keyHint}）`;
        $('#api-key').value = apiState.keys[id] || '';
        $('#api-model').textContent = `使用型號：${p.model}`;
        setStatus('');
        saveApiKeys(apiState);
      };
      const syncPanel = () => {
        $('#api-panel').hidden = d.querySelector('input[name="rec"]:checked')?.value !== 'api';
      };
      for (const r of d.querySelectorAll('input[name="rec"]')) r.addEventListener('change', syncPanel);
      for (const r of d.querySelectorAll('input[name="api-provider"]')) r.addEventListener('change', () => r.checked && showProvider(r.value));
      for (const b of d.querySelectorAll('button[data-guide]')) b.addEventListener('click', () => showApiGuide(getProvider(b.dataset.guide)));
      $('#api-forget').checked = !apiState.remember;
      $('#api-forget').addEventListener('change', (e) => {
        apiState.remember = !e.target.checked;
        saveApiKeys(apiState);
      });
      $('#api-key').addEventListener('input', (e) => {
        if (!apiState.provider) return;
        apiState.keys[apiState.provider] = e.target.value.trim();
        setStatus('');
        saveApiKeys(apiState);
      });
      $('#api-key-eye').addEventListener('click', () => {
        const i = $('#api-key');
        i.type = i.type === 'password' ? 'text' : 'password';
      });
      $('#api-clear').addEventListener('click', () => {
        if (!apiState.provider) return;
        apiState.keys[apiState.provider] = '';
        $('#api-key').value = '';
        setStatus('');
        saveApiKeys(apiState);
      });
      $('#api-test').addEventListener('click', async () => {
        const pid = apiState.provider;
        const key = (apiState.keys[pid] || '').trim();
        if (!key) {
          setStatus('請先貼上金鑰', 'err');
          $('#api-key').focus();
          return;
        }
        const btn = $('#api-test');
        btn.disabled = true;
        setStatus('連線中…');
        try {
          const reply = await testConnection(pid, { apiKey: key, model: getProvider(pid).model });
          setStatus(`✅ 連線成功（模型回覆：${reply.trim().slice(0, 40)}）`, 'ok');
        } catch (e) {
          setStatus(`❌ ${e.message}`, 'err');
        } finally {
          btn.disabled = false;
        }
      });
      // 上次的設定帶回來
      if (app.state.recognizerId) {
        const r = d.querySelector(`input[name="rec"][value="${app.state.recognizerId}"]`);
        if (r && !r.disabled) r.checked = true;
      }
      if (app.state.prompt) $('#rec-prompt').value = app.state.prompt;
      if (apiState.provider) {
        const r = d.querySelector(`input[name="api-provider"][value="${apiState.provider}"]`);
        if (r && !r.disabled) {
          r.checked = true;
          showProvider(apiState.provider);
        }
      }
      const first = scopes.find((s) => s.n);
      if (first) $('#rec-scope').value = first.id;
      syncPanel();
    },
    beforeClose: (v, d) => {
      if (v !== true) return true;
      const recognizerId = d.querySelector('input[name="rec"]:checked')?.value;
      if (!recognizerId) {
        toast('請選辨識方式', { error: true });
        return false;
      }
      let api = null;
      if (recognizerId === 'api') {
        const pid = apiState.provider;
        if (!pid) {
          toast('請選一家 LLM API', { error: true });
          return false;
        }
        const key = (apiState.keys[pid] || '').trim();
        if (!key) {
          toast(`請貼上 ${getProvider(pid).label} 的 API 金鑰`, { error: true });
          d.querySelector('#api-key').focus();
          return false;
        }
        api = { provider: pid, apiKey: key, model: getProvider(pid).model };
      }
      const scope = d.querySelector('#rec-scope').value;
      const includeConfirmed = d.querySelector('#rec-confirmed').checked;
      const photos =
        scope === 'checked'
          ? app.checkedPhotos()
          : scope === 'all'
            ? app.redoablePhotos({ includeConfirmed })
            : app.pendingPhotos();
      if (!photos.length) {
        toast('這個範圍沒有照片可以辨識', { error: true });
        return false;
      }
      picked = { recognizerId, api, prompt: d.querySelector('#rec-prompt').value.trim(), photos };
      return true;
    },
  });
  return ok === true ? picked : null;
}

/** 頂列「AI 辨識」的完整流程：設定 → 進度條 → 結果提示。 */
export async function runRecognize(app) {
  if (app.state.recognizing) {
    toast('辨識還在進行中', { error: true });
    return;
  }
  const picked = await askSettings(app);
  if (!picked) return;
  app.setRecognizer(picked);

  // 進度條（與「產生 Word 檔」同一種畫面），辨識期間表格與檢視器的欄位一律鎖住
  let box = null;
  const dlg = showDialog({
    title: '辨識中…',
    body: '<div id="pg">準備中</div><div class="progress-bar"><div style="width:0"></div></div><p class="small muted">辨識期間欄位會鎖住，避免打好的字被 AI 蓋掉。</p>',
    buttons: [{ label: '停止辨識', value: 'stop' }],
    onOpen: (d) => (box = d),
  });
  dlg.then((v) => v === 'stop' && app.stopRecognize());
  const off = app.subscribe((what) => {
    if (what !== 'recognize-progress' || !box) return;
    const g = app.state.progress;
    if (!g) return;
    box.querySelector('#pg').textContent = `${g.done} / ${g.total}　${g.name ?? ''}`;
    box.querySelector('.progress-bar > div').style.width = `${Math.round((g.done / Math.max(1, g.total)) * 100)}%`;
  });

  try {
    const r = await app.recognizeAll({ photos: picked.photos });
    const parts = [`辨識完成 ${r.done} / ${r.total} 張`];
    if (r.stopped) parts.push('（已停止）');
    if (r.kept?.length) parts.push(`；${r.kept.length} 張你已經填過或確認過，保留原本的內容`);
    toast(parts.join(''), { ms: 6000 });
  } catch (e) {
    console.error(e);
    await alertDialog('辨識失敗', `<pre style="white-space:pre-wrap">${esc(e.message)}</pre>`);
  } finally {
    off();
    dlg.close();
  }
}
