// xlsx 版型解析：樣本 e-xlsx-3x2（tests/fixtures/版型/，由 tools/make_template_fixtures.py 產生）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseXlsxTemplate } from '../../web/js/template/parse-xlsx.js';
import { validateSpec, layoutPages } from '../../web/js/template/spec.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/版型');

function load(slug) {
  const dir = join(FIX, slug);
  const read = (n) => (existsSync(join(dir, n)) ? readFileSync(join(dir, n), 'utf8') : null);
  return parseXlsxTemplate({
    sheetXml: read('sheet.xml'),
    sharedStringsXml: read('sharedStrings.xml'),
    stylesXml: read('styles.xml'),
    drawingXml: read('drawing.xml'),
    name: slug,
  });
}

const labels = (spec) =>
  spec.block.rows.map((r) => r.cells.map((c) => (c.kind === 'photo' ? '照片' : (c.lines ?? []).map((l) => `${l.label}|${l.field}`).join(','))));

test('e：A4 直式、3 列 × 2 張、抬頭在第一列、說明三欄同一格、照片有日期戳', () => {
  const s = load('e-xlsx-3x2');
  assert.deepEqual(s.unknown, []);
  assert.deepEqual(validateSpec(s), []);
  assert.equal(s.source, 'xlsx');
  assert.equal(s.page.orient, 'portrait');
  assert.equal(s.page.w, 11906);
  assert.equal(s.page.h, 16838);
  // pageMargins 是英吋：0.393700787 吋 ≈ 567 twips、0.511811024 吋 ≈ 737
  assert.equal(s.page.margin.l, 567);
  assert.equal(s.page.margin.t, 737);
  assert.equal(s.grid.perRow, 2);
  assert.equal(s.grid.blockRows, 3);
  assert.equal(s.font, '標楷體');
  assert.equal(s.caption.sizePt, 8);
  assert.equal(s.stamp.on, true);
  // Excel 沒有頁首：抬頭一律當成內文列
  assert.equal(s.heading.place, 'body');
  assert.deepEqual(
    s.heading.lines.map((l) => l.text),
    ['範例營造股份有限公司', '施工自主檢查照片（檢查日期：{date}）'],
  );
  assert.equal(s.heading.lines[0].sizePt, 14);
  assert.equal(s.heading.lines[0].align, 'center');
  // 欄寬 46.7109375 字元 →（round(46.71×7)+5）px × 15 = 4980 dxa；列高 192pt → 3840 twips
  assert.deepEqual(s.block.cols, [4980]);
  assert.equal(s.block.rows.length, 2);
  assert.equal(s.block.rows[0].h, 3840);
  assert.deepEqual(labels(s), [['照片'], ['內容說明：|desc,設    計：|design,實    際：|actual']]);
  // 照片框：3114673 × 2336532 EMU ÷ 9525
  assert.ok(Math.abs(s.photo.maxW - 327.0) < 0.2, s.photo.maxW);
  assert.ok(Math.abs(s.photo.h - 245.3) < 0.2, s.photo.h);
});

test('e：每頁 6 張，7 張要排成兩頁', () => {
  const s = load('e-xlsx-3x2');
  const photos = Array.from({ length: 7 }, (_, i) => ({ desc: `說明${i}` }));
  const pages = layoutPages(s, photos);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].length, 3); // 3 個區塊列
  assert.equal(pages[1].length, 1); // 第 2 頁只剩 1 張，空的區塊列不印
});

test('沒有圖片的工作表：照片格與照片框都列進 unknown，不靜靜套預設值', () => {
  const s = parseXlsxTemplate({
    sheetXml:
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>抬頭</t></is></c></row></sheetData></worksheet>',
  });
  assert.ok(s.unknown.includes('照片格'), s.unknown);
  assert.ok(s.unknown.includes('照片框大小'), s.unknown);
  assert.ok(validateSpec(s).length > 0);
});

test('認不得的紙張不猜：paperSize 未知時列進 unknown', () => {
  const sheet = (setup) =>
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>抬頭</t></is></c></row></sheetData>' +
    setup +
    '</worksheet>';
  assert.ok(parseXlsxTemplate({ sheetXml: sheet('<pageSetup paperSize="99"/>') }).unknown.some((u) => u.includes('紙張')));
  // 沒寫 paperSize 就當 A4（台灣的預設），不算讀不出來
  assert.ok(!parseXlsxTemplate({ sheetXml: sheet('<pageSetup orientation="portrait"/>') }).unknown.some((u) => u.includes('紙張')));
});

test('橫式工作表的長寬要對調', () => {
  const s = parseXlsxTemplate({
    sheetXml:
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData/><pageSetup paperSize="9" orientation="landscape"/></worksheet>',
  });
  assert.equal(s.page.orient, 'landscape');
  assert.equal(s.page.w, 16838);
  assert.equal(s.page.h, 11906);
});

// 整份 xlsx（ZIP）：.rels 的 Target 在 Id 前面、或是絕對路徑（/xl/drawings/drawing1.xml），繪圖層都要找得到
const e = (name) => readFileSync(join(FIX, 'e-xlsx-3x2', name), 'utf8');
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const T = (kind) => `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}"`;
async function xlsxWithRels(wbRels, sheetRels) {
  const { zipBlob } = await import('../../web/js/zip.js');
  const { parseTemplateXlsx } = await import('../../web/js/template/parse-xlsx.js');
  const blob = await zipBlob([
    { name: 'xl/workbook.xml', data: '<?xml version="1.0"?><workbook xmlns="x" xmlns:r="r"><sheets><sheet name="6F" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0"?><Relationships ${REL_NS}>${wbRels}</Relationships>` },
    { name: 'xl/worksheets/sheet1.xml', data: e('sheet.xml') },
    { name: 'xl/worksheets/_rels/sheet1.xml.rels', data: `<?xml version="1.0"?><Relationships ${REL_NS}>${sheetRels}</Relationships>` },
    { name: 'xl/drawings/drawing1.xml', data: e('drawing.xml') },
    { name: 'xl/sharedStrings.xml', data: e('sharedStrings.xml') },
    { name: 'xl/styles.xml', data: e('styles.xml') },
  ]);
  return parseTemplateXlsx(await blob.arrayBuffer(), 'e');
}

test('parseTemplateXlsx：.rels 的 Target 屬性排在 Id 前面也找得到工作表與繪圖層', async () => {
  const s = await xlsxWithRels(
    `<Relationship Target="worksheets/sheet1.xml" ${T('worksheet')} Id="rId1"/>`,
    `<Relationship Target="../drawings/drawing1.xml" ${T('drawing')} Id="rId2"/>`,
  );
  assert.deepEqual(s.unknown, []);
  assert.equal(s.grid.perRow, 2);
  assert.equal(s.stamp.on, true);
});

test('parseTemplateXlsx：.rels 的 Target 是絕對路徑（/xl/...）也找得到工作表與繪圖層', async () => {
  const s = await xlsxWithRels(
    `<Relationship Id="rId1" ${T('worksheet')} Target="/xl/worksheets/sheet1.xml"/>`,
    `<Relationship Id="rId2" ${T('drawing')} Target="/xl/drawings/drawing1.xml"/>`,
  );
  assert.deepEqual(s.unknown, []);
  assert.equal(s.grid.perRow, 2);
  assert.equal(s.stamp.on, true);
});
