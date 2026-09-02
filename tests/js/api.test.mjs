import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, getProvider } from '../../web/js/recognizer/api/providers.js';
import { loadApiKeys, saveApiKeys, clearApiKeys, KEYS_STORAGE_KEY } from '../../web/js/recognizer/api/keys.js';
import { buildRequest, callLLM, testConnection, errorMessage, hasAdapter } from '../../web/js/recognizer/api/call.js';
import { buildPrompt, parseResult } from '../../web/js/recognizer/api/prompt.js';
import { createApiRecognizer } from '../../web/js/recognizer/api.js';

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
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  fn.calls = calls;
  return fn;
};

// ---------- providers ----------
test('四家供應商都有申請與教學連結；Claude/Gemini/GPT 已接、Grok 待接', () => {
  assert.deepEqual(
    PROVIDERS.map((p) => p.id),
    ['claude', 'gemini', 'openai', 'grok'],
  );
  for (const p of PROVIDERS) {
    assert.match(p.apply, /^https:\/\//);
    assert.match(p.guide, /^https:\/\//);
    assert.equal(hasAdapter(p.id), p.available, p.id);
    assert.ok(Array.isArray(p.steps) && p.steps.length >= 3, `${p.id} 要有申請教學步驟`);
    assert.ok(p.billing, `${p.id} 要說明付費方式`);
    if (p.available) assert.ok(p.model, `${p.id} 要有預設型號`);
  }
  assert.equal(getProvider('claude').model, 'claude-haiku-4-5-20251001');
  assert.throws(() => getProvider('nope'), /沒有這家/);
});

// ---------- keys ----------
test('金鑰：記住 → 存進去；不記住 → 只存旗標，金鑰不落地', () => {
  const st = new FakeStorage();
  assert.deepEqual(loadApiKeys(st), { provider: null, remember: true, keys: {} });
  saveApiKeys({ provider: 'claude', remember: true, keys: { claude: ' sk-ant-x ', gemini: '' } }, st);
  assert.deepEqual(loadApiKeys(st), { provider: 'claude', remember: true, keys: { claude: 'sk-ant-x' } });
  saveApiKeys({ provider: 'claude', remember: false, keys: { claude: 'sk-ant-x' } }, st);
  assert.deepEqual(loadApiKeys(st), { provider: 'claude', remember: false, keys: {} });
  assert.ok(!st.getItem(KEYS_STORAGE_KEY).includes('sk-ant'));
  clearApiKeys(st);
  assert.equal(st.getItem(KEYS_STORAGE_KEY), null);
});

test('金鑰：壞掉的 JSON 不炸，回空設定', () => {
  const st = new FakeStorage();
  st.setItem(KEYS_STORAGE_KEY, '{oops');
  assert.deepEqual(loadApiKeys(st), { provider: null, remember: true, keys: {} });
});

// ---------- request 格式 ----------
const img = { data: 'QUJD', mimeType: 'image/jpeg' };

test('Claude request：端點、三個 header、瀏覽器直打 header、base64 圖', () => {
  const r = buildRequest('claude', { apiKey: 'K', model: 'claude-haiku-4-5', text: 'hi', image: img });
  assert.equal(r.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(r.headers['x-api-key'], 'K');
  assert.equal(r.headers['anthropic-version'], '2023-06-01');
  assert.equal(r.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(r.body.model, 'claude-haiku-4-5');
  assert.equal(r.body.max_tokens, 1024);
  const c = r.body.messages[0].content;
  assert.deepEqual(c[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } });
  assert.deepEqual(c[1], { type: 'text', text: 'hi' });
});

test('Gemini request：型號進 URL、x-goog-api-key、inline_data', () => {
  const r = buildRequest('gemini', { apiKey: 'G', model: 'gemini-3.7-flash', text: 'hi', image: img, maxTokens: 99 });
  assert.equal(r.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent');
  assert.equal(r.headers['x-goog-api-key'], 'G');
  assert.deepEqual(r.body.contents[0].parts, [{ inline_data: { mime_type: 'image/jpeg', data: 'QUJD' } }, { text: 'hi' }]);
  assert.equal(r.body.generationConfig.maxOutputTokens, 99);
});

test('OpenAI request：Bearer、data URL 圖、max_completion_tokens；純文字時沒有圖', () => {
  const r = buildRequest('openai', { apiKey: 'O', model: 'gpt-5.6-terra', text: 'hi', image: img });
  assert.equal(r.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(r.headers.Authorization, 'Bearer O');
  assert.equal(r.body.max_completion_tokens, 1024);
  assert.deepEqual(r.body.messages[0].content[1], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } });
  const t = buildRequest('openai', { apiKey: 'O', model: 'm', text: 'hi', image: null });
  assert.equal(t.body.messages[0].content.length, 1);
});

test('request：沒金鑰、沒型號、未接的供應商都大聲失敗', () => {
  assert.throws(() => buildRequest('claude', { apiKey: '', model: 'm', text: 'x' }), /沒有 API 金鑰/);
  assert.throws(() => buildRequest('claude', { apiKey: 'k', model: '', text: 'x' }), /沒有指定型號/);
  assert.throws(() => buildRequest('grok', { apiKey: 'k', model: 'm', text: 'x' }), /尚未接上/);
});

// ---------- callLLM：回應抽字與錯誤 ----------
test('callLLM：三家的回應格式都抽得出文字', async () => {
  const cases = [
    ['claude', { content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] }, 'AB'],
    ['gemini', { candidates: [{ content: { parts: [{ text: 'G' }] } }] }, 'G'],
    ['openai', { choices: [{ message: { content: 'O' } }] }, 'O'],
  ];
  for (const [id, body, want] of cases) {
    const f = fakeFetch(200, body);
    const text = await callLLM(id, { apiKey: 'k', model: 'm', text: 'hi', fetchFn: f });
    assert.equal(text, want, id);
    assert.equal(f.calls[0].init.method, 'POST');
    assert.equal(f.calls[0].init.headers['content-type'], 'application/json');
  }
});

test('callLLM：HTTP 錯誤帶出供應商訊息與提示；非 JSON 回應也報錯', async () => {
  const f401 = fakeFetch(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } });
  await assert.rejects(callLLM('claude', { apiKey: 'bad', model: 'm', text: 'hi', fetchFn: f401 }), /HTTP 401（金鑰錯誤或沒有權限）：invalid x-api-key/);
  const f429 = fakeFetch(429, { error: { message: 'quota' } });
  await assert.rejects(callLLM('gemini', { apiKey: 'k', model: 'm', text: 'hi', fetchFn: f429 }), /429（用量／額度超過/);
  const fHtml = fakeFetch(200, '<html>oops</html>');
  await assert.rejects(callLLM('openai', { apiKey: 'k', model: 'm', text: 'hi', fetchFn: fHtml }), /不是 JSON/);
  const fEmpty = fakeFetch(200, { choices: [] });
  await assert.rejects(callLLM('openai', { apiKey: 'k', model: 'm', text: 'hi', fetchFn: fEmpty }), /沒有文字/);
  assert.match(errorMessage(500, null, 'boom'), /HTTP 500：boom/);
});

