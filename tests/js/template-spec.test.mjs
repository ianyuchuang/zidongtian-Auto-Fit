import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSpec,
  fitPhoto,
  tableCols,
  blockWidth,
  perPage,
  slotOrder,
  swapSlots,
  layoutPages,
  cellText,
  validateSpec,
} from '../../web/js/template/spec.js';

test('預設版型對應 V1.0 的 EMU 值', () => {
  const s = defaultSpec();
  assert.equal(s.page.w, 11906);
  assert.equal(s.page.h, 16838);
  assert.equal(s.page.margin.l, 1134);
  assert.equal(s.page.margin.t, 709);
  assert.deepEqual(tableCols(s), [4915, 4915]);
  assert.equal(blockWidth(s), 4915);
  assert.equal(s.block.rows[0].h, 3798);
  assert.ok(Math.abs(s.photo.h - 234.33) < 0.01);
  assert.ok(Math.abs(s.photo.maxW - 312.39) < 0.01);
  assert.equal(perPage(s), 6);
});

test('fitPhoto：一般 4:3 照片高度固定', () => {
  const s = fitPhoto(defaultSpec(), 1476, 1109);
  assert.ok(Math.abs(s.height - 234.33) < 0.01);
  assert.ok(Math.abs(s.width - 311.9) < 0.1);
});

test('fitPhoto：太寬的照片改以最大寬度為準', () => {
  const s = fitPhoto(defaultSpec(), 2000, 1000);
  assert.ok(Math.abs(s.width - 312.39) < 0.01);
  assert.ok(Math.abs(s.height - 156.2) < 0.1);
});

test('fitPhoto：尺寸不合法要丟錯', () => {
  assert.throws(() => fitPhoto(defaultSpec(), 0, 10), /不合法/);
});

test('說明欄文字與 V1.0 相同', () => {
  const spec = defaultSpec();
  const cell = spec.block.rows[1].cells[0];
  assert.deepEqual(cellText(cell, { desc: 'X', design: '700mm±10', actual: '700mm' }), [
    '內容說明：X',
    '設    計：700mm±10',
    '實    際：700mm',
  ]);
});

test('cellText：照片編號與拍照日期由 ctx 帶入，未對應的欄位留空', () => {
  const cell = {
    kind: 'text',
    lines: [{ label: '編號：', field: 'seq' }, { label: '日期：', field: 'photoDate' }, { label: '（略）', field: 'none' }],
  };
  assert.deepEqual(cellText(cell, {}, { seq: 3, photoDate: '112.06.29' }), ['編號：3', '日期：112.06.29', '（略）']);
  assert.deepEqual(cellText(cell, {}, {}), ['編號：', '日期：', '（略）']);
});

test('填入順序：由左至右 vs 由上而下', () => {
  const s = defaultSpec(); // 3 列 × 2 張
  assert.deepEqual(slotOrder(s), [0, 1, 2, 3, 4, 5]);
  s.grid.order = 'col';
  assert.deepEqual(slotOrder(s), [0, 2, 4, 1, 3, 5]);
});

test('填入順序：grid.seq 覆蓋 order（預覽頁拖曳交換）', () => {
  const s = defaultSpec();
  s.grid.seq = [5, 4, 3, 2, 1, 0];
  assert.deepEqual(slotOrder(s), [5, 4, 3, 2, 1, 0]);
  s.grid.seq = [1, 0]; // 長度不符就當作沒設定
  assert.deepEqual(slotOrder(s), [0, 1, 2, 3, 4, 5]);
});

test('layoutPages：與 V1.0 一樣兩張一列，最後整列空的不印', () => {
  const s = defaultSpec();
  const [a, b, c] = ['a', 'b', 'c'];
  assert.deepEqual(layoutPages(s, [a, b, c]), [[['a', 'b'], ['c', null]]]);
  assert.deepEqual(layoutPages(s, []), []);
});

test('layoutPages：由上而下填、跨頁', () => {
  const s = defaultSpec();
  s.grid.order = 'col';
  const p = [1, 2, 3, 4, 5, 6, 7];
  assert.deepEqual(layoutPages(s, p), [
    [
      [1, 4],
      [2, 5],
      [3, 6],
    ],
    [[7, null]],
  ]);
});

test('swapSlots：交換兩格的填入順序', () => {
  const s = defaultSpec();
  swapSlots(s, 0, 5);
  assert.deepEqual(s.grid.seq, [5, 1, 2, 3, 4, 0]);
  assert.deepEqual(layoutPages(s, ['a', 'b']), [[[null, 'b'], [null, null], [null, 'a']]]);
  swapSlots(s, 5, 0); // 換回來
  assert.deepEqual(s.grid.seq, [0, 1, 2, 3, 4, 5]);
});

test('validateSpec：說明格沒指定欄位要擋下來', () => {
  const s = defaultSpec();
  s.block.rows[1].cells[0].lines[0].field = null;
  assert.match(validateSpec(s).join(), /還沒指定欄位/);
});

test('validateSpec：預設版型沒問題；壞掉的要講出哪裡壞', () => {
  assert.deepEqual(validateSpec(defaultSpec()), []);
  const s = defaultSpec();
  s.block.rows[0].cells = [];
  assert.match(validateSpec(s).join(), /照片格/);
  const t = defaultSpec();
  t.unknown = ['每頁列數'];
  assert.match(validateSpec(t).join(), /沒解析出來/);
});
