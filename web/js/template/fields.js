// 說明欄位的辨識規則：哪些字是「欄位名」、對應到哪個資料來源。
// docx（parse.js）與 xlsx（parse-xlsx.js）兩支解析器共用同一套判斷，只寫這一份。

/** 看起來像日期的字（抬頭與照片日期戳都用它比對）。 */
export const DATE_RE = /\d{2,4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{2,3}\.\d{1,2}\.\d{1,2}/;

// 欄位名 → 資料來源。由上而下比對，先中先算。
const FIELD_BY_LABEL = [
  [/設\s*計|標準值/, 'design'],
  [/實\s*際/, 'actual'],
  [/編\s*號/, 'seq'],
  [/日\s*期/, 'photoDate'],
  [/說\s*明/, 'desc'],
];

// 沒有冒號、但本身就是欄位名的字（例：照片編號、拍照日期、圖片說明）
const BARE_LABEL = /^(照片編號|編號|拍照日期|日期|圖片說明|內容說明|說明|設\s*計|標準值|實\s*際|實際值)$/;

export const guessField = (label) => FIELD_BY_LABEL.find(([re]) => re.test(label))?.[1] ?? null;

/** 一行文字拆成「欄位名 + 值」；label 是要照印的字，rest 是這份樣本裡的值（會被丟掉）。 */
export function splitLine(t) {
  const m = t.match(/^(\s*[^：:]{1,12}[：:])\s*([\s\S]*)$/);
  if (m) return { label: m[1], rest: m[2].trim() };
  if (BARE_LABEL.test(t.trim())) return { label: t, rest: '' };
  return { label: '', rest: t };
}
