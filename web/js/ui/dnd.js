// 表格 / 左樹共用：拖曳資料格式、讀 drop 的 id 清單、搬移結果提示。

import { moveSummary } from '../state.js';
import { toast } from './dialog.js';

export const DND_MULTI = 'text/autofit-photos'; // JSON 陣列：多張 id
export const DND_SINGLE = 'text/autofit-photo';

/** 讀 drop 的 id 清單（多張優先，其次單張）。 */
export function dropIds(dt) {
  const multi = dt.getData(DND_MULTI);
  if (multi) {
    try {
      const ids = JSON.parse(multi);
      if (Array.isArray(ids) && ids.length) return ids;
    } catch (e) {
      /* 落回單張 */
    }
  }
  const one = dt.getData(DND_SINGLE);
  return one ? [one] : [];
}

/** 搬移 / 刪除結果的提示。r = app.moveManyToDir / app.trash 的回傳。 */
export function reportMove(app, r, dirName) {
  const msg = moveSummary(r, dirName, { readOnly: app.state.readOnly });
  toast(msg, { error: r.failed.length > 0, ms: r.failed.length ? 6000 : 3500 });
}

/**
 * 把一塊區域變成可拖放檔案的區域（入口頁選資料夾、版型調整頁拖 docx 共用）。
 * 會擋掉冒泡，所以小區塊（例：版型框）綁的處理會蓋過外層整頁的處理。
 */
export function bindFileDrop(zone, onDrop) {
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.add('over');
  });
  // 滑進子元素也會發 dragleave（接著子元素再發 dragover），只在真的離開整個區塊時才拿掉 over，
  // 否則框線一直閃。relatedTarget 是要進去的元素，還在 zone 裡就不算離開。
  zone.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && zone.contains(e.relatedTarget)) return;
    zone.classList.remove('over');
  });
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('over');
    try {
      await onDrop(e.dataTransfer);
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
}

/**
 * 入口頁拖進來的東西該當成什麼（純邏輯，好測）。
 * isDirectory：拖進來的是資料夾嗎；fileName：檔案的名字（沒有就給 null）。
 */
export function classifyDrop({ isDirectory = false, fileName = null } = {}) {
  if (isDirectory) return 'folder';
  if (fileName && /\.docx$/i.test(fileName)) return 'template';
  if (fileName && /\.doc$/i.test(fileName)) return 'old-doc';
  if (fileName) return 'other-file';
  return 'unsupported';
}

/**
 * 把拖進來的 item 整理成 classifyDrop 要的形狀（純邏輯，好測）。
 * handle：getAsFileSystemHandle 的結果（只有安全內容環境才有）；entry：webkitGetAsEntry 的結果；
 * fileName：dt.files[0].name。http 內網位址沒有 handle，Chrome 會把資料夾當成同名的 File
 * 放進 dt.files，只看 fileName 會誤判成「其他檔案」而拒收（2026-09-04 同事內網回報），
 * 所以有 handle 看 handle.kind，沒有就看 entry.isDirectory。
 */
export function dropKind({ handle = null, entry = null, fileName = null } = {}) {
  const isDirectory = handle ? handle.kind === 'directory' : entry?.isDirectory === true;
  return { isDirectory, fileName: handle?.name ?? entry?.name ?? fileName };
}

/**
 * 一次拖進來的東西裡有幾個是資料夾（純邏輯）。entries：每個 item 的 webkitGetAsEntry() 結果。
 * 入口頁一次只收一個資料夾，超過一個要明講，不能靜靜只拿第一個。
 */
export function countDroppedDirs(entries) {
  return (entries ?? []).filter((e) => e?.isDirectory === true).length;
}
