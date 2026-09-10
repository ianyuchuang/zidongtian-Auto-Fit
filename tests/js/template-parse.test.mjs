// 版型解析：四份樣本（tests/fixtures/版型/，由 tools/make_template_fixtures.py 產生）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseTemplate } from '../../web/js/template/parse.js';
import { validateSpec, layoutPages } from '../../web/js/template/spec.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/版型');

function load(slug) {
  const dir = join(FIX, slug);
  const headerPath = join(dir, 'header.xml');
  return parseTemplate({
    documentXml: readFileSync(join(dir, 'document.xml'), 'utf8'),
    headerXml: existsSync(headerPath) ? readFileSync(headerPath, 'utf8') : null,
    name: slug,
  });
}

const labels = (spec) =>
  spec.block.rows.map((r) => r.cells.map((c) => (c.kind === 'photo' ? '照片' : (c.lines ?? []).map((l) => `${l.label}|${l.field}`).join(','))));

test('a：A4 直式、3 列 × 2 張、抬頭在頁首、說明三欄、照片有日期戳', () => {
  const s = load('a-portrait-3x2');
  assert.deepEqual(s.unknown, []);
  assert.deepEqual(validateSpec(s), []);
  assert.equal(s.page.orient, 'portrait');
  assert.equal(s.page.w, 11906);
  assert.equal(s.page.margin.l, 1134);
  assert.equal(s.grid.perRow, 2);
  assert.equal(s.grid.blockRows, 3);
  assert.deepEqual(s.block.cols, [4915]);
  assert.equal(s.block.rows[0].h, 3798);
  assert.equal(s.font, '標楷體');
  assert.equal(s.caption.sizePt, 8);
  assert.equal(s.stamp.on, true);
  assert.equal(s.heading.place, 'header');
  // 抬頭裡的日期換成 {date}，輸出時才會帶入這次的檢查日期
  assert.equal(s.heading.lines[1].text, '施工自主檢查照片(檢查日期：{date})');
  assert.deepEqual(labels(s), [['照片'], ['內容說明：|desc,設    計：|design,實    際：|actual']]);
  assert.ok(Math.abs(s.photo.maxW - 317.4) < 0.1 && Math.abs(s.photo.h - 238.1) < 0.1);
});

test('b：A4 橫式、抬頭在內文、照片格跨 5 列、欄位名在隔壁格', () => {
  const s = load('b-landscape-5rows');
  assert.deepEqual(s.unknown, []);
  assert.deepEqual(validateSpec(s), []);
  assert.equal(s.page.orient, 'landscape');
  assert.equal(s.page.w, 16840);
  assert.equal(s.grid.perRow, 2);
  assert.equal(s.grid.blockRows, 2);
  assert.deepEqual(s.block.cols, [5984, 1105, 576]);
  assert.equal(s.block.rows.length, 5);
  assert.equal(s.heading.place, 'body');
  assert.deepEqual(s.heading.lines.map((l) => l.text), ['範例工程', '施工查驗照片']);
  // 照片格跨 5 列；「照片編號」的值在右邊那格，「拍照日期」「圖片說明」的值在下一列
  const photo = s.block.rows[0].cells[0];
  assert.equal(photo.kind, 'photo');
  assert.equal(photo.rowSpan, 5);
  assert.deepEqual(labels(s), [
    ['照片', '照片編號|none', '|seq'],
    ['拍照日期|none'],
    ['|photoDate'],
    ['圖片說明|none'],
    ['|desc'],
  ]);
  // 合併格讓出來的位置：下面幾列的說明格從第 1 欄開始
  assert.equal(s.block.rows[1].cells[0].col, 1);
  assert.equal(s.block.rows[1].cells[0].colSpan, 2);
  assert.equal(s.stamp.on, false);
});

test('c：欄位名是獨立的一格，值在右邊那格', () => {
  const s = load('c-portrait-label-cell');
  assert.deepEqual(s.unknown, []);
  assert.deepEqual(validateSpec(s), []);
  assert.equal(s.grid.perRow, 2);
  assert.deepEqual(s.block.cols, [988, 4392]);
  assert.equal(s.block.rows[0].cells[0].colSpan, 2); // 照片橫跨兩欄
  assert.deepEqual(labels(s), [['照片'], ['說明：|none', '|desc']]);
  assert.equal(s.heading.place, 'body');
  assert.equal(s.heading.lines[1].text, '自主檢查照片(檢查日期:{date})');
});

test('解析出來的版型可以直接拿去排照片', () => {
  const s = load('b-landscape-5rows');
  assert.deepEqual(layoutPages(s, [1, 2, 3, 4, 5]), [
    [
      [1, 2],
      [3, 4],
    ],
    [[5, null]],
  ]);
});

