import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outputFileName, planExport, exportWarnings } from '../../web/js/docx-model.js';

test('outputFileName', () => {
  assert.equal(outputFileName('1150725', '4F'), '1150725 4F.docx');
  assert.equal(outputFileName('1150725', '4F', '_new'), '1150725 4F_new.docx');
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

test('planExport / exportWarnings：回收桶裡的照片不輸出、不計入提醒', () => {
  const dirs = [
    { path: '', name: '帷幕骨架' },
    { path: '4F', name: '4F' },
    { path: '_回收桶', name: '_回收桶' },
  ];
  const photos = [
    { id: 'a', dir: '4F', desc: 'a', status: 'parsed' },
    { id: 't', dir: '_回收桶', desc: 't', status: 'ai' },
    { id: 'u', dir: '_回收桶', desc: '', status: 'pending' },
  ];
  const { groups, skipped, trashed } = planExport(photos, dirs);
  assert.deepEqual(groups.map((g) => [g.folderName, g.photos.map((p) => p.id)]), [['4F', ['a']]]);
  assert.deepEqual(skipped, []);
  assert.deepEqual(trashed.map((p) => p.id), ['t', 'u']);
  assert.deepEqual(exportWarnings(photos), []);
});

test('exportWarnings：版型要「拍照日期」但沒資料時要先講（會改用檢查日期）', async () => {
  const { defaultSpec } = await import('../../web/js/template/spec.js');
  const spec = defaultSpec();
  spec.block.rows[1].cells[0].lines.push({ label: '拍照日期：', field: 'photoDate' });
  const photos = [{ id: 'a', dir: '4F', desc: 'a', design: 'd', actual: 'r', status: 'ok' }];
  assert.match(exportWarnings(photos, spec).join(), /拍照日期/);
  assert.deepEqual(exportWarnings(photos), []); // 沒給版型就不檢查
  const withDate = [{ ...photos[0], photoDate: '112.06.29' }];
  assert.deepEqual(exportWarnings(withDate, spec), []);
});

test('exportWarnings：版型有設計／實際欄位但沒填', () => {
  const photos = [{ id: 'a', dir: '4F', desc: 'a', design: '', actual: '', status: 'ok' }];
  const w = exportWarnings(photos, null);
  assert.deepEqual(w, []);
});
