import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECOGNIZERS, getRecognizer, DEFAULT_PROMPT } from '../../web/js/recognizer/index.js';

test('登錄表：模擬版可用，本地模型與 API 明確標示未接', () => {
  assert.equal(getRecognizer('mock').available, true);
  assert.equal(getRecognizer('local').available, false);
  assert.equal(getRecognizer('api').available, false);
  assert.equal(RECOGNIZERS.length, 3);
  assert.ok(DEFAULT_PROMPT.length > 0);
  assert.throws(() => getRecognizer('nope'), /沒有這個辨識方式/);
});

test('未接的辨識器呼叫要大聲失敗', async () => {
  await assert.rejects(getRecognizer('local').recognize(new File([], 'a.jpg')), /尚未實作/);
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
