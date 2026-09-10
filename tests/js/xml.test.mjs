import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, find, findAll, kids, attr, num, text, relTargets, resolveTarget } from '../../web/js/template/xml.js';

const XML = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t xml:space="preserve">你好 </w:t></w:r><w:r><w:t>世界 &amp; co</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p/></w:tc><w:tc/></w:tr></w:tbl><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`;

test('解析元素、屬性、文字與實體', () => {
  const root = parseXml(XML);
  const doc = kids(root)[0];
  assert.equal(doc.name, 'w:document');
  assert.equal(attr(doc, 'xmlns:w'), 'x');
  assert.equal(text(find(doc, 'w:p')), '你好 世界 & co');
  const pg = find(doc, 'w:pgSz');
  assert.equal(num(pg, 'w:w'), 11906);
  assert.equal(num(pg, 'w:h'), 16838);
});

test('kids 只看直接子節點，findAll 找所有子孫', () => {
  const doc = kids(parseXml(XML))[0];
  const tr = find(doc, 'w:tr');
  assert.equal(kids(tr, 'w:tc').length, 2);
  assert.equal(findAll(doc, 'w:t').length, 2);
  assert.equal(kids(doc, 'w:t').length, 0);
});

test('自閉合標籤不會吃掉後面的內容', () => {
  const root = parseXml('<a><b/><c>x</c></a>');
  const a = kids(root)[0];
  assert.deepEqual(kids(a).map((n) => n.name), ['b', 'c']);
  assert.equal(text(a), 'x');
});

test('註解與 XML 宣告會跳過', () => {
  const root = parseXml('<?xml version="1.0"?><!-- 註解 --><a>x<!--y-->z</a>');
  assert.equal(text(kids(root)[0]), 'xz');
});

test('屬性含斜線與空白不會解析錯', () => {
  const root = parseXml('<a r:id="rId7" w:val="a/b" />');
  const a = kids(root)[0];
  assert.equal(attr(a, 'r:id'), 'rId7');
  assert.equal(attr(a, 'w:val'), 'a/b');
});

test('單引號的屬性也讀得到', () => {
  const a = kids(parseXml(`<a w:val='x' r:id="rId1" b='say "hi"'/>`))[0];
  assert.equal(attr(a, 'w:val'), 'x');
  assert.equal(attr(a, 'r:id'), 'rId1');
  assert.equal(attr(a, 'b'), 'say "hi"');
});

test('屬性值裡的 > 不會被當成標籤結尾', () => {
  const root = parseXml('<a w:val="x>y" q=\'1>2\'><b>t</b></a>');
  const a = kids(root)[0];
  assert.equal(attr(a, 'w:val'), 'x>y');
  assert.equal(attr(a, 'q'), '1>2');
  assert.deepEqual(kids(a).map((n) => n.name), ['b']);
  assert.equal(text(a), 't');
});

test('CDATA 原樣當文字，不解實體，和前後文字拼成同一段', () => {
  const t = kids(parseXml('<t><![CDATA[x > y]]></t>'))[0];
  assert.equal(text(t), 'x > y');
  assert.deepEqual(t.children, ['x > y']);
  // 前後夾一般文字：一般的解實體、CDATA 的不解
  const m = kids(parseXml('<t>a&amp;<![CDATA[&amp;<b>]]>c</t>'))[0];
  assert.equal(text(m), 'a&&amp;<b>c');
  assert.equal(m.children.length, 1, '相鄰文字要併成一個節點');
  // 空的 CDATA 不留空字串
  assert.deepEqual(kids(parseXml('<t><![CDATA[]]></t>'))[0].children, []);
});

test('relTargets：屬性順序不拘；resolveTarget：相對與絕對路徑都對得到', () => {
  const rels = `<?xml version="1.0"?><Relationships xmlns="r">
    <Relationship Id="rId1" Type="t" Target="header1.xml"/>
    <Relationship Target="/word/header2.xml" Type="t" Id="rId2"/>
    <Relationship Type="t" Target="../drawings/drawing1.xml" Id="rId3"/></Relationships>`;
  const map = relTargets(rels);
  assert.deepEqual([...map], [['rId1', 'header1.xml'], ['rId2', '/word/header2.xml'], ['rId3', '../drawings/drawing1.xml']]);
  assert.equal(resolveTarget('word/document.xml', 'header1.xml'), 'word/header1.xml');
  assert.equal(resolveTarget('word/document.xml', '/word/header2.xml'), 'word/header2.xml');
  assert.equal(resolveTarget('xl/worksheets/sheet1.xml', '../drawings/drawing1.xml'), 'xl/drawings/drawing1.xml');
  assert.equal(resolveTarget('xl/worksheets/sheet1.xml', '/xl/drawings/drawing1.xml'), 'xl/drawings/drawing1.xml');
  assert.equal(resolveTarget('xl/workbook.xml', 'worksheets/sheet1.xml'), 'xl/worksheets/sheet1.xml');
  assert.equal(relTargets(null).size, 0);
});
