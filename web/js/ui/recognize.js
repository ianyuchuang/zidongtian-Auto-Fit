// 頂列「🤖 AI 辨識」：選辨識方式（模擬 / 本地 / LLM API＋金鑰）、提示詞與範圍，然後跑辨識。
// 辨識設定從入口頁搬到這裡——沒有 AI 也能純手打三欄，要用 AI 時才需要處理金鑰。

import { RECOGNIZERS, DEFAULT_PROMPT } from '../recognizer/index.js';
import { PROVIDERS, getProvider } from '../recognizer/api/providers.js';
import { loadApiKeys, saveApiKeys } from '../recognizer/api/keys.js';
import { testConnection, listModels } from '../recognizer/api/call.js';
import { STATUS, isTrashed } from '../state.js';
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
 * 辨識範圍 → 這次要辨識的照片。三種範圍都遵守同一條規則：
 * 「已確認」的只有勾了「連已確認的也一起重跑」才會排進去（介面規格：另有勾選項才會連已確認的一起重跑）；
 * 之前「目前勾選的」沒套這條，勾到已確認的照片會被 AI 直接洗掉（bug W5）。
 */
export function scopePhotos(app, scope, { includeConfirmed = false } = {}) {
  if (scope === 'pending') return app.pendingPhotos();
  if (scope === 'all') return app.redoablePhotos({ includeConfirmed });
  if (scope === 'checked') return app.checkedPhotos().filter((p) => !isTrashed(p) && (includeConfirmed || p.status !== STATUS.CONFIRMED));
  throw new Error(`沒有這種辨識範圍：${scope}`);
}

/**
 * 開設定對話框。回傳 { recognizerId, api, prompt, photos, includeConfirmed } 或 null（取消）。
 * photos＝這次要辨識的照片陣列。
 */
