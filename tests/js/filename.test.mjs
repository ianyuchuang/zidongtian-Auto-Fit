import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhotoName, isPhotoName, naturalCompare, buildPhotoName, splitExt } from '../../web/js/filename.js';

test('parsePhotoName：標準三段檔名', () => {
  assert.deepEqual(parsePhotoName('4F帷幕骨架安裝間距尺寸檢查(1)-700mm±10-700mm.jpg'), {
    desc: '4F帷幕骨架安裝間距尺寸檢查(1)',
    design: '700mm±10',
    actual: '700mm',
  });
});

test('parsePhotoName：內容說明本身含「-」時從右邊切（同 Python rsplit）', () => {
  assert.deepEqual(parsePhotoName('A-B-設計-實際.png'), { desc: 'A-B', design: '設計', actual: '實際' });
});

test('parsePhotoName：不符格式回 null', () => {
  assert.equal(parsePhotoName('203662_0.jpg'), null);
  assert.equal(parsePhotoName('只有一個-減號.jpg'), null);
});

test('parsePhotoName：會去掉前後空白', () => {
  assert.deepEqual(parsePhotoName('說明 - 700 - 701 .jpg'), { desc: '說明', design: '700', actual: '701' });
});

test('isPhotoName：略過 ~$ 暫存、Thumbs.db、隱藏檔、非圖片', () => {
  assert.equal(isPhotoName('a.jpg'), true);
  assert.equal(isPhotoName('a.JPG'), true);
  assert.equal(isPhotoName('a.PNG'), true);
  assert.equal(isPhotoName('~$50725 4f東側.docx'), false);
  assert.equal(isPhotoName('Thumbs.db'), false);
  assert.equal(isPhotoName('.hidden.jpg'), false);
  assert.equal(isPhotoName('report.docx'), false);
  assert.equal(isPhotoName('noext'), false);
});

test('naturalCompare：數字依大小', () => {
  const names = ['img10.jpg', 'img2.jpg', 'img1.jpg', 'IMG3.jpg'];
  assert.deepEqual(names.sort(naturalCompare), ['img1.jpg', 'img2.jpg', 'IMG3.jpg', 'img10.jpg']);
});

test('buildPhotoName / splitExt 互為反向', () => {
  const n = buildPhotoName(' 說明 ', '700', '701', '.jpg');
  assert.equal(n, '說明-700-701.jpg');
  assert.deepEqual(splitExt(n), ['說明-700-701', '.jpg']);
  assert.deepEqual(splitExt('noext'), ['noext', '']);
});
