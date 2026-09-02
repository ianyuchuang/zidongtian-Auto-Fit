// 影像處理（瀏覽器 canvas）：縮圖、白板裁切、Word 用重繪（縮小 + 左下角日期戳）。
// createImageBitmap 預設會依 EXIF 方向轉正（V1.0 的 python-docx 沒有處理這點）。

async function bitmapOf(file, opts) {
  try {
    return await createImageBitmap(file, opts);
  } catch (e) {
    throw new Error(`無法讀取照片 ${file.name}：${e.message}`);
  }
}

function toBlob(canvas, type = 'image/jpeg', quality = 0.86) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob 失敗'))), type, quality);
  });
}

/** 縮圖（object URL）。 */
export async function makeThumbUrl(file, width = 120) {
  const bmp = await bitmapOf(file, { resizeWidth: width, resizeQuality: 'medium' });
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close();
  return URL.createObjectURL(await toBlob(c, 'image/jpeg', 0.8));
}

/** 依相對 bbox {x,y,w,h}（0–1）從原圖裁出白板區域（object URL）。 */
export async function makeCropUrl(file, bbox) {
  const bmp = await bitmapOf(file);
  const sx = Math.max(0, Math.floor(bbox.x * bmp.width));
  const sy = Math.max(0, Math.floor(bbox.y * bmp.height));
  const sw = Math.min(bmp.width - sx, Math.ceil(bbox.w * bmp.width));
  const sh = Math.min(bmp.height - sy, Math.ceil(bbox.h * bmp.height));
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  bmp.close();
  return URL.createObjectURL(await toBlob(c, 'image/jpeg', 0.9));
}

/**
 * 給 LLM API 用：長邊縮到 maxSide 的 JPEG，轉成 base64 字串。
 * 回傳 { data, mimeType: 'image/jpeg', width, height }。
 */
export async function encodeJpegBase64(file, maxSide = 1500, quality = 0.9) {
  const bmp = await bitmapOf(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const buf = new Uint8Array(await (await toBlob(c, 'image/jpeg', quality)).arrayBuffer());
  return { data: bytesToBase64(buf), mimeType: 'image/jpeg', width: c.width, height: c.height };
}

/** Uint8Array → base64（分段 btoa，避免一次 spread 幾 MB 爆堆疊）。 */
export function bytesToBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export async function imageSize(file) {
  const bmp = await bitmapOf(file);
  const r = { width: bmp.width, height: bmp.height };
  bmp.close();
  return r;
}

/**
 * 產生要放進 Word 的圖：長邊縮到 maxSide、左下角疊白字黑影日期（對應 V1.0 的日期文字框）。
 * 回傳 { data: ArrayBuffer, width, height, type: 'jpg' }。
 */
export async function renderForDocx(file, { maxSide = 1600, stamp = '' } = {}) {
  const bmp = await bitmapOf(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  if (stamp) {
    const fontPx = Math.max(12, Math.round(h * 0.045));
    ctx.font = `${fontPx}px Arial, sans-serif`;
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = fontPx * 0.35;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.fillText(stamp, Math.round(fontPx * 0.5), h - Math.round(fontPx * 0.45));
  }
  const blob = await toBlob(c, 'image/jpeg', 0.9);
  return { data: await blob.arrayBuffer(), width: w, height: h, type: 'jpg' };
}
