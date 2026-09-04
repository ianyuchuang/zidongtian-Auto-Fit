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
  lineParts,
  makeLine,
  usedFields,
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

test('lineParts：舊格式 {label, field} 等於「一段文字＋一個欄位」', () => {
  assert.deepEqual(lineParts({ label: '說明：', field: 'desc' }), [{ text: '說明：' }, { field: 'desc' }]);
  assert.deepEqual(lineParts({ label: '', field: 'desc' }), [{ field: 'desc' }]);
  assert.deepEqual(lineParts({ label: '', field: null }), [{ field: null }]);
  const parts = [{ field: 'desc' }, { text: '，' }, { field: 'design' }];
  assert.deepEqual(lineParts({ parts }), parts);
});

test('cellText：同一行放多個欄位，用打的字隔開（空值照原樣印，逗號不會自己消失）', () => {
  const cell = {
    kind: 'text',
    lines: [{ parts: [{ field: 'desc' }, { text: '，' }, { field: 'design' }, { text: '，' }, { field: 'actual' }] }],
  };
  assert.deepEqual(cellText(cell, { desc: '輕隔間 1107梯廳', design: '555x450cm', actual: '555x450cm' }), [
    '輕隔間 1107梯廳，555x450cm，555x450cm',
  ]);
  assert.deepEqual(cellText(cell, { desc: '輕隔間 1107梯廳' }), ['輕隔間 1107梯廳，，']);
});

test('段落內換行（Shift+Enter）：cellText 給出 \\n，不會被當成沒指定欄位', () => {
  const cell = { kind: 'text', lines: [{ parts: [{ field: 'desc' }, { br: true }, { field: 'design' }] }] };
  assert.deepEqual(cellText(cell, { desc: '甲', design: '乙' }), ['甲\n乙']);
  // 瀏覽器也可能直接把換行存成文字裡的 \n，結果要一樣
  const asText = { kind: 'text', lines: [{ parts: [{ field: 'desc' }, { text: '\n' }, { field: 'design' }] }] };
  assert.deepEqual(cellText(asText, { desc: '甲', design: '乙' }), ['甲\n乙']);
  const s = defaultSpec();
  s.block.rows[1].cells[0].lines = cell.lines;
  assert.deepEqual(validateSpec(s), []);
  assert.deepEqual(makeLine([{ field: 'desc' }, { br: true }, { text: '' }, { field: 'design' }]), {
    parts: [{ field: 'desc' }, { br: true }, { field: 'design' }],
  });
});

test('makeLine：相鄰文字併起來、空文字丟掉；簡單的一行存回舊格式', () => {
  assert.deepEqual(makeLine([{ text: '說明：' }, { text: '' }, { field: 'desc' }]), { label: '說明：', field: 'desc' });
  assert.deepEqual(makeLine([{ field: 'desc' }]), { label: '', field: 'desc' });
  assert.deepEqual(makeLine([{ text: '說明：' }]), { label: '說明：', field: 'none' });
  assert.deepEqual(makeLine([]), { label: '', field: 'none' }); // 空白段落，不是「還沒指定」
  // 欄位膠囊選「（留空）」＝移除它，只留旁邊打的字
  assert.deepEqual(makeLine([{ text: '說明：' }, { field: 'none' }]), { label: '說明：', field: 'none' });
  assert.deepEqual(makeLine([{ field: 'desc' }, { text: '，' }, { field: 'none' }]), {
    parts: [{ field: 'desc' }, { text: '，' }],
  });
  assert.deepEqual(makeLine([{ field: 'desc' }, { text: '，' }, { text: '' }, { field: 'design' }]), {
    parts: [{ field: 'desc' }, { text: '，' }, { field: 'design' }],
  });
});

test('多欄位的一行：欄位沒指定要擋下來，usedFields 也要看得到', () => {
  const s = defaultSpec();
  s.block.rows[1].cells[0].lines = [{ parts: [{ field: 'desc' }, { text: '，' }, { field: 'design' }] }];
  assert.deepEqual(validateSpec(s), []);
  assert.deepEqual([...usedFields(s)].sort(), ['desc', 'design']);
  s.block.rows[1].cells[0].lines = [{ parts: [{ field: 'desc' }, { text: '，' }, { field: null }] }];
  assert.match(validateSpec(s)[0], /1 個說明格還沒指定欄位/);
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

test('addLine / removeLine：說明欄位可以加、可以刪；照片格不收', async () => {
  const { addLine, removeLine } = await import('../../web/js/template/spec.js');
  const s = defaultSpec();
  const cell = s.block.rows[1].cells[0];
  assert.equal(addLine(s, 1, 0, { label: '', field: 'seq' }), true);
  assert.deepEqual(cell.lines.map((l) => l.field), ['desc', 'design', 'actual', 'seq']);
  assert.equal(addLine(s, 1, 0, { label: '', field: 'photoDate' }, 0), true);
  assert.deepEqual(cell.lines.map((l) => l.field), ['photoDate', 'desc', 'design', 'actual', 'seq']);
  assert.equal(addLine(s, 0, 0, { label: '', field: 'desc' }), false); // 照片格
  assert.equal(removeLine(s, 1, 0, 0), true);
  assert.deepEqual(cell.lines.map((l) => l.field), ['desc', 'design', 'actual', 'seq']);
  assert.equal(removeLine(s, 1, 0, 99), false);
});

test('moveLine：同一格換位置、搬到別格、搬不進照片格就不動', async () => {
  const { moveLine } = await import('../../web/js/template/spec.js');
  const s = defaultSpec();
  const lines = () => s.block.rows[1].cells[0].lines.map((l) => l.field);

  moveLine(s, { r: 1, c: 0, i: 0 }, { r: 1, c: 0, index: 2 }); // desc 往後搬到中間
  assert.deepEqual(lines(), ['design', 'desc', 'actual']);
  moveLine(s, { r: 1, c: 0, i: 2 }, { r: 1, c: 0, index: 0 }); // actual 搬到最前面
  assert.deepEqual(lines(), ['actual', 'design', 'desc']);

  // 搬到照片格：不動
  assert.equal(moveLine(s, { r: 1, c: 0, i: 0 }, { r: 0, c: 0 }), false);
  assert.deepEqual(lines(), ['actual', 'design', 'desc']);

  // 搬到另一個說明格
  s.block.rows[1].cells.push({ kind: 'text', col: 0, lines: [] });
  moveLine(s, { r: 1, c: 0, i: 0 }, { r: 1, c: 1 });
  assert.deepEqual(lines(), ['design', 'desc']);
  assert.deepEqual(s.block.rows[1].cells[1].lines.map((l) => l.field), ['actual']);
});

test('validateSpec：每列張數／每頁列數要正整數、照片框不能是 0', () => {
  const s = defaultSpec();
  s.grid.perRow = 2.5;
  assert.match(validateSpec(s).join(), /每列張數/);
  s.grid.perRow = 2;
  s.grid.blockRows = 0;
  assert.match(validateSpec(s).join(), /每頁列數/);
  s.grid.blockRows = 3;
  s.photo.h = 0;
  assert.match(validateSpec(s).join(), /照片框/);
  s.photo.h = 100;
  s.photo.maxW = NaN;
  assert.match(validateSpec(s).join(), /照片框/);
});
