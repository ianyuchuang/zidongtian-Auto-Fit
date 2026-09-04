// unzipText：自己組一個 ZIP（一個不壓縮、一個 deflate）再讀回來。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipText } from '../../web/js/template/unzip.js';

const enc = new TextEncoder();

async function deflateRaw(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** 組一個最小可用的 ZIP（CRC 填 0，unzipText 不看 CRC）。 */
async function makeZip(entries) {
  const parts = [];
  const cen = [];
  let offset = 0;
  for (const [name, text, method] of entries) {
    const nameB = enc.encode(name);
    const raw = enc.encode(text);
    const data = method === 8 ? await deflateRaw(raw) : raw;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, method, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameB.length, true);
    parts.push(new Uint8Array(local.buffer), nameB, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(10, method, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, raw.length, true);
    c.setUint16(28, nameB.length, true);
    c.setUint32(42, offset, true);
    cen.push(new Uint8Array(c.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cenBytes = cen.reduce((a, b) => a + b.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cenBytes, true);
  eocd.setUint32(16, offset, true);
  const blob = new Blob([...parts, ...cen, new Uint8Array(eocd.buffer)]);
  return blob.arrayBuffer();
}

test('讀得出不壓縮與 deflate 的項目，只解壓要的那幾個', async () => {
  const long = '<w:document>' + 'x'.repeat(5000) + '</w:document>';
  const zip = await makeZip([
    ['word/document.xml', long, 8],
    ['word/_rels/document.xml.rels', '<Relationships/>', 0],
    ['word/media/image1.jpeg', '不要解這個', 0],
  ]);
  const files = await unzipText(zip, (n) => n.endsWith('.xml') || n.endsWith('.rels'));
  assert.equal(files.size, 2);
  assert.equal(files.get('word/document.xml'), long);
  assert.equal(files.get('word/_rels/document.xml.rels'), '<Relationships/>');
  assert.equal(files.has('word/media/image1.jpeg'), false);
});

test('不是 ZIP 就丟錯', async () => {
  await assert.rejects(() => unzipText(enc.encode('not a zip').buffer, () => true), /不是有效的 docx/);
});
