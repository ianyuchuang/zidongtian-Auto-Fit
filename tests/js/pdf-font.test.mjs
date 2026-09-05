// PDF 字型挑選的純邏輯（不碰 queryLocalFonts）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fontCandidates, matchFontData, FALLBACK_URL } from '../../web/js/pdf-font.js';

test('fontCandidates：原名排第一，再接別名，不重複', () => {
  const c = fontCandidates('標楷體');
  assert.equal(c[0], '標楷體');
  assert.ok(c.includes('DFKai-SB'));
  assert.equal(new Set(c).size, c.length);
});

test('fontCandidates：沒登記別名的字型只有自己', () => {
  assert.deepEqual(fontCandidates('Arial'), ['Arial']);
  assert.deepEqual(fontCandidates(''), []);
});

test('matchFontData：family / fullName / postscriptName 任一相符都算，且不分大小寫', () => {
  const list = [{ family: 'Arial' }, { family: '', fullName: '', postscriptName: 'dfkai-sb' }];
  assert.equal(matchFontData(list, '標楷體').postscriptName, 'dfkai-sb');
  assert.equal(matchFontData(list, 'arial').family, 'Arial');
});

test('matchFontData：優先用原名，別名是備胎', () => {
  const list = [{ family: 'DFKai-SB' }, { family: '標楷體' }];
  assert.equal(matchFontData(list, '標楷體').family, '標楷體');
});

test('matchFontData：找不到回 null；備用字型路徑指向 vendor/fonts', () => {
  assert.equal(matchFontData([{ family: 'Arial' }], '標楷體'), null);
  assert.equal(matchFontData(null, '標楷體'), null);
  assert.ok(FALLBACK_URL.startsWith('vendor/fonts/'));
});
