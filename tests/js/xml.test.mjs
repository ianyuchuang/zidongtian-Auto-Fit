import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, find, findAll, kids, attr, num, text } from '../../web/js/template/xml.js';

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