test('沒有照片的表格要老實說讀不出來，不要亂猜', () => {
  const xml =
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:tbl><w:tblGrid><w:gridCol w:w="4915"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';
  const s = parseTemplate({ documentXml: xml, name: 'bad' });
  assert.ok(s.unknown.includes('照片格'));
  assert.ok(s.unknown.includes('照片框大小'));
  assert.ok(validateSpec(s).length);
});

test('不是 Word 的 XML 就直接丟錯', () => {
  assert.throws(() => parseTemplate({ documentXml: '<html><body/></html>' }), /不是 Word/);
});

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const DOC_MIN =
  `<w:document ${W}><w:body>` +
  '<w:tbl><w:tblGrid><w:gridCol w:w="4915"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
  '<w:sectPr><w:headerReference w:type="default" r:id="rId1"/><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';

test('頁首排成表格時，抬頭文字也要讀得出來', () => {
  const headerXml =
    `<w:hdr ${W}><w:tbl><w:tr><w:tc><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>工程名稱：某某案</w:t></w:r></w:p></w:tc>` +
    '<w:tc><w:p><w:r><w:t>日期：113年6月14日</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>自主檢查表</w:t></w:r></w:p></w:hdr>';
  const s = parseTemplate({ documentXml: DOC_MIN, headerXml, name: 'h' });
  assert.deepEqual(
    s.heading.lines.map((l) => l.text),
    ['工程名稱：某某案', '日期：{date}', '自主檢查表'],
  );
  assert.equal(s.heading.lines[0].align, 'center');
  assert.ok(!s.unknown.some((u) => u.includes('頁首')));
});

test('頁首有字卻讀不出段落時要列進 unknown，不要靜靜給空抬頭', () => {
  const headerXml = `<w:hdr ${W}><w:r><w:t>不在任何段落裡的字</w:t></w:r></w:hdr>`;
  const s = parseTemplate({ documentXml: DOC_MIN, headerXml, name: 'h' });
  assert.deepEqual(s.heading.lines, []);
  assert.ok(s.unknown.some((u) => u.includes('頁首')));
  assert.match(validateSpec(s).join(), /頁首/);
});

test('「欄位名：值」後面接的續行段落是值太長換行，不是新的欄位', () => {
  const tc = (...ps) => `<w:tc>${ps.map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join('')}</w:tc>`;
  const photo = '<w:tc><w:p><w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="1428750"/></wp:inline></w:drawing></w:r></w:p></w:tc>';
  const xml =
    `<w:document ${W} xmlns:wp="wp"><w:body><w:tbl><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>` +
    `<w:tr>${photo}${tc('內容說明：這一段範例說明很長', '所以在樣本裡換到第二段', '設計值：10cm', '實際值：10cm')}</w:tr>` +
    '</w:tbl><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';
  const s = parseTemplate({ documentXml: xml, name: 'cont' });
  const cell = s.block.rows[0].cells.find((c) => c.kind === 'text');
  assert.deepEqual(
    cell.lines.map((l) => [l.label, l.field]),
    [
      ['內容說明：', 'desc'],
      ['設計值：', 'design'],
      ['實際值：', 'actual'],
    ],
  );
  assert.deepEqual(validateSpec(s), []);
});

test('解析出來的說明格一律靠左、垂直置中（不照樣本的靠上）', async () => {
  const spec = load('b-landscape-5rows');
  for (const row of spec.block.rows) for (const cell of row.cells) {
    assert.equal(cell.vAlign, 'center', cell.kind);
    assert.equal(cell.align, cell.kind === 'photo' ? 'center' : 'left');
  }
});

test('d：同 a 的版面但每頁 2 列 × 2 張（2026-09-04 回歸：輸出曾被 Word 排成 3 × 2）', () => {
  const s = load('d-portrait-2x2');
  assert.deepEqual(s.unknown, []);
  assert.deepEqual(validateSpec(s), []);
  assert.equal(s.grid.perRow, 2);
  assert.equal(s.grid.blockRows, 2);
  assert.equal(s.heading.place, 'header');
  assert.equal(s.block.rows[0].h, 3798);
  assert.deepEqual(labels(s), [['照片'], ['內容說明：|desc,設    計：|design,實    際：|actual']]);
  // 5 張 → 2 頁（4＋1），第 2 頁只剩一列
  const pages = layoutPages(s, [1, 2, 3, 4, 5]);
  assert.equal(pages.length, 2);
  assert.equal(pages[1].length, 1);
});

