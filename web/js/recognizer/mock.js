// 模擬辨識：不看照片內容，依檔名產生固定（可重現）的假結果，用來測 UI 流程。

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

const ITEMS = ['帷幕骨架水平間距', '帷幕骨架垂直間距', '帷幕骨架焊道長度', '錨栓埋設深度', '鋼梁安裝水平度'];
const DESIGNS = ['1100mm±10', '2860mm±5', '90mm+90mm', '120mm', '3mm/m'];
const ACTUALS = ['1100mm', '2860mm', '90mm+90mm', '121mm', '2mm/m'];

export const mockRecognizer = {
  id: 'mock',
  label: '模擬辨識（測試介面用，不會真的看照片）',
  available: true,
  note: '假資料，只為了測流程',
  async recognize(file, ctx = {}) {
    await new Promise((r) => setTimeout(r, ctx.delayMs ?? 250));
    const h = hash(file.name);
    const i = h % ITEMS.length;
    const confidence = 55 + (h % 41); // 55–95
    const floor = (ctx.folderName || '').replace(/[\\/]/g, '');
    return {
      desc: `${floor}${ITEMS[i]}`,
      design: DESIGNS[i],
      actual: ACTUALS[i],
      confidence,
      bbox: { x: 0.18 + ((h >> 8) % 10) / 100, y: 0.3 + ((h >> 12) % 10) / 100, w: 0.5, h: 0.38 },
    };
  },
};
