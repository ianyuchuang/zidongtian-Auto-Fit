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

/** 讀中央目錄（不靠 unzip.js，才驗得到長度／CRC／位移這些檔頭欄位）。 */
function centralDirectory(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = buf.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50, '找不到 EOCD');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  assert.ok(p > 0, '中央目錄位移是 0（Excel 會說「部分內容有問題」）');
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50, '中央目錄檔頭壞掉');
    const nlen = dv.getUint16(p + 28, true);
    out.push({
      name: new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen)),
      crc: dv.getUint32(p + 16, true),
      csize: dv.getUint32(p + 20, true),
      usize: dv.getUint32(p + 24, true),
      offset: dv.getUint32(p + 42, true),
    });
    p += 46 + nlen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return out;
}

test('ArrayBuffer 的資料要照實寫進 ZIP（2026-09-10 的回歸）', async () => {
  // imaging.js 的 renderForDocx 回的是 ArrayBuffer。ArrayBuffer 沒有 .length，
  // 直接拿去算長度與 crc 會靜靜變成 0、位移累加變 NaN → 中央目錄位移 0，Excel 開不起來。
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  const buf = new Uint8Array(
    await (await zipBlob([{ name: 'a.xml', data: '<x>短</x>' }, { name: 'xl/media/i.jpeg', data: bytes.buffer, store: true }])).arrayBuffer(),
  );
  const cd = centralDirectory(buf);
  const jpg = cd.find((e) => e.name === 'xl/media/i.jpeg');
  assert.equal(jpg.usize, bytes.length);
  assert.equal(jpg.csize, bytes.length); // store
  assert.equal(jpg.crc, crc32(bytes));
  // 本地檔頭真的在中央目錄說的位置上
  assert.equal(new DataView(buf.buffer).getUint32(jpg.offset, true), 0x04034b50);
  assert.deepEqual(buf.subarray(jpg.offset + 30 + 'xl/media/i.jpeg'.length, jpg.offset + 30 + 'xl/media/i.jpeg'.length + bytes.length), bytes);
});

test('認不得的資料型別要大聲失敗，不要產出壞檔', async () => {
  await assert.rejects(() => zipBlob([{ name: 'a.bin', data: { nope: 1 } }]), TypeError);
});