test('抬頭字級取文字 run 的 w:sz，不被段落標記（w:pPr/w:rPr）的字級撞到；w:b w:val="0" 不算粗體；靠右要讀成 right', () => {
  const p = (pPr, rPr, t) => `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:rPr>${rPr}</w:rPr><w:t>${t}</w:t></w:r></w:p>`;
  const xml =
    `<w:document ${W}><w:body>` +
    p('<w:jc w:val="center"/><w:rPr><w:sz w:val="28"/></w:rPr>', '<w:sz w:val="36"/><w:b/>', '範例工程') +
    p('<w:jc w:val="right"/><w:rPr><w:b/><w:sz w:val="20"/></w:rPr>', '<w:b w:val="0"/><w:sz w:val="24"/>', '施工查驗照片') +
    p('<w:rPr><w:b/></w:rPr>', '<w:b w:val="false"/>', '第三行') +
    '<w:tbl><w:tblGrid><w:gridCol w:w="4915"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';
  const s = parseTemplate({ documentXml: xml, name: 'hd' });
  assert.deepEqual(
    s.heading.lines.map((l) => [l.sizePt, l.bold, l.align]),
    [
      [18, true, 'center'],
      [12, false, 'right'],
      [14, false, 'left'],
    ],
  );
});

test('說明格字級也取文字 run 的 w:sz，不看段落標記的字級', () => {
  const photo = '<w:tc><w:p><w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="1428750"/></wp:inline></w:drawing></w:r></w:p></w:tc>';
  const text = '<w:tc><w:p><w:pPr><w:rPr><w:sz w:val="24"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>內容說明：範例</w:t></w:r></w:p></w:tc>';
  const xml =
    `<w:document ${W} xmlns:wp="wp"><w:body><w:tbl><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>` +
    `<w:tr>${photo}${text}</w:tr>` +
    '</w:tbl><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';
  const s = parseTemplate({ documentXml: xml, name: 'sz' });
  const cell = s.block.rows[0].cells.find((c) => c.kind === 'text');
  assert.equal(cell.sizePt, 8);
  assert.equal(s.caption.sizePt, 8);
});

test('表格裡照片區塊以外的列（第一個照片列之前、最後一個區塊之後）要列進 unknown，不能靜靜丟掉', () => {
  const photo = '<w:tc><w:p><w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="1428750"/></wp:inline></w:drawing></w:r></w:p></w:tc>';
  const tc = (t) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
  const head = `<w:document ${W} xmlns:wp="wp"><w:body><w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>`;
  const tail = '</w:tbl><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';
  const block = `<w:tr>${photo}</w:tr><w:tr>${tc('內容說明：範例')}</w:tr>`;
  // 剛好兩個區塊：不誤報
  const ok = parseTemplate({ documentXml: head + block + block + tail, name: 'ok' });
  assert.deepEqual(ok.unknown, []);
  // 前面多一列標題列
  const before = parseTemplate({ documentXml: head + `<w:tr>${tc('工程名稱')}</w:tr>` + block + block + tail, name: 'before' });
  assert.deepEqual(before.unknown, ['表格有 1 列不在照片區塊內（第 1–1 列）']);
  assert.ok(validateSpec(before).length, '要擋下來');
  // 後面多兩列備註列
  const after = parseTemplate({ documentXml: head + block + block + `<w:tr>${tc('備註')}</w:tr><w:tr>${tc('簽名')}</w:tr>` + tail, name: 'after' });
  assert.deepEqual(after.unknown, ['表格有 2 列不在照片區塊內（第 5–6 列）']);
});

// 整份 docx（ZIP）：.rels 的 Target 在 Id 前面、或是絕對路徑（/word/header1.xml），頁首都要找得到
const a = (name) => readFileSync(join(FIX, 'a-portrait-3x2', name), 'utf8');
async function docxWithRels(relsXml) {
  const { zipBlob } = await import('../../web/js/zip.js');
  const { parseTemplateDocx } = await import('../../web/js/template/parse.js');
  const blob = await zipBlob([
    { name: 'word/document.xml', data: a('document.xml') },
    { name: 'word/_rels/document.xml.rels', data: relsXml },
    { name: 'word/header1.xml', data: a('header.xml') },
  ]);
  return parseTemplateDocx(await blob.arrayBuffer(), 'a');
}
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const HDR = 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header"';

test('parseTemplateDocx：.rels 的 Target 屬性排在 Id 前面也對得到頁首', async () => {
  const s = await docxWithRels(`<?xml version="1.0"?><Relationships ${REL_NS}><Relationship Target="header1.xml" ${HDR} Id="rId14"/></Relationships>`);
  assert.equal(s.heading.place, 'header');
  assert.equal(s.heading.lines[1].text, '施工自主檢查照片(檢查日期：{date})');
  assert.deepEqual(s.unknown, []);
});

test('parseTemplateDocx：.rels 的 Target 是絕對路徑（/word/header1.xml）也對得到頁首', async () => {
  const s = await docxWithRels(`<?xml version="1.0"?><Relationships ${REL_NS}><Relationship Id="rId14" ${HDR} Target="/word/header1.xml"/></Relationships>`);
  assert.equal(s.heading.place, 'header');
  assert.equal(s.heading.lines[1].text, '施工自主檢查照片(檢查日期：{date})');
  assert.deepEqual(s.unknown, []);
});
