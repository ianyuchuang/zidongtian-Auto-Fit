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

/** 聚到游標右下角後，第 i 張卡片相對游標的位移（往右下疊，最多疊 maxCards 張）。 */
export function stackOffset(i, { dx = 18, dy = 18, step = 4 } = {}) {
  return { x: dx + i * step, y: dy + i * step };
}

/**
 * 多張一起拖：瀏覽器的拖曳影像是一張死圖，做不出動畫，所以換成透明影像，
 * 自己在 body 上疊一層跟著游標走的縮圖堆——每張縮圖從它在表格裡的位置飛到游標右下角聚成一疊，
 * 右上角標總張數（含被篩選隱藏、畫面上沒有縮圖的）。回傳 stop()，dragend 時呼叫。
 * e：dragstart 事件；thumbs：畫面上看得到的縮圖 <img>（依表格順序）；count：總張數。
 */
export function startDragStack(e, thumbs, count, { maxCards = 4 } = {}) {
  // 透明拖曳影像：元素要在 DOM 裡瀏覽器才拍得到，拍完（下一輪）就拿掉
  const blank = document.createElement('div');
  blank.style.cssText = 'position:fixed;top:-10px;left:-10px;width:1px;height:1px;opacity:0;';
  document.body.appendChild(blank);
  e.dataTransfer.setDragImage(blank, 0, 0);
  setTimeout(() => blank.remove(), 0);

  const layer = document.createElement('div');
  layer.className = 'drag-stack';
  let x = e.clientX;
  let y = e.clientY;
  const place = () => {
    layer.style.transform = `translate(${x}px, ${y}px)`;
  };
  place();
  const cards = thumbs.slice(0, maxCards).map((img, i) => {
    const r = img.getBoundingClientRect();
    const card = document.createElement('div');
    card.className = 'ds-card';
    if (img.getAttribute('src')) card.style.backgroundImage = `url("${img.src}")`;
    card.style.zIndex = String(maxCards - i);
    card.style.transform = `translate(${r.left - x}px, ${r.top - y}px)`; // 起點：表格上原本的位置
    layer.appendChild(card);
    return card;
  });
  const badge = document.createElement('span');
  badge.className = 'ds-count';
  badge.textContent = String(count);
  layer.appendChild(badge);
  document.body.appendChild(layer);

  // 先逼瀏覽器把起點算進樣式，再設終點，transition 才會動起來（不靠 requestAnimationFrame：分頁在背景時它不跑）
  void layer.offsetWidth;
  cards.forEach((c, i) => {
    const o = stackOffset(i);
    c.style.transform = `translate(${o.x}px, ${o.y}px)`;
  });
  const last = stackOffset(Math.max(0, cards.length - 1));
  badge.style.transform = `translate(${last.x + 44}px, ${last.y - 8}px)`;
  layer.classList.add('gathered');

  // 拖曳中 mousemove 不會發，只有 dragover；掛在 document 的捕獲階段，哪個元素擋掉冒泡都收得到
  const onOver = (ev) => {
    if (ev.clientX === 0 && ev.clientY === 0) return; // 部分情況（拖出視窗）會給 0,0
    x = ev.clientX;
    y = ev.clientY;
    place();
  };
  document.addEventListener('dragover', onOver, true);
  const stop = () => {
    detach();
    document.removeEventListener('dragover', onOver, true);
    layer.remove();
  };
  const detach = onDragFinish(document, e.target, stop);
  return stop;
}

/**
 * 拖曳結束（放下或取消）時呼叫 fn 一次。不能只靠呼叫端在外層接 dragend：
 * 放下後表格／左樹會重畫，被拖的那一列已經不在 DOM 裡，它的 dragend 冒泡不到外層，
 * 縮圖堆就一直懸在畫面上（2026-09-23 的 bug）。所以放下時在 doc 的捕獲階段先收，
 * 取消（沒放在任何地方）時由來源元素自己的 dragend 收。回傳 detach()。
 */
export function onDragFinish(doc, source, fn) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    detach();
    fn();
  };
  const detach = () => {
    doc.removeEventListener('drop', finish, { capture: true });
    source?.removeEventListener('dragend', finish);
  };
  doc.addEventListener('drop', finish, { capture: true });
  source?.addEventListener('dragend', finish);
  return detach;
}

/**
 * 把一塊區域變成可拖放檔案的區域（入口頁選資料夾、版型頁拖 docx／xlsx 共用）。
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
  if (fileName && /\.(docx|xlsx)$/i.test(fileName)) return 'template';
  if (fileName && /\.(doc|xls)$/i.test(fileName)) return 'old-office';
  if (fileName) return 'other-file';
  return 'unsupported';
}

/** 版型檔的格式：'docx'｜'xlsx'；不是版型檔就回 null。 */
export function templateKind(fileName) {
  const m = /\.(docx|xlsx)$/i.exec(String(fileName ?? ''));
  return m ? m[1].toLowerCase() : null;
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