test('callLLM：fetch 丟例外（CORS／斷網）要說清楚', async () => {
  const f = async () => {
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(callLLM('claude', { apiKey: 'k', model: 'm', text: 'hi', fetchFn: f }), /連線失敗：Failed to fetch/);
});

test('testConnection：純文字小請求，回模型文字', async () => {
  const f = fakeFetch(200, { content: [{ type: 'text', text: 'OK' }] });
  assert.equal(await testConnection('claude', { apiKey: 'k', model: 'm', fetchFn: f }), 'OK');
  assert.equal(f.calls[0].body.max_tokens, 64);
  assert.equal(f.calls[0].body.messages[0].content.length, 1);
});

// ---------- prompt / parse ----------
test('buildPrompt：使用者提示詞優先，空的用預設；含輸出格式說明', () => {
  assert.match(buildPrompt('  ', '預設'), /預設/);
  assert.match(buildPrompt('自訂', '預設'), /自訂/);
  assert.doesNotMatch(buildPrompt('自訂', '預設'), /預設/);
  assert.match(buildPrompt('', 'x'), /"confidence"/);
});

test('parseResult：去 markdown 圍欄、夾雜文字、bbox 正規化、confidence 夾在 0–100', () => {
  const r = parseResult('好的：\n```json\n{"desc":"4F帷幕骨架水平間距","design":"700mm±10","actual":"700mm","confidence":88.4,"bbox":[0.2,0.3,0.5,0.4]}\n```');
  assert.deepEqual(r, { desc: '4F帷幕骨架水平間距', design: '700mm±10', actual: '700mm', confidence: 88, bbox: { x: 0.2, y: 0.3, w: 0.5, h: 0.4 } });
  assert.equal(parseResult('{"desc":"a","confidence":250}').confidence, 100);
  assert.equal(parseResult('{"desc":"a","confidence":"abc"}').confidence, 0);
  assert.equal(parseResult('{"desc":"a","bbox":null}').bbox, null);
  assert.equal(parseResult('{"desc":"a","bbox":[0.9,0.9,0.5,0.5]}').bbox, null, '超出圖外的 bbox 丟掉');
  assert.deepEqual(parseResult('{"desc":"a","bbox":{"x":0.1,"y":0.1,"w":0.2,"h":0.2}}').bbox, { x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
  assert.equal(parseResult('{"desc":null,"design":123}').design, '123');
});

test('parseResult：沒有 JSON、壞 JSON、三欄全空 → 大聲失敗', () => {
  assert.throws(() => parseResult('我看不到白板'), /找不到 JSON/);
  assert.throws(() => parseResult('{"desc": "a",}'), /解析失敗/);
  assert.throws(() => parseResult('{"desc":"","design":"","actual":""}'), /沒讀到任何欄位/);
});

// ---------- 辨識器整合 ----------
test('apiRecognizer：縮圖 → 呼叫 → 解析；沒選供應商／沒金鑰／Grok 都擋下', async () => {
  const f = fakeFetch(200, { content: [{ type: 'text', text: '{"desc":"5F水平","design":"1100mm±10","actual":"1100mm","confidence":90}' }] });
  const encode = async (file, maxSide) => ({ data: 'QUJD', mimeType: 'image/jpeg', maxSide, name: file.name });
  const rec = createApiRecognizer({ encode, fetchFn: f });
  assert.equal(rec.id, 'api');
  assert.equal(rec.available, true);
  const file = new File(['x'], '203662_0.jpg');
  const r = await rec.recognize(file, { prompt: '', api: { provider: 'claude', apiKey: 'k' } });
  assert.equal(r.desc, '5F水平');
  assert.equal(r.confidence, 90);
  assert.equal(r.bbox, null);
  assert.equal(f.calls[0].body.model, 'claude-haiku-4-5-20251001', '沒指定型號用供應商預設');
  assert.equal(f.calls[0].body.messages[0].content[0].source.data, 'QUJD');
  assert.match(f.calls[0].body.messages[0].content[1].text, /白板/);

  await assert.rejects(rec.recognize(file, {}), /沒有選 LLM API/);
  await assert.rejects(rec.recognize(file, { api: { provider: 'claude', apiKey: '' } }), /沒有填/);
  await assert.rejects(rec.recognize(file, { api: { provider: 'grok', apiKey: 'k' } }), /尚未接上/);
  await assert.rejects(rec.recognize(file, { api: { provider: 'nope', apiKey: 'k' } }), /沒有這家/);
});

test('apiRecognizer：可指定型號覆蓋預設', async () => {
  const f = fakeFetch(200, { choices: [{ message: { content: '{"desc":"a","design":"b","actual":"c","confidence":70}' } }] });
  const rec = createApiRecognizer({ encode: async () => ({ data: 'QUJD', mimeType: 'image/jpeg' }), fetchFn: f });
  await rec.recognize(new File(['x'], 'a.jpg'), { api: { provider: 'openai', apiKey: 'k', model: 'gpt-5.6-luna' } });
  assert.equal(f.calls[0].body.model, 'gpt-5.6-luna');
});
