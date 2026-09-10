// 在 Node 裡用 xlsx-export.js 產一份 xlsx（給 tests/test_xlsx_export.py 用 zipfile 驗證版面）。
// 用法：node tests/js/helpers/build_xlsx.mjs [--spec <spec.json> | --template <docx fixture 目錄>
//                                            | --template-xlsx <xlsx fixture 目錄>] <照片1.jpg> ... <輸出.xlsx>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const { buildXlsxBlob } = await import('../../../web/js/xlsx-export.js');

const args = process.argv.slice(2);
let spec;
if (args[0] === '--spec') {
  args.shift();
  spec = JSON.parse(readFileSync(args.shift(), 'utf8'));
} else if (args[0] === '--template') {
  args.shift();
  const dir = args.shift();
  const { parseTemplate } = await import('../../../web/js/template/parse.js');
  const hdr = join(dir, 'header.xml');
  spec = parseTemplate({
    documentXml: readFileSync(join(dir, 'document.xml'), 'utf8'),
    headerXml: existsSync(hdr) ? readFileSync(hdr, 'utf8') : null,
    name: dir,
  });
} else if (args[0] === '--template-xlsx') {
  args.shift();
  const dir = args.shift();
  const { parseXlsxTemplate } = await import('../../../web/js/template/parse-xlsx.js');
  const read = (n) => (existsSync(join(dir, n)) ? readFileSync(join(dir, n), 'utf8') : null);
  spec = parseXlsxTemplate({
    sheetXml: read('sheet.xml'),
    sharedStringsXml: read('sharedStrings.xml'),
    stylesXml: read('styles.xml'),
    drawingXml: read('drawing.xml'),
    name: dir,
  });
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

const { blob, failures } = await buildXlsxBlob(
  { folderName: '範例資料夾', photos },
  { spec, rocDisplay: '115年07月25日', rocPhotoDate: '115.7.25', stamp: '2026-07-25', render },
);
if (failures.length) throw new Error(failures.join('\n'));
writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
console.log(`OK ${out} ${blob.size}`);
