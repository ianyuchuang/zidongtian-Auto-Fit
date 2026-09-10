// web/js/zip.js 打包出來的 ZIP，要能被 web/js/template/unzip.js 讀回去（兩邊各自獨立實作）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, zipBlob } from '../../web/js/zip.js';
import { unzipText } from '../../web/js/template/unzip.js';

test('crc32 與已知值相符', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('壓縮的與不壓縮的都讀得回來', async () => {
  const long = '<x>' + '中文內容'.repeat(500) + '</x>'; // 夠長才壓得贏原檔
  const blob = await zipBlob([
    { name: 'a.xml', data: long },
    { name: 'dir/b.bin', data: new Uint8Array([1, 2, 3, 4, 5]), store: true },
    { name: 'c.xml', data: '短' },
  ]);
  const files = await unzipText(await blob.arrayBuffer(), () => true);
  assert.equal(files.get('a.xml'), long);
  assert.equal(files.get('c.xml'), '短');
  assert.equal(files.size, 3);
  assert.ok(blob.size < long.length, '長內容應該有被壓縮');
});
