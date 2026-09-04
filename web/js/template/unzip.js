// 從 .docx（就是一個 ZIP）取出需要的檔案。用瀏覽器內建的 DecompressionStream，
// 不外掛解壓函式庫（維持「純前端、無建置步驟」）。Chrome / Edge / Node 18+ 都有。

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('這個瀏覽器不支援 DecompressionStream，無法讀取 docx');
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * 讀出 ZIP 裡的檔案內容（UTF-8 字串）。
 * want(name) 回 true 的才解壓；回傳 Map<檔名, 內容>。
 */
export async function unzipText(buffer, want) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  // 從尾巴找 End Of Central Directory（可能有註解，最多往回找 64KB）
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65558); i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 docx（找不到 ZIP 目錄）');

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder('utf-8');
  const out = new Map();

  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== CEN_SIG) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;

    // 本地檔頭的檔名／extra 長度可能和中央目錄不同，要重讀
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = u8.subarray(start, start + compSize);
    if (method === 0) out.set(name, dec.decode(raw));
    else if (method === 8) out.set(name, dec.decode(await inflateRaw(raw)));
    else throw new Error(`docx 裡的 ${name} 用了不支援的壓縮方式（${method}）`);
  }
  return out;
}
