// 在 Node 裡用 pdf-export.js 真的產一份 PDF（給 tests/test_pdf_export.py 驗證）。
// 用法：node tests/js/helpers/build_pdf.mjs <輸出.pdf>
// 照片用一張 8x6 的假 JPEG 頂替（render 可換掉，不需要瀏覽器 canvas）。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '../../../web');
const load = (rel, name) => {
  const src = readFileSync(join(web, rel), 'utf8');
  globalThis[name] = new Function(`${src}; return ${name};`)();
};
load('vendor/pdf-lib-1.17.1.min.js', 'PDFLib');
load('vendor/fontkit-1.1.1.umd.min.js', 'fontkit');

const { buildPdfBlob } = await import('../../../web/js/pdf-export.js');

// 8x6 白底 JPEG
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAGAAgBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);
const render = async () => ({ data: JPEG.buffer.slice(JPEG.byteOffset, JPEG.byteOffset + JPEG.byteLength), width: 8, height: 6, type: 'jpg' });

const photo = (n, desc) => ({ name: n, file: n, desc, design: '555x450cm', actual: '555x450cm' });
const groups = [
  {
    folderName: '11F',
    rocDisplay: '115年06月14日',
    rocPhotoDate: '115.6.14',
    stamp: '2026-06-14',
    photos: [photo('a.jpg', '輕隔間 1107 梯廳'), photo('b.jpg', '輕隔間 1108\n第二行'), photo('c.jpg', '柱樑')],
  },
  { folderName: '12F', rocDisplay: '115年06月15日', rocPhotoDate: '115.6.15', stamp: '2026-06-15', photos: [photo('d.jpg', '天花板')] },
];

const fontBytes = new Uint8Array(readFileSync(join(web, 'vendor/fonts/TW-Kai-98_1.ttf')));
const { blob, failures, warnings, pages } = await buildPdfBlob(groups, { fontBytes, render });
const bytes = Buffer.from(await blob.arrayBuffer());
writeFileSync(process.argv[2], bytes);
// 產出的位元組是壓縮過的（object streams），所以回讀一次再報版面尺寸，Python 那邊不必自己解 PDF。
const back = await PDFLib.PDFDocument.load(bytes);
const sizes = back.getPages().map((pg) => [Math.round(pg.getWidth() * 10) / 10, Math.round(pg.getHeight() * 10) / 10]);
console.log(JSON.stringify({ pages, failures, warnings, bytes: bytes.length, sizes }));
