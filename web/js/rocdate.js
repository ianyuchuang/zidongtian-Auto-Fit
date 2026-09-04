// 民國日期純邏輯（無 DOM）。規則沿用 V1.0 parse_roc_date。

const pad2 = (n) => String(n).padStart(2, '0');

/** 解析 '1150725'（民國）、'115/07/25'、'2026-07-25'（西元）→ Date；看不懂就丟錯。 */
export function parseRocInput(input) {
  const s = String(input ?? '').replace(/\D/g, '');
  let y;
  let m;
  let d;
  if (s.length === 7) {
    y = Number(s.slice(0, 3)) + 1911;
    m = Number(s.slice(3, 5));
    d = Number(s.slice(5, 7));
  } else if (s.length === 8) {
    y = Number(s.slice(0, 4));
    m = Number(s.slice(4, 6));
    d = Number(s.slice(6, 8));
  } else {
    throw new Error(`看不懂的日期：${input}（請用民國格式，例如 1150725）`);
  }
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    throw new Error(`日期不存在：${input}`);
  }
  return date;
}

/** '1150725' */
export function rocCompact(date) {
  return `${date.getFullYear() - 1911}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

/** '115年07月25日' */
export function rocDisplay(date) {
  return `${date.getFullYear() - 1911}年${pad2(date.getMonth() + 1)}月${pad2(date.getDate())}日`;
}

/** 表格「拍照日期」欄用的寫法 '115.7.25'（月日不補 0，照樣本檔） */
export function rocDot(date) {
  return `${date.getFullYear() - 1911}.${date.getMonth() + 1}.${date.getDate()}`;
}

/** 照片左下角日期戳 '2026-07-25' */
export function stampText(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayRoc(now = new Date()) {
  return rocCompact(now);
}
