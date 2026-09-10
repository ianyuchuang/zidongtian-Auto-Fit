// web/js/template/xlsx.js：Excel 與 LayoutSpec 之間的單位換算與座標。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { charWidthToDxa, charWidthToPx, cellRef, colIndex, colName, dxaToCharWidth, inchToTwips, parseRange, parseRef, ptToTwips, pxToCharWidth, twipsToInch, twipsToPt } from '../../web/js/template/xlsx.js';

test('欄寬：字元 ↔ 像素 ↔ dxa 來回換算不會走鐘', () => {
  assert.equal(charWidthToPx(46.7109375), 332); // round(46.71 × 7) + 5
  assert.equal(charWidthToDxa(46.7109375), 4980); // 332 px × 15
  assert.equal(charWidthToPx(8.43), 64); // Excel 的預設欄寬
  // 來回一趟要回得去（誤差在 1 px 以內）
  for (const w of [8.43, 12, 20.5, 46.7109375]) {
    assert.ok(Math.abs(charWidthToPx(pxToCharWidth(charWidthToPx(w))) - charWidthToPx(w)) <= 1, String(w));
  }
  assert.ok(Math.abs(dxaToCharWidth(4980) - 46.71) < 0.05);
});

test('列高：pt ↔ twips', () => {
  assert.equal(ptToTwips(192), 3840);
  assert.equal(twipsToPt(3840), 192);
  assert.equal(twipsToPt(3798), 189.9);
});

test('邊界：英吋 ↔ twips', () => {
  assert.equal(inchToTwips(0.39370078740157483), 567);
  assert.equal(inchToTwips(0.51181102362204722), 737);
  assert.ok(Math.abs(twipsToInch(567) - 0.39375) < 1e-6);
});

test('欄名與儲存格位址', () => {
  assert.equal(colName(0), 'A');
  assert.equal(colName(25), 'Z');
  assert.equal(colName(26), 'AA');
  assert.equal(colIndex('AA'), 26);
  assert.equal(cellRef(1, 11), 'B12');
  assert.deepEqual(parseRef('B12'), { col: 1, row: 11 });
  assert.equal(parseRef('12B'), null);
  assert.deepEqual(parseRange('A1:B1'), { c1: 0, r1: 0, c2: 1, r2: 0 });
  assert.deepEqual(parseRange('B2:A1'), { c1: 0, r1: 0, c2: 1, r2: 1 }); // 反著寫也收得起來
  assert.equal(parseRange('亂寫'), null);
});
