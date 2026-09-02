// 白板辨識用的提示詞組裝與回覆解析（純字串處理，不打網路）。

export const OUTPUT_SPEC =
  '請只回傳一個 JSON 物件（不要 markdown、不要說明）：' +
  '{"desc":"內容說明（檢驗項目）","design":"設計（標準值）","actual":"實際（實際值）",' +
  '"confidence":0到100的整數（你對三欄都正確的把握），' +
  '"bbox":[白板左上x, 左上y, 寬, 高]（相對整張照片的 0–1 比例；找不到白板就 null）}。' +
  '數值照白板原樣抄（含單位、±、+）；看不清楚的欄位給空字串並降低 confidence。' +
  '若白板列了多個檢驗項目，取有特別標示（圈、勾、箭頭）的那一列；都沒標示就取第一列。';

export function buildPrompt(userPrompt, defaultPrompt) {
  const hint = (userPrompt || '').trim() || defaultPrompt;
  return `這是工地施工自主檢查的照片，畫面裡有一塊手寫白板。${hint}\n${OUTPUT_SPEC}`;
}

function firstJsonObject(text) {
  const s = String(text ?? '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`回覆裡找不到 JSON：${s.slice(0, 200)}`);
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch (e) {
    throw new Error(`回覆的 JSON 解析失敗：${e.message}｜${s.slice(0, 200)}`);
  }
}

function str(v) {
  return v == null ? '' : String(v).trim();
}

function normBbox(b) {
  const arr = Array.isArray(b) ? b : b && typeof b === 'object' ? [b.x, b.y, b.w, b.h] : null;
  if (!arr || arr.length !== 4) return null;
  const [x, y, w, h] = arr.map(Number);
  if ([x, y, w, h].some((n) => !Number.isFinite(n))) return null;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.001 || y + h > 1.001) return null;
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}

/** 模型回覆文字 → { desc, design, actual, confidence, bbox }。三欄全空就視為失敗（大聲失敗）。 */
export function parseResult(text) {
  const j = firstJsonObject(text);
  const out = { desc: str(j.desc), design: str(j.design), actual: str(j.actual) };
  if (!out.desc && !out.design && !out.actual) throw new Error(`模型沒讀到任何欄位：${String(text).slice(0, 200)}`);
  const c = Number(j.confidence);
  out.confidence = Number.isFinite(c) ? Math.max(0, Math.min(100, Math.round(c))) : 0;
  out.bbox = normBbox(j.bbox);
  return out;
}
