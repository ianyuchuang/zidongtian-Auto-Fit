// 對話框的純判斷（不碰 DOM）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeCloses, esc, enterTriggersPrimary, needsDefaultFocus } from '../../web/js/ui/dialog.js';

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

test('Enter：焦點在按鈕上時不搶著當「主要按鈕」（回歸：Tab 到「取消」按 Enter 卻變成確定）；textarea 裡是換行', () => {
  const button = { tagName: 'BUTTON', closest: (sel) => (sel === 'button' ? button : null) };
  const spanInButton = { tagName: 'SPAN', closest: (sel) => (sel === 'button' ? button : null) };
  const input = { tagName: 'INPUT', closest: () => null };
  const textarea = { tagName: 'TEXTAREA', closest: () => null };
  assert.equal(enterTriggersPrimary(button), false);
  assert.equal(enterTriggersPrimary(spanInButton), false, '按鈕裡的文字節點也算按鈕');
  assert.equal(enterTriggersPrimary(textarea), false);
  assert.equal(enterTriggersPrimary(input), true);
  assert.equal(enterTriggersPrimary({ tagName: 'BODY' }), true, '沒有 closest 的目標（例如 document）照舊當主要按鈕');
  assert.equal(enterTriggersPrimary(null), true);
});

test('預設焦點：onOpen 已經把焦點放進對話框就不再蓋掉；焦點在外面或沒有才用第一個欄位', () => {
  const inside = {};
  const overlay = { contains: (el) => el === inside };
  assert.equal(needsDefaultFocus(overlay, inside), false);
  assert.equal(needsDefaultFocus(overlay, {}), true, '焦點在對話框外面（例如 body）');
  assert.equal(needsDefaultFocus(overlay, null), true);
});
