// 在 Node 裡用 docx-export.js 產一份 docx（給 tests/test_docx_export.py 用 zipfile 驗證版面）。
// 用法：node tests/js/helpers/build_docx.mjs [--spec <spec.json>] <照片1.jpg> ... <輸出.docx>
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const iife = readFileSync(join(here, '../../../web/vendor/docx-9.7.1.iife.js'), 'utf8');
globalThis.docx = new Function(`${iife}; return docx;`)();

const { buildDocxBlob } = await import('../../../web/js/docx-export.js');

const args = process.argv.slice(2);
let spec;
if (args[0] === '--spec') {
  args.shift();
  spec = JSON.parse(readFileSync(args.shift(), 'utf8'));
}
const out = args.pop();
const photos = args.map((p, i) => ({
  name: basename(p),
  file: p,
  desc: `說明${i + 1}`,
  design: `設計${i + 1}`,
  actual: `實際${i + 1}`,
}));

/** 不用 canvas：直接把 JPEG 原檔塞進去，尺寸從 SOF 標頭讀。 */
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new Error('不是 JPEG');
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  throw new Error('讀不到 JPEG 尺寸');
}

const render = async (path) => {
  const buf = readFileSync(path);
  const { width, height } = jpegSize(buf);
  return { data: new Uint8Array(buf), width, height, type: 'jpg' };
};

const { blob, failures } = await buildDocxBlob({ photos }, { spec, rocDisplay: '115年07月25日', stamp: '2026-07-25', render });
if (failures.length) throw new Error(failures.join('\n'));
writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
console.log(`OK ${out} ${blob.size}`);
