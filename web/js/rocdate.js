// 民國日期純邏輯（無 DOM）。規則沿用 V1.0 parse_roc_date。

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * 解析檢查日期 → Date；看不懂就丟錯（錯誤訊息顯示使用者原本打的字，不是清理過的）。
 * 吃三種寫法：
 * - 分隔寫法 `年.月.日`／`年/月/日`／`年-月-日`（也接受 115年6月14日）：民國 3 碼年或西元 4 碼年，月日可不補 0——
 *   `115.6.14` 是文件與輸出用的格式（rocDot），使用者照著打不能被拒（之前去掉點變 115614 六碼就被丟掉）；
 * - 純數字 7 碼（民國 1150725）；
 * - 純數字 8 碼（西元 20260725）。
 */
export function parseRocInput(input) {
  const raw = String(input ?? '').trim();
  let y;
  let m;
  let d;
  const sep = raw.match(/^(\d{3,4})\s*[./\-年]\s*(\d{1,2})\s*[./\-月]\s*(\d{1,2})\s*日?$/);
  const digits = raw.replace(/\D/g, '');
  const pureDigits = digits === raw.replace(/\s/g, '');
  if (sep) {
    y = Number(sep[1]) + (sep[1].length === 3 ? 1911 : 0);
    m = Number(sep[2]);
    d = Number(sep[3]);
  } else if (pureDigits && digits.length === 7) {
    y = Number(digits.slice(0, 3)) + 1911;
    m = Number(digits.slice(3, 5));
    d = Number(digits.slice(5, 7));
  } else if (pureDigits && digits.length === 8) {
    y = Number(digits.slice(0, 4));
    m = Number(digits.slice(4, 6));
    d = Number(digits.slice(6, 8));
  } else {
    throw new Error(`看不懂的日期：${raw}（請用民國格式，例如 1150725 或 115.6.14）`);
  }
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    throw new Error(`日期不存在：${raw}`);
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
