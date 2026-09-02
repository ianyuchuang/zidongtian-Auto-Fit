// 檔名相關純邏輯（無 DOM）：副檔名判斷、忽略規則、「內容說明-設計-實際」解析、自然排序。
// 規則沿用 V1.0 self_check_core.py。

export const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tif', '.tiff', '.webp']);

/** 拆檔名與副檔名：'a.b.jpg' → ['a.b', '.jpg'] */
export function splitExt(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0) return [name, ''];
  return [name.slice(0, i), name.slice(i)];
}

/** 是否為要處理的照片檔（略過 Office 暫存檔 ~$、隱藏檔、Thumbs.db、非圖片）。 */
export function isPhotoName(name) {
  if (!name || name.startsWith('~$') || name.startsWith('.')) return false;
  if (name.toLowerCase() === 'thumbs.db') return false;
  const [, ext] = splitExt(name);
  return IMG_EXTS.has(ext.toLowerCase());
}

/**
 * 解析「內容說明-設計-實際.jpg」。從右邊切兩個「-」（與 Python rsplit('-', 2) 相同），
 * 不符格式回傳 null。
 */
export function parsePhotoName(name) {
  const [base] = splitExt(name);
  const j = base.lastIndexOf('-');
  if (j < 0) return null;
  const i = base.lastIndexOf('-', j - 1);
  if (i < 0) return null;
  return {
    desc: base.slice(0, i).trim(),
    design: base.slice(i + 1, j).trim(),
    actual: base.slice(j + 1).trim(),
  };
}

/** 反向：三欄組回檔名。 */
export function buildPhotoName(desc, design, actual, ext) {
  return `${desc.trim()}-${design.trim()}-${actual.trim()}${ext}`;
}

/** 自然排序 key：數字依大小、文字不分大小寫。 */
export function naturalKey(s) {
  return s.split(/(\d+)/).filter((t) => t !== '').map((t) => (/^\d+$/.test(t) ? Number(t) : t.toLowerCase()));
}

export function naturalCompare(a, b) {
  const ka = naturalKey(a);
  const kb = naturalKey(b);
  const n = Math.min(ka.length, kb.length);
  for (let i = 0; i < n; i++) {
    const x = ka[i];
    const y = kb[i];
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    if (typeof x === 'number') return -1; // 數字排在文字前
    if (typeof y === 'number') return 1;
    return x < y ? -1 : 1;
  }
  return ka.length - kb.length;
}
