// 產生 ZIP（xlsx 就是一個 ZIP）。用瀏覽器內建的 CompressionStream，不外掛壓縮函式庫
// （維持「純前端、無建置步驟」）。讀取端在 template/unzip.js。

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream !== 'function') return null; // 沒有就退回不壓縮（store）
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const utf8 = (s) => new TextEncoder().encode(s);

/**
 * 打包成 ZIP（回傳 Blob）。
 * entries: [{ name, data: Uint8Array | string, store?: boolean }]
 * store=true 的不壓縮（JPEG 這種本來就壓過的，再壓只是白費時間）。
 * 一律用「不帶資料描述元」的本地檔頭，欄位在寫入前就都知道，讀取端最單純。
 */
export async function zipBlob(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const name = utf8(e.name);
    const raw = typeof e.data === 'string' ? utf8(e.data) : e.data;
    const deflated = e.store ? null : await deflateRaw(raw);
    // 壓不小就別壓（小檔案 deflate 反而會變大）
    const useDeflate = !!deflated && deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // 需要的版本
    lv.setUint16(6, 0x0800, true); // 檔名是 UTF-8
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true); // 時間
    lv.setUint16(12, 0x0021, true); // 日期（1980-01-01）
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    parts.push(local, body);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // 產生者版本
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x0021, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);

    offset += local.length + body.length;
  }

  const cenSize = central.reduce((a, b) => a + b.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...parts, ...central, eocd], { type: 'application/zip' });
}
