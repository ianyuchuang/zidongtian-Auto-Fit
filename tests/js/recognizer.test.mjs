import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECOGNIZERS, getRecognizer, DEFAULT_PROMPT } from '../../web/js/recognizer/index.js';

test('登錄表：模擬版、本地模型、LLM API 三種都可用', () => {
  assert.deepEqual(RECOGNIZERS.map((r) => r.id), ['mock', 'local', 'api']);
  for (const r of RECOGNIZERS) assert.equal(r.available, true, r.id);
  assert.ok(DEFAULT_PROMPT.length > 0);
  assert.throws(() => getRecognizer('nope'), /沒有這個辨識方式/);
});

// 本地模型是本機 llama-server，不是 Hugging Face；選項名稱要跟實際接的東西一致，
// 而且要講明照片不出這台電腦（需求 1）。細節測試在 local.test.mjs。
test('本地模型：名稱講清楚是本機 llama.cpp、照片不離開這台電腦', () => {
  const r = getRecognizer('local');
  assert.match(r.label, /本地模型/);
  assert.match(r.label, /llama\.cpp/);
  assert.match(r.label, /不離開這台電腦/);
  assert.doesNotMatch(r.label, /Hugging Face/);
});

test('模擬辨識：同檔名結果固定、信心 55–95、有 bbox', async () => {
  const f = new File(['x'], '203662_0.jpg');
  const r1 = await getRecognizer('mock').recognize(f, { delayMs: 0, folderName: '5F' });
  const r2 = await getRecognizer('mock').recognize(f, { delayMs: 0, folderName: '5F' });
  assert.deepEqual(r1, r2);
  assert.ok(r1.desc.startsWith('5F'));
  assert.ok(r1.confidence >= 55 && r1.confidence <= 95);
  for (const k of ['x', 'y', 'w', 'h']) assert.ok(r1.bbox[k] >= 0 && r1.bbox[k] <= 1);
});
