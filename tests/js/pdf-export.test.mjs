// PDF 版面幾何的純函式（吃假的 metrics，不需要瀏覽器與 pdf-lib）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSpec, tableCols } from '../../web/js/template/spec.js';
import { TWIP, PX, HEADER_DIST, wrapLines, columnGeometry, buildPageCells, computeRowHeights, headingHeight, bodyTop, pageOverflow } from '../../web/js/pdf-export.js';

// 一行高＝字級、ascent＝0.8 倍，好算。
const metrics = { lineHeight: (s) => s, ascent: (s) => s * 0.8, widthOf: (t, s) => t.length * s * 0.5 };

test('單位換算：twips→pt 是 1/20、px(96dpi)→pt 是 0.75', () => {
  assert.equal(1440 * TWIP, 72);
  assert.equal(96 * PX, 72);
});

test('wrapLines：\\n 是段落內換行', () => {
  assert.deepEqual(wrapLines('a\nb'), ['a', 'b']);
  assert.deepEqual(wrapLines(''), ['']);
  assert.deepEqual(wrapLines(null), ['']);
});

test('columnGeometry：欄寬照 tableCols，起點含 tableIndent', () => {
  const spec = defaultSpec();
  const g = columnGeometry(spec, 100);
  assert.equal(g.x.length, tableCols(spec).length);
  assert.equal(g.x[0], 100 + spec.grid.tableIndent * TWIP);
  assert.equal(g.w[0], spec.block.cols[0] * TWIP);
  assert.equal(g.right, g.x[g.x.length - 1] + g.w[g.w.length - 1]);
});

test('buildPageCells：每個區塊列展開成 block.rows 個實體列，欄號依 perRow 位移', () => {
  const spec = defaultSpec(); // perRow 2、block 2 列 1 欄
  const pageRows = [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }, null]];
  const cells = buildPageCells(spec, pageRows);
  assert.equal(cells.length, 2 * 2 * 2); // 2 區塊列 × 2 實體列 × 2 格
  assert.deepEqual([...new Set(cells.map((c) => c.r))].sort(), [0, 1, 2, 3]);
  assert.deepEqual([...new Set(cells.map((c) => c.c))].sort(), [0, 1]);
  const empty = cells.filter((c) => c.photo === null);
  assert.equal(empty.length, 2); // 第 2 區塊列右邊那格沒照片
});

test('computeRowHeights：版型列高是下限，內容更高就把最後一列撐開', () => {
  const spec = defaultSpec();
  const pageRows = [[{ id: 'a' }, { id: 'b' }]];
  const cells = buildPageCells(spec, pageRows);
  const base = computeRowHeights(spec, pageRows, cells, () => 0);
  assert.equal(base.length, 2);
  assert.equal(base[0], spec.block.rows[0].h * TWIP);
  assert.equal(base[1], 0); // h: null 的文字列，沒內容就 0
  const tall = computeRowHeights(spec, pageRows, cells, (cd) => (cd.cell.kind === 'photo' ? 1000 : 30));
  assert.equal(tall[0], 1000);
  assert.equal(tall[1], 30);
});

test('computeRowHeights：跨列的格子只補不足的部分', () => {
  const spec = defaultSpec();
  spec.block.rows[0].cells[0].rowSpan = 2;
  const pageRows = [[{ id: 'a' }, { id: 'b' }]];
  const cells = buildPageCells(spec, pageRows);
  const h = computeRowHeights(spec, pageRows, cells, (cd) => (cd.cell.kind === 'photo' ? spec.block.rows[0].h * TWIP + 50 : 0));
  assert.equal(h[0], spec.block.rows[0].h * TWIP);
  assert.equal(h[1], 50);
});

test('headingHeight：每一行照自己的字級算，\\n 多算一行', () => {
  const spec = defaultSpec();
  assert.equal(headingHeight(spec, metrics), 14 + 14);
  spec.heading.lines[0].text = 'a\nb';
  assert.equal(headingHeight(spec, metrics), 14 * 3);
});

test('bodyTop：抬頭在頁首時內文被推到頁首下方；在內文時就是上邊界', () => {
  const spec = defaultSpec();
  assert.equal(bodyTop(spec, metrics), HEADER_DIST + 28); // 上邊界 709twips=35.45pt 比它小
  spec.heading.place = 'body';
  assert.equal(bodyTop(spec, metrics), spec.page.margin.t * TWIP);
});

test('bodyTop：上邊界比頁首還低時以上邊界為準', () => {
  const spec = defaultSpec();
  spec.page.margin.t = 4000; // 200pt
  assert.equal(bodyTop(spec, metrics), 200);
});

test('pageOverflow：排得下是 0，超過會回超出的 pt 數', () => {
  const spec = defaultSpec();
  assert.equal(pageOverflow(spec, metrics, [100, 100]), 0);
  const over = pageOverflow(spec, metrics, [5000]);
  assert.ok(over > 0, `應該要回報超出，卻是 ${over}`);
});
