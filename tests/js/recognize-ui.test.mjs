// 頂列「AI 辨識」對話框裡不碰 DOM 的部分。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeProvider, probeLocal, engineLabel, applyModelLock, promptToSave } from '../../web/js/ui/recognize.js';
import { DEFAULT_PROMPT } from '../../web/js/recognizer/index.js';

const MODELS = [{ id: 'm-vision', label: 'M Vision', usable: true }];

function harness() {
  const calls = { status: [], models: [] };
  return {
    calls,
    opts: {
      key: 'k',
      setStatus: (t, cls = '') => calls.status.push([t, cls]),
      applyModels: (list) => {
        calls.models.push(list);
        return list[0]?.id ?? '';
      },
    },
  };
}

test('測試連線：正常流程 → 清單套進去、試打成功', async () => {
  const { calls, opts } = harness();
  const r = await probeProvider('claude', { ...opts, isCurrent: () => true, list: async () => MODELS, test: async () => 'OK' });
  assert.equal(r, 'ok');
  assert.deepEqual(calls.models, [MODELS]);
  assert.match(calls.status.at(-1)[0], /連線成功/);
});

test('測試連線：等清單時切到另一家 → 清單與型號不能寫到新的那家底下（回歸 W16）', async () => {
  const { calls, opts } = harness();
  let current = 'claude';
  const r = await probeProvider('claude', {
    ...opts,
    isCurrent: () => current === 'claude',
    list: async () => {
      current = 'gemini'; // 使用者在等待時換了家
      return MODELS;
    },
    test: async () => {
      throw new Error('不該試打');
    },
  });
  assert.equal(r, 'stale');
  assert.deepEqual(calls.models, [], '清單不能套進去');
  assert.equal(calls.status.length, 1, '除了一開始的「取得型號清單…」不能再改狀態列');
});

test('測試連線：試打時切到另一家 → 成功／失敗訊息都不顯示到新的那家', async () => {
  const { calls, opts } = harness();
  let current = 'claude';
  const flip = async () => {
    current = 'gemini';
    throw new Error('金鑰錯');
  };
  const r = await probeProvider('claude', { ...opts, isCurrent: () => current === 'claude', list: async () => MODELS, test: flip });
  assert.equal(r, 'stale');
  assert.ok(!calls.status.some(([t]) => /金鑰錯|連線成功/.test(t)));
});

test('測試連線：失敗要大聲講並回 error', async () => {
  const { calls, opts } = harness();
  const errs = [];
  const r = await probeProvider('claude', { ...opts, isCurrent: () => true, list: async () => [], test: async () => 'x', onError: (e) => errs.push(e.message) });
  assert.equal(r, 'error');
  assert.match(calls.status.at(-1)[0], /沒有回傳看得懂圖的型號/);
  assert.equal(errs.length, 1);
});

test('engineLabel：沒選過回 null；LLM API 顯示公司與型號；本地模型顯示型號', () => {
  assert.equal(engineLabel({ recognizerId: null, api: null }), null);
  assert.match(engineLabel({ recognizerId: 'api', api: { provider: 'claude', model: 'm' } }).text, /m$/);
  assert.equal(engineLabel({ recognizerId: 'mock', api: null }).text, '模擬辨識');
  const local = engineLabel({ recognizerId: 'local', local: { baseUrl: 'http://127.0.0.1:8080', model: 'qwen' } });
  assert.equal(local.text, '本地 qwen');
  assert.match(local.title, /不離開這台電腦/);
  // 還沒按過「測試連線」（沒有型號）就退回一般標籤，不要顯示「本地 undefined」
  assert.equal(engineLabel({ recognizerId: 'local', local: null }).text, '本地模型');
});

// ---------- 本機模型的「測試連線」 ----------
function localHarness() {
  const calls = { status: [], models: [] };
  return {
    calls,
    opts: {
      baseUrl: 'http://127.0.0.1:8080',
      setStatus: (t, cls = '') => calls.status.push([t, cls]),
      applyModels: (list) => {
        calls.models.push(list);
        return list[0]?.id ?? '';
      },
    },
  };
}

const LOCAL_MODELS = [{ id: 'qwen', label: 'qwen', usable: true }];

test('本機測試連線：清單套進去、試打成功', async () => {
  const { calls, opts } = localHarness();
  const r = await probeLocal({ ...opts, list: async () => LOCAL_MODELS, test: async () => 'OK' });
  assert.equal(r, 'ok');
  assert.deepEqual(calls.models, [LOCAL_MODELS]);
  assert.match(calls.status.at(-1)[0], /連線成功/);
});

test('本機測試連線：等待中把網址改掉 → 清單不能套到新的那台（同 W16 的道理）', async () => {
  const { calls, opts } = localHarness();
  let url = opts.baseUrl;
  const r = await probeLocal({
    ...opts,
    isCurrent: () => url === opts.baseUrl,
    list: async () => {
      url = 'http://192.168.0.9:8080';
      return LOCAL_MODELS;
    },
    test: async () => {
      throw new Error('不該試打');
    },
  });
  assert.equal(r, 'stale');
  assert.deepEqual(calls.models, []);
  assert.equal(calls.status.length, 1);
});

test('本機測試連線：伺服器沒開的訊息要照原樣顯示出來', async () => {
  const { calls, opts } = localHarness();
  const r = await probeLocal({
    ...opts,
    list: async () => {
      throw new Error('連不上本機模型伺服器 http://127.0.0.1:8080（Failed to fetch）。請先啟動 llama-server');
    },
  });
  assert.equal(r, 'error');
  assert.match(calls.status.at(-1)[0], /請先啟動 llama-server/);
  assert.equal(calls.status.at(-1)[1], 'err');
});

test('型號下拉：測試連線進行中要鎖住（連「不能看圖」的勾選也鎖），結束後照清單有無決定', () => {
  const sel = { disabled: false };
  const box = { disabled: false };
  applyModelLock(sel, box, { probing: true, empty: false });
  assert.equal(sel.disabled, true);
  assert.equal(box.disabled, true);
  applyModelLock(sel, box, { probing: false, empty: false });
  assert.equal(sel.disabled, false);
  assert.equal(box.disabled, false);
  applyModelLock(sel, box, { probing: false, empty: true });
  assert.equal(sel.disabled, true);
  assert.equal(box.disabled, false);
  applyModelLock(sel, null, { probing: true, empty: true }); // 沒有 checkbox 也不能炸
  assert.equal(sel.disabled, true);
});

test('提示詞：預設已填在欄位裡；沒改／清空就存空字串（沿用預設），改過才存', () => {
  assert.equal(promptToSave(DEFAULT_PROMPT), '');
  assert.equal(promptToSave(`  ${DEFAULT_PROMPT}\n`), '');
  assert.equal(promptToSave(''), '');
  assert.equal(promptToSave('白板在左下角'), '白板在左下角');
  assert.equal(promptToSave('x', 'x'), '');
});