async function askSettings(app) {
  const apiState = loadApiKeys(); // { provider, remember, keys }
  const pending = app.pendingPhotos();
  const checked = app.checkedPhotos().filter((p) => !isTrashed(p));
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
          <div id="api-extra"></div>
          <div class="api-model-row">
            <label for="api-model">型號（按「測試連線」向伺服器要，不寫死在程式裡）</label>
            <select id="api-model" disabled><option value="">按「測試連線」取得可用型號</option></select>
            <label class="small"><input type="checkbox" id="api-model-all"> 連不能看圖的型號也列出來</label>
          </div>
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
      // 型號清單：只有按過「測試連線」才會有東西；上次選過的先當成單筆清單帶回來
      let modelList = [];
      const rememberModel = (id) => {
        if (!apiState.provider) return;
        if (id) apiState.models[apiState.provider] = id;
        else delete apiState.models[apiState.provider];
        saveApiKeys(apiState);
      };
      const fillModels = (chosen) => {
        const sel = $('#api-model');
        const use = modelList.filter((m) => $('#api-model-all').checked || m.usable);
        if (!use.length) {
          sel.disabled = true;
          sel.innerHTML = `<option value="">${modelList.length ? '這家沒有看得懂圖的型號，勾下面那格再挑' : '按「測試連線」取得可用型號'}</option>`;
          return;
        }
        // 預設選誰：上次選過的 → providers.js 的 prefer 關鍵字（依序）→ 後備型號 → 清單第一個。
        // 清單永遠是伺服器給的，這裡只決定游標停在哪一個。
        const p = getProvider(apiState.provider);
        const byKeyword = (p.prefer || []).map((k) => use.find((m) => m.id.toLowerCase().includes(k.toLowerCase()))?.id);
        const pick = [chosen, ...byKeyword, p.model].find((id) => id && use.some((m) => m.id === id)) || use[0].id;
        sel.disabled = false;
        sel.innerHTML = use
          .map(
            (m) =>
              `<option value="${esc(m.id)}" ${m.id === pick ? 'selected' : ''}>${esc(m.label)}${m.label === m.id ? '' : `（${esc(m.id)}）`}${m.usable ? '' : '　※ 不是看圖用的'}</option>`,
          )
          .join('');
        sel.value = pick;
        rememberModel(pick);
      };
      const showProvider = (id) => {
        const p = getProvider(id);
        apiState.provider = id;
        apiState.extras[id] ||= {};
        $('#api-key-row').hidden = false;
        $('#api-key-label').textContent = `${p.label} API 金鑰`;
        $('#api-key').placeholder = `貼上金鑰（長得像 ${p.keyHint}）`;
        $('#api-key').value = apiState.keys[id] || '';
        // 這家除了金鑰以外還要填的欄位（Claude 公司帳號的 Workspace ID）
        $('#api-extra').innerHTML = (p.extraFields || [])
          .map(
            (f) => `<div class="api-extra-field">
              <label for="x-${esc(f.id)}">${esc(f.label)}</label>
              <input type="text" id="x-${esc(f.id)}" data-extra="${esc(f.id)}" placeholder="${esc(f.placeholder ?? '')}" autocomplete="off" spellcheck="false">
              ${f.help ? `<div class="small muted">${esc(f.help)}</div>` : ''}
            </div>`,
          )
          .join('');
        for (const i of $('#api-extra').querySelectorAll('[data-extra]')) {
          i.value = apiState.extras[id][i.dataset.extra] || '';
          i.addEventListener('input', (e) => {
            apiState.extras[apiState.provider][i.dataset.extra] = e.target.value.trim();
            saveApiKeys(apiState);
          });
        }
        const saved = apiState.models[id] || '';
        modelList = saved ? [{ id: saved, label: saved, usable: true }] : [];
        $('#api-model-all').checked = false;
        fillModels(saved);
        setStatus(saved ? '上次選的型號；按「測試連線」重新取得清單' : '', 'muted');
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
      $('#api-model').addEventListener('change', (e) => {
        rememberModel(e.target.value);
        setStatus('');
      });
      $('#api-model-all').addEventListener('change', () => fillModels($('#api-model').value));
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
        const extra = { ...(apiState.extras[pid] || {}) };
        try {
          setStatus('取得型號清單…');
          modelList = await listModels(pid, { apiKey: key, extra });
          fillModels(apiState.models[pid] || '');
          const model = $('#api-model').value;
          if (!model) throw new Error('伺服器沒有回傳看得懂圖的型號（勾「連不能看圖的型號也列出來」可自己挑）');
          setStatus(`型號清單 ${modelList.length} 個，正在用 ${model} 試打…`);
          const reply = await testConnection(pid, { apiKey: key, model, extra });
          setStatus(`✅ 連線成功，可用型號 ${modelList.filter((m) => m.usable).length} 個；${model} 回覆「${reply.trim().slice(0, 20)}」`, 'ok');
        } catch (e) {
          setStatus(`❌ ${e.message}`, 'err');
          // workspace 沒填就是這個錯，直接把游標送到那一格
          const ws = d.querySelector('[data-extra="workspaceId"]');
          if (ws && /workspace-id/i.test(e.message)) ws.focus();
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
        const model = (d.querySelector('#api-model').value || '').trim();
        if (!model) {
          toast('請先按「測試連線」取得型號清單，再挑一個型號', { error: true });
          return false;
        }
        api = { provider: pid, apiKey: key, model, extra: { ...(apiState.extras[pid] || {}) } };
      }
      const scope = d.querySelector('#rec-scope').value;
      const includeConfirmed = d.querySelector('#rec-confirmed').checked;
      const photos = scopePhotos(app, scope, { includeConfirmed });
      if (!photos.length) {
        toast(scope === 'checked' && !includeConfirmed ? '勾選的都已確認；要重跑請勾「連已確認的也一起重跑」' : '這個範圍沒有照片可以辨識', { error: true });
        return false;
      }
      picked = { recognizerId, api, prompt: d.querySelector('#rec-prompt').value.trim(), photos, includeConfirmed };
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
    const r = await app.recognizeAll({ photos: picked.photos, includeConfirmed: picked.includeConfirmed });
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
