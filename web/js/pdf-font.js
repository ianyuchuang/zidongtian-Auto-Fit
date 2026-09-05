// PDF 要嵌的中文字型：先跟瀏覽器要這台電腦裡的那一套（跟 Word 輸出同一個字，字形才一致），
// 拿不到才退回 vendor/fonts/ 裡打包的全字庫正楷體（TW-Kai，政府資料開放授權）。
// 讀本機字型用 Chrome / Edge 的 queryLocalFonts()，第一次會跳授權；必須在使用者的
// 點擊事件裡呼叫，所以 UI 是在「同時產出 PDF」打勾時就先要，不是等按下產生才要。

export const FALLBACK_URL = 'vendor/fonts/TW-Kai-98_1.ttf';
export const FALLBACK_LABEL = '全字庫正楷體 TW-Kai';

/** 同一套字在不同系統／不同名稱欄位上的叫法。 */
export const ALIASES = {
  標楷體: ['DFKai-SB', 'BiauKai', 'Kaiti TC', 'TW-Kai', '全字庫正楷體'],
  新細明體: ['PMingLiU', 'MingLiU'],
  細明體: ['MingLiU'],
  微軟正黑體: ['Microsoft JhengHei', 'Microsoft JhengHei UI'],
};

/** 要找的字型名稱（原名 + 別名），去重後照優先順序。 */
export function fontCandidates(family) {
  const base = String(family ?? '').trim();
  return [...new Set([base, ...(ALIASES[base] ?? [])].filter(Boolean))];
}

/** 從 queryLocalFonts() 的清單裡挑出要的那一筆（family / fullName / postscriptName 任一相符）。 */
export function matchFontData(list, family) {
  for (const want of fontCandidates(family).map((s) => s.toLowerCase())) {
    const hit = (list ?? []).find((f) => [f.family, f.fullName, f.postscriptName].some((n) => String(n ?? '').toLowerCase() === want));
    if (hit) return hit;
  }
  return null;
}

const cache = new Map();

/**
 * 取得字型位元組。回傳 { bytes: Uint8Array, label, source: 'local' | 'bundled', notes: [] }。
 * 兩邊都拿不到就丟 Error（不要靜靜換一套字出去）。
 */
export async function loadPdfFont(family) {
  if (cache.has(family)) return cache.get(family);
  const r = await resolve(family);
  cache.set(family, r);
  return r;
}

async function resolve(family) {
  const notes = [];
  if (typeof globalThis.queryLocalFonts === 'function') {
    try {
      const hit = matchFontData(await globalThis.queryLocalFonts(), family);
      if (hit) {
        const bytes = new Uint8Array(await (await hit.blob()).arrayBuffer());
        return { bytes, label: hit.fullName || hit.family, source: 'local', notes };
      }
      notes.push(`這台電腦找不到「${family}」`);
    } catch (e) {
      notes.push(`讀本機字型失敗（${e.message}）`);
    }
  } else {
    notes.push('這個瀏覽器不能讀本機字型（需要 Chrome / Edge 103 以上）');
  }
  let res;
  try {
    res = await fetch(FALLBACK_URL);
  } catch (e) {
    throw new Error(`${notes.join('；')}；備用字型也讀不到（${e.message}）`);
  }
  if (!res.ok) {
    throw new Error(`${notes.join('；')}；備用字型也讀不到：${FALLBACK_URL} 回 ${res.status}。請到全字庫下載 TW-Kai-98_1.ttf 放進 web/vendor/fonts/。`);
  }
  return { bytes: new Uint8Array(await res.arrayBuffer()), label: FALLBACK_LABEL, source: 'bundled', notes };
}
