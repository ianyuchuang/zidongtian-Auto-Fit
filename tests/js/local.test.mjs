// 本地模型（本機 llama-server）：HTTP 呼叫、設定保存、辨識器。全部注入 fetch，不打真的伺服器。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBaseUrl, listLocalModels, localChat, testLocalConnection, DEFAULT_BASE_URL } from '../../web/js/recognizer/local/server.js';
import { loadLocalSettings, saveLocalSettings, LOCAL_STORAGE_KEY } from '../../web/js/recognizer/local/settings.js';
import { createLocalRecognizer } from '../../web/js/recognizer/local.js';

class FakeStorage {
  constructor() {
    this.m = new Map();
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    this.m.set(k, String(v));
  }
  removeItem(k) {
    this.m.delete(k);
  }
}

const fakeFetch = (status, body) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  fn.calls = calls;
  return fn;
};

const CHAT_OK = { choices: [{ message: { content: '{"desc":"輕隔間 1107梯廳","design":"1100mm±10","actual":"1100mm","confidence":88,"bbox":[0.1,0.2,0.5,0.4]}' } }] };

// ---------- 網址 ----------
test('網址正規化：空的用預設、沒有 http:// 就補、結尾斜線去掉', () => {
  assert.equal(normalizeBaseUrl(''), DEFAULT_BASE_URL);
  assert.equal(normalizeBaseUrl('  '), DEFAULT_BASE_URL);
  assert.equal(normalizeBaseUrl('127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:8080///'), 'http://127.0.0.1:8080');
  assert.equal(normalizeBaseUrl('https://box.lan:9000/'), 'https://box.lan:9000');
});

// ---------- 型號清單 ----------
test('型號清單：打 /v1/models，把 data 轉成可用清單', async () => {
  const f = fakeFetch(200, { data: [{ id: 'Qwen3.8-27B-UD-IQ4_XS.gguf' }] });
  const models = await listLocalModels({ baseUrl: '127.0.0.1:8080', fetchFn: f });
  assert.equal(f.calls[0].url, 'http://127.0.0.1:8080/v1/models');
  assert.deepEqual(models, [{ id: 'Qwen3.8-27B-UD-IQ4_XS.gguf', label: 'Qwen3.8-27B-UD-IQ4_XS.gguf', usable: true }]);
});

test('型號清單：伺服器沒回報模型要大聲失敗（多半是還在載入）', async () => {
  await assert.rejects(listLocalModels({ fetchFn: fakeFetch(200, { data: [] }) }), /還在載入/);
});

