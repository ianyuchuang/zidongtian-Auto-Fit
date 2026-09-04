// 對話框的純判斷（不碰 DOM）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeCloses, esc } from '../../web/js/ui/dialog.js';

test('Esc：有按鈕的一般對話框可以關；沒有按鈕的進度視窗不能關（回歸 W6）', () => {
  assert.equal(escapeCloses({ buttons: [{ label: '確定', value: true }] }), true);
  assert.equal(escapeCloses({ buttons: [] }), false);
  assert.equal(escapeCloses({}), false);
});

test('Esc：dismissable 明講就照明講的（辨識進度有「停止辨識」鈕仍不准 Esc 關）', () => {
  assert.equal(escapeCloses({ buttons: [{ label: '停止辨識', value: 'stop' }], dismissable: false }), false);
  assert.equal(escapeCloses({ buttons: [], dismissable: true }), true);
});

test('esc：跳脫 HTML 特殊字元', () => {
  assert.equal(esc(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
});
