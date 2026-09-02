import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT, fitPhoto, captionLines, outputFileName, pairRows, planExport, exportWarnings } from '../../web/js/docx-model.js';

test('版面常數對應 V1.0 的 EMU 值', () => {
  assert.equal(LAYOUT.pageW, 11906);
  assert.equal(LAYOUT.pageH, 16838);
  assert.equal(LAYOUT.marginL, 1134);
  assert.equal(LAYOUT.marginT, 709);
  assert.equal(LAYOUT.cellW, 4915);
  assert.equal(LAYOUT.photoRowH, 3798);
  assert.ok(Math.abs(LAYOUT.photoH - 234.33) < 0.01);
  assert.ok(Math.abs(LAYOUT.photoMaxW - 312.39) < 0.01);
});

test('fitPhoto：一般 4:3 照片高度固定', () => {
  const s = fitPhoto(1476, 1109);
  assert.ok(Math.abs(s.height - 234.33) < 0.01);
  assert.ok(Math.abs(s.width - 311.9) < 0.1);
});

test('fitPhoto：太寬的照片改以最大寬度為準', () => {
  const s = fitPhoto(2000, 1000);
  assert.ok(Math.abs(s.width - 312.39) < 0.01);
  assert.ok(Math.abs(s.height - 156.2) < 0.1);
});

test('fitPhoto：尺寸不合法要丟錯', () => {
  assert.throws(() => fitPhoto(0, 10), /不合法/);
});

test('captionLines 與 V1.0 文字相同', () => {
  assert.deepEqual(captionLines({ desc: 'X', design: '700mm±10', actual: '700mm' }), [
    '內容說明：X',
    '設    計：700mm±10',
    '實    際：700mm',
  ]);
});

test('outputFileName', () => {
  assert.equal(outputFileName('1150725', '4F'), '1150725 4F.docx');
  assert.equal(outputFileName('1150725', '4F', '_new'), '1150725 4F_new.docx');
});

test('pairRows：兩張一列', () => {
  assert.deepEqual(pairRows([1, 2, 3]), [[1, 2], [3]]);
  assert.deepEqual(pairRows([]), []);
});

test('planExport：每資料夾一組、依 dirs 順序、空內容說明略過', () => {
  const dirs = [
    { path: '', name: '帷幕骨架' },
    { path: '4F', name: '4F' },
    { path: '5F', name: '5F' },
  ];
  const photos = [
    { id: 'c', dir: '5F', desc: 'c', status: 'ai' },
    { id: 'a', dir: '4F', desc: 'a', status: 'parsed' },
    { id: 'x', dir: '4F', desc: '   ', status: 'ai' },
  ];
  const { groups, skipped } = planExport(photos, dirs);
  assert.deepEqual(
    groups.map((g) => [g.folderName, g.photos.map((p) => p.id)]),
    [
      ['4F', ['a']],
      ['5F', ['c']],
    ],
  );
  assert.deepEqual(skipped.map((p) => p.id), ['x']);
  const w = exportWarnings(photos);
  assert.equal(w.length, 2);
  assert.match(w[0], /2 張 AI/);
  assert.match(w[1], /1 張內容說明為空/);
});
