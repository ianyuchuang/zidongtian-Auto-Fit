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

/**
 * 從第一個 { 開始做括號配對，找出對應的 }（略過字串內的括號與跳脫字元）。
 * 模型常在 JSON 後面附說明（說明裡也可能有大括號），用 lastIndexOf('}') 會把說明一起切進來而解析失敗。
 * 回傳結束位置（含）；配不到就回 -1。
 */
function matchBrace(s, start) {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function firstJsonObject(text) {
  const s = String(text ?? '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = s.indexOf('{');
  if (start < 0) throw new Error(`回覆裡找不到 JSON：${s.slice(0, 200)}`);
  const end = matchBrace(s, start);
  if (end < 0) throw new Error(`回覆的 JSON 大括號沒有配對：${s.slice(0, 200)}`);
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch (e) {
    throw new Error(`回覆的 JSON 解析失敗：${e.message}｜${s.slice(0, 200)}`);
  }
}

/** 三個文字欄只收字串／數字；模型回物件或陣列就大聲失敗，不要靜靜變成 "[object Object]"。 */
function str(v, key) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  throw new Error(`欄位 ${key} 不是文字：${JSON.stringify(v).slice(0, 100)}`);
}

/**
 * confidence → 0–100 整數。模型可能回 0–1 小數（0.85 → 85）、百分比字串（"85%" → 85）或 0–100 整數；
 * 解析不出來給 0。0 < c < 1 視為比例（×100）；剛好 1 分不出是 1% 還是 100%，維持 1（寧可低估叫人校對）。
 */
export function normConfidence(v) {
  let c = v;
  if (typeof c === 'string') c = c.trim().replace(/%$/, '');
  c = Number(c);
  if (!Number.isFinite(c)) return 0;
  if (c > 0 && c < 1) c *= 100;
  return Math.max(0, Math.min(100, Math.round(c)));
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
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error(`回覆的 JSON 不是物件：${String(text).slice(0, 200)}`);
  const out = { desc: str(j.desc, 'desc'), design: str(j.design, 'design'), actual: str(j.actual, 'actual') };
  if (!out.desc && !out.design && !out.actual) throw new Error(`模型沒讀到任何欄位：${String(text).slice(0, 200)}`);
  out.confidence = normConfidence(j.confidence);
  out.bbox = normBbox(j.bbox);
  return out;
}
