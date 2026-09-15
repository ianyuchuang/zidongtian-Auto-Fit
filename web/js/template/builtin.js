// 內建版型：web/templates/ 底下的版面樣本，版型頁最頂端列出來，點一下就能用。
// 那些檔案由 tools/make_template_fixtures.py 從實際自檢表抽出並匿名（案名、公司名換成「範例…」），
// 和 tests/js/template-parse*.test.mjs 用的是同一份，所以解析器改壞了測試會先叫。
//
// 檔案是拆開的 XML（document.xml／sheet.xml…）而不是 docx／xlsx，所以這裡直接用
// parseTemplate／parseXlsxTemplate 這兩個 XML 層的入口，不經過 unzip。

import { parseTemplate } from './parse.js';
import { parseXlsxTemplate } from './parse-xlsx.js';
import { lineParts } from './spec.js';

/** web/templates/ 的位置（相對 import.meta.url 算，GitHub Pages 的子路徑也對）。 */
export const BUILTIN_BASE = new URL('../../templates/', import.meta.url);

/**
 * 版面指紋：只看「版面」——頁面大小邊界、格線、每一格的結構與欄位順序、照片框、日期戳。
 * **不看名稱，也不看格子裡實際的字**（抬頭寫哪個案名、說明前面冠什麼字都不算），
 * 所以同一種版面被存成好幾個檔時指紋會一樣，列出來時只留一份。
 */
export function layoutKey(spec) {
  if (!spec) return '';
  const p = spec.page ?? {};
  const m = p.margin ?? {};
  const g = spec.grid ?? {};
  // 一行只留「文字／欄位／換行」的排法，文字內容本身丟掉
  const line = (l) => lineParts(l).map((x) => (x.br ? '¶' : x.text != null ? 't' : `f:${x.field}`)).join('');
  const cell = (c) =>
    [c.kind, c.col ?? 0, c.colSpan ?? 1, c.rowSpan ?? 1, c.sizePt ?? '', c.align ?? '', c.vAlign ?? '', (c.lines ?? []).map(line).join('|')].join(',');
  return JSON.stringify({
    page: [p.w, p.h, p.orient, m.t, m.r, m.b, m.l],
    heading: [spec.heading?.place, (spec.heading?.lines ?? []).map((l) => [l.sizePt, !!l.bold, l.align ?? ''])],
    grid: [g.perRow, g.blockRows, g.order, g.seq ?? null, g.tableIndent ?? 0],
    photo: [Math.round(spec.photo?.h ?? 0), Math.round(spec.photo?.maxW ?? 0)],
    caption: spec.caption?.sizePt ?? null,
    stamp: [!!spec.stamp?.on, spec.stamp?.corner ?? ''],
    block: [(spec.block?.cols ?? []), (spec.block?.rows ?? []).map((r) => [r.h ?? null, (r.cells ?? []).map(cell)])],
  });
}

/**
 * 版面相同的只留第一份，被蓋掉的名字記在留下那份的 `dupes` 裡——
 * 少列一份要看得見原因，不能靜靜消失。
 */
export function dedupeByLayout(items) {
  const byKey = new Map();
  const out = [];
  for (const it of items) {
    const key = layoutKey(it.spec);
    const kept = byKey.get(key);
    if (kept) {
      kept.dupes.push(it.name);
      continue;
    }
    const entry = { ...it, key, dupes: [] };
    byKey.set(key, entry);
    out.push(entry);
  }
  return out;
}

const text = async (fetchFn, url) => {
  const r = await fetchFn(url);
  if (!r.ok) throw new Error(`讀不到 ${url}（HTTP ${r.status}）`);
  return r.text();
};

/** 一筆 index.json 的項目 → LayoutSpec。files 沒列到的就是這份沒有（例如 b、c 沒有頁首）。 */
async function parseOne(base, entry, fetchFn) {
  const files = new Set(entry.files ?? []);
  const read = async (n) => (files.has(n) ? text(fetchFn, new URL(`${entry.slug}/${n}`, base)) : null);
  const name = entry.name || entry.slug;
  if (entry.kind === 'xlsx') {
    return parseXlsxTemplate({
      sheetXml: await read('sheet.xml'),
      sharedStringsXml: await read('sharedStrings.xml'),
      stylesXml: await read('styles.xml'),
      drawingXml: await read('drawing.xml'),
      name,
    });
  }
  return parseTemplate({ documentXml: await read('document.xml'), headerXml: await read('header.xml'), name });
}

/**
 * 讀 web/templates/index.json，逐份解析成 LayoutSpec，版面相同的只留一份。
 * 回傳 [{ slug, name, kind, spec, key, dupes }]。
 *
 * index.json 讀不到就丟錯（呼叫端把整區藏起來——用 file:// 開或沒有這個資料夾時就是這樣）；
 * 個別一份解析失敗只記 console 並跳過，一份壞掉不拖垮其他份。
 */
export async function loadBuiltins({ base = BUILTIN_BASE, fetchFn = globalThis.fetch } = {}) {
  if (typeof fetchFn !== 'function') throw new Error('這個環境沒有 fetch，讀不了內建版型');
  const idx = JSON.parse(await text(fetchFn, new URL('index.json', base)));
  const out = [];
  for (const entry of idx.templates ?? []) {
    if (!entry?.slug) continue;
    try {
      out.push({ slug: entry.slug, name: entry.name || entry.slug, kind: entry.kind ?? 'docx', spec: await parseOne(base, entry, fetchFn) });
    } catch (e) {
      console.warn(`內建版型「${entry.slug}」讀不起來，先跳過`, e);
    }
  }
  return dedupeByLayout(out);
}