// ---------- 連線失敗的訊息 ----------
test('連不上：訊息要直接講「伺服器沒開、去跑 start.bat」，不要只丟 fetch 的原文', async () => {
  const boom = async () => {
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(listLocalModels({ fetchFn: boom }), (e) => {
    assert.match(e.message, /連不上本機模型伺服器 http:\/\/127\.0\.0\.1:8080/);
    assert.match(e.message, /start\.bat/);
    return true;
  });
});

test('HTTP 錯誤與非 JSON 回應都要大聲失敗', async () => {
  await assert.rejects(localChat({ model: 'm', text: 'x', fetchFn: fakeFetch(500, { error: { message: '爆了' } }) }), /HTTP 500.*爆了/);
  await assert.rejects(localChat({ model: 'm', text: 'x', fetchFn: fakeFetch(200, '<html>') }), /不是 JSON/);
  await assert.rejects(localChat({ model: 'm', text: 'x', fetchFn: fakeFetch(200, { choices: [] }) }), /沒有文字/);
});

// ---------- 對話 ----------
test('對話：OpenAI 相容格式，照片包成 data URL，不帶任何金鑰標頭', async () => {
  const f = fakeFetch(200, CHAT_OK);
  await localChat({ baseUrl: 'http://127.0.0.1:8080', model: 'qwen', text: '看白板', image: { data: 'QUJD', mimeType: 'image/jpeg' }, fetchFn: f });
  const c = f.calls[0];
  assert.equal(c.url, 'http://127.0.0.1:8080/v1/chat/completions');
  assert.deepEqual(Object.keys(c.init.headers), ['content-type']);
  const content = c.body.messages[0].content;
  assert.equal(content[0].text, '看白板');
  assert.equal(content[1].image_url.url, 'data:image/jpeg;base64,QUJD');
  assert.equal(c.body.stream, false);
});

test('對話：沒選型號要先擋下來，不要打出去', async () => {
  const f = fakeFetch(200, CHAT_OK);
  await assert.rejects(localChat({ model: '', text: 'x', fetchFn: f }), /沒有指定本機模型的型號/);
  assert.equal(f.calls.length, 0);
});

test('測試連線：只送文字，不帶圖', async () => {
  const f = fakeFetch(200, { choices: [{ message: { content: 'OK' } }] });
  assert.equal(await testLocalConnection({ model: 'qwen', fetchFn: f }), 'OK');
  assert.equal(f.calls[0].body.messages[0].content.length, 1);
});

// ---------- 設定保存 ----------
test('設定：沒存過給預設；存了再讀回來一樣；網址順手正規化', () => {
  const s = new FakeStorage();
  assert.deepEqual(loadLocalSettings(s), { baseUrl: DEFAULT_BASE_URL, model: '' });
  saveLocalSettings({ baseUrl: '127.0.0.1:9999/', model: ' qwen ' }, s);
  assert.deepEqual(loadLocalSettings(s), { baseUrl: 'http://127.0.0.1:9999', model: 'qwen' });
  assert.equal(JSON.parse(s.getItem(LOCAL_STORAGE_KEY)).model, 'qwen');
});

test('設定：存進去的是壞資料也不能炸，退回預設', () => {
  const s = new FakeStorage();
  s.setItem(LOCAL_STORAGE_KEY, '{壞掉的');
  assert.deepEqual(loadLocalSettings(s), { baseUrl: DEFAULT_BASE_URL, model: '' });
});

// ---------- 辨識器 ----------
const encode = async () => ({ data: 'QUJD', mimeType: 'image/jpeg' });

test('辨識器：把三欄與 bbox 解析出來，並照 ctx.local 打到那台伺服器', async () => {
  const f = fakeFetch(200, CHAT_OK);
  const rec = createLocalRecognizer({ encode, fetchFn: f });
  assert.equal(rec.id, 'local');
  assert.equal(rec.available, true);
  const r = await rec.recognize(new File([''], 'a.jpg'), { local: { baseUrl: 'http://127.0.0.1:8080', model: 'qwen' }, prompt: '' });
  assert.equal(r.desc, '輕隔間 1107梯廳');
  assert.equal(r.design, '1100mm±10');
  assert.equal(r.actual, '1100mm');
  assert.equal(r.confidence, 88);
  assert.deepEqual(r.bbox, { x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
  assert.equal(f.calls[0].url, 'http://127.0.0.1:8080/v1/chat/completions');
  assert.equal(f.calls[0].body.model, 'qwen');
});

test('辨識器：沒設定型號就大聲失敗，不要靜靜送出去', async () => {
  const f = fakeFetch(200, CHAT_OK);
  const rec = createLocalRecognizer({ encode, fetchFn: f });
  await assert.rejects(rec.recognize(new File([''], 'a.jpg'), {}), /沒有選本機模型的型號/);
  assert.equal(f.calls.length, 0);
});

test('辨識器：使用者自己改過的提示詞要蓋掉預設', async () => {
  const f = fakeFetch(200, CHAT_OK);
  const rec = createLocalRecognizer({ encode, fetchFn: f });
  await rec.recognize(new File([''], 'a.jpg'), { local: { model: 'qwen' }, prompt: '白板在左下角' });
  assert.match(f.calls[0].body.messages[0].content[0].text, /白板在左下角/);
});
