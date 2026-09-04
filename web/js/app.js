// 應用狀態與動作（不碰 DOM）。UI 模組訂閱 app.subscribe() 並呼叫這裡的動作。

import { scanTree, flattenDirs, findDir, moveFile, createDir, ensureDir, writeFile } from './fs/adapter.js';
import { parsePhotoName } from './filename.js';
import {
  STATUS,
  statusFromResult,
  fieldWarnings,
  sortPhotos,
  filterPhotos,
  counts,
  reorderWithinDir,
  assignOrder,
  nextPendingReview,
  TRASH_DIR,
  isTrashDir,
  isTrashed,
  trashDirOf,
  ownerOfTrash,
  groupDirOf,
  pruneChecked,
} from './state.js';
import { loadSaved, savePhotos, applySaved, loadDates, saveDates } from './storage.js';
import { makeThumbUrl, makeCropUrl, usableBbox } from './imaging.js';
import { getRecognizer } from './recognizer/index.js';
import { planExport, exportWarnings, outputFileName } from './docx-model.js';
import { buildDocxBlob } from './docx-export.js';
import { rocCompact, rocDisplay, rocDot, stampText, parseRocInput } from './rocdate.js';

/** 辨識引擎識別字串：存進校對暫存，換引擎重開時用來判斷舊的 AI 結果要不要重跑。 */
export function engineId(recognizerId, api) {
  return recognizerId === 'api' ? `api:${api?.provider ?? '?'}` : recognizerId;
}

export function createApp() {
  const listeners = new Set();
  const state = {
    page: 'entry',
    root: null, // 根資料夾 handle（入口頁選到就存進來，不是按了「開始讀取」才有）
    rootLabel: '', // 入口頁要顯示的名稱（範例是「XXX（範例）」，跟 handle.name 不一定一樣）
    rootSummary: null, // 掃過一次的子資料夾摘要，回入口頁不必再掃一次；null＝要重掃
    readOnly: false, // 記憶體複本（範例 / 不支援 File System Access API）
    tree: null,
    dirs: [], // flattenDirs(tree)
    photos: [],
    date: new Date(), // 預設日期（新資料夾沿用）
    dates: {}, // 各資料夾自己的檢查日期：{ 資料夾路徑: '1150725' }
    template: null, // {name, file, spec} | null；spec 是解析出來的 LayoutSpec（template/spec.js）
    templateFile: null, // 拖進入口頁、要帶去版型調整頁解析的 docx
    prompt: '',
    recognizerId: null, // 還沒在頂列「AI 辨識」選過辨識方式；選過就留著（回首頁再讀取也不清）
    api: null, // LLM API 設定 {provider, apiKey, model}（只在記憶體，不存進校對暫存）
    engine: null, // 辨識引擎識別（'mock' / 'api:claude'…），存進暫存以便換引擎時重跑；null＝還沒選
    selectedId: null,
    dirFilter: null, // 左樹點選的資料夾路徑；null = 全部
    chip: 'all',
    query: '',
    collapsed: new Set(),
    checked: new Set(), // 勾選的照片 id（多選：批次搬移 / 刪除）
    recognizing: false,
    progress: null, // 辨識進度 { done, total, stop, name }
  };

  const emit = (what) => {
    for (const fn of listeners) fn(what, state);
  };
  const save = () => {
    if (state.root) savePhotos(state.root.name, state.photos);
  };
  const byId = (id) => state.photos.find((p) => p.id === id) || null;
  /** 釋放照片上的 object URL 並清成 null，之後要用時會重做（Node 測試環境沒有 blob URL，守住）。 */
  const dropUrls = (p, keys) => {
    for (const k of keys) {
      if (p[k] && typeof URL?.revokeObjectURL === 'function') URL.revokeObjectURL(p[k]);
      p[k] = null;
    }
  };

  const app = {
    state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    // ---------- 查詢 ----------
    photo: byId,
    dirOf(path) {
      return state.dirs.find((d) => d.path === path) || null;
    },
    orderedPhotos() {
      return sortPhotos(
        state.photos,
        state.dirs.map((d) => d.path),
      );
    },
    visiblePhotos() {
      return filterPhotos(app.orderedPhotos(), { chip: state.chip, query: state.query, dir: state.dirFilter });
    },
    counts() {
      return counts(state.photos);
    },
    /** 某個資料夾的檢查日期（沒設過就用預設的今天）。dir 省略＝預設日期。 */
    dateInfo(dir = null) {
      const compact = (dir != null && state.dates[dir]) || rocCompact(state.date);
      let date;
      try {
        date = parseRocInput(compact);
      } catch {
        date = state.date;
      }
      return { compact: rocCompact(date), display: rocDisplay(date), dot: rocDot(date), stamp: stampText(date) };
    },

    // ---------- 開啟資料夾 ----------
    /**
     * 入口頁選好照片資料夾（還沒按「開始讀取」）。一定要存進 state：入口頁離開後會被
     * 拆掉重掛（選完資料夾再拖版型 docx 進來 → 版型調整頁 → 回來），只放在入口頁的
     * 區域變數裡就會忘掉（bug 2026-09-04）。
     */
    pickRoot({ rootHandle, readOnly = false, label = null }) {
      const same = state.root === rootHandle;
      if (!same) state.rootSummary = null; // 換了資料夾，舊摘要不能留
      state.root = rootHandle;
      state.readOnly = readOnly;
      if (label != null) state.rootLabel = label;
      else if (!same) state.rootLabel = rootHandle?.name ?? ''; // 同一個資料夾就別把「（範例）」這種標示洗掉
    },
    /** 記住入口頁掃出來的子資料夾摘要，回入口頁時直接用，不必重掃。 */
    setRootSummary(text) {
      state.rootSummary = text;
    },

    async open({ rootHandle, readOnly = false, template = null, prompt = null, recognizerId = null, api = null }) {
      app.pickRoot({ rootHandle, readOnly });
      state.date = new Date(); // 預設今天；各資料夾可在工作台的群組列各自改
      state.dates = loadDates(rootHandle.name);
      state.template = template;
      // 辨識設定沒帶就沿用目前的（入口頁不帶）：否則「回首頁→再讀取」會把選好的方式／金鑰／提示詞
      // 清掉，而且 engine 變 null 之後 applySaved 就不再比對引擎（bug W3）。
      if (prompt != null) state.prompt = prompt;
      if (recognizerId != null) {
        state.recognizerId = recognizerId;
        state.api = api;
      }
      state.engine = state.recognizerId ? engineId(state.recognizerId, state.api) : null;
      await app.rescan();
      const saved = loadSaved(rootHandle.name);
      const { redo } = applySaved(state.photos, saved, { engine: state.engine });
      state.lastOpen = { redo };
      state.page = 'work';
      // 預選表格上的第一列（照 order 排），不是掃描順序的第一張，否則反白的常常不是最上面那列
      state.selectedId = app.visiblePhotos()[0]?.id ?? state.photos[0]?.id ?? null;
      emit('page');
      loadThumbs();
      // 辨識不再自動開跑：使用者進工作台後自己按頂列的「🤖 AI 辨識」，
      // 在那裡才選辨識方式與提示詞（沒有 AI 也能純手打三欄）。
    },

    /**
     * 設定這次要用的辨識方式（頂列「AI 辨識」對話框按下確定時呼叫）。
     * 只發 'engine'：這裡沒有換頁，發 'page' 會害 main.js 重掛整個工作台，
     * 拆掉的那一輪 history.back() 又被新掛上的 popstate 接到 → 直接跳回首頁（bug 2026-09-03）。
     */
    setRecognizer({ recognizerId, api = null, prompt = '' }) {
      state.recognizerId = recognizerId;
      state.api = api;
      state.prompt = prompt;
      state.engine = engineId(recognizerId, api);
      emit('engine');
    },

    /** 還沒辨識出結果的照片（待辨識＋辨識失敗；不含回收桶）。失敗的也算，否則「尚未辨識」範圍永遠補不到它們（bug W11）。 */
    pendingPhotos() {
      return state.photos.filter((p) => (p.status === STATUS.PENDING || p.status === STATUS.ERROR) && !isTrashed(p));
    },
    /** 可以重跑的照片（不含回收桶；預設不含已確認的，避免把校對成果洗掉）。 */
    redoablePhotos({ includeConfirmed = false } = {}) {
      return state.photos.filter((p) => !isTrashed(p) && (includeConfirmed || p.status !== STATUS.CONFIRMED));
    },
    stopRecognize() {
      if (state.progress) state.progress.stop = true;
    },

    /** 重新掃描資料夾樹（保留已有照片的欄位內容）。 */
    async rescan() {
      const tree = await scanTree(state.root);
      const dirs = flattenDirs(tree);
      const old = new Map(state.photos.map((p) => [p.path, p]));
      const photos = [];
      for (const d of dirs) {
        d.node.files.forEach((f, i) => {
          const prev = old.get(f.path);
          if (prev) {
            prev.handle = f.handle;
            prev.file = null;
            photos.push(prev);
            return;
          }
          const parsed = parsePhotoName(f.name);
          photos.push({
            id: f.path,
            name: f.name,
            path: f.path,
            dir: d.path,
            handle: f.handle,
            file: null,
            desc: parsed?.desc ?? '',
            design: parsed?.design ?? '',
            actual: parsed?.actual ?? '',
            confidence: null,
            source: parsed ? 'filename' : null,
            status: parsed ? STATUS.PARSED : STATUS.PENDING,
            bbox: null,
            thumbUrl: null,
            fullUrl: null,
            cropUrl: null,
            order: i,
          });
        });
      }
      state.tree = tree;
      state.dirs = dirs;
      state.photos = photos;
      if (pruneChecked(state.checked, photos)) emit('checked');
      emit('tree');
      emit('photos');
    },

    async fileOf(p) {
      if (!p.file) p.file = await p.handle.getFile();
      return p.file;
    },
    async fullUrl(p) {
      if (!p.fullUrl) p.fullUrl = URL.createObjectURL(await app.fileOf(p));
      return p.fullUrl;
    },
    /** 白板對照圖。框不合理（框到整張／小到不像白板）就不裁，右欄會說明原因。 */
    async cropUrl(p) {
      if (!usableBbox(p.bbox)) return null;
      if (!p.cropUrl) p.cropUrl = await makeCropUrl(await app.fileOf(p), p.bbox);
      return p.cropUrl;
    },

    // ---------- 辨識 ----------
    /**
     * 跑辨識。photos 不給就跑所有「待辨識」的。
     * 進行中會發 'recognize-progress'（給進度條用）；stopRecognize() 可中止。
     * 送出前先記下三欄與狀態，回來時若跟當初不一樣代表使用者自己動過了，
     * 就只補 bbox / 信心，不覆蓋他打的字與「已確認」（回歸：bug清單 A1）。
     * 排隊時就已經「已確認」的一律不重跑，除非呼叫端明講 includeConfirmed（介面規格的勾選項）；
     * 呼叫端算範圍時漏掉這條也不會把校對成果洗掉（bug W5）。
     */
    async recognizeAll({ photos = null, includeConfirmed = false } = {}) {
      if (state.recognizing) return { done: 0, failed: [], stopped: false };
      const rec = getRecognizer(state.recognizerId);
      const targets = (photos ?? app.pendingPhotos()).filter((p) => !isTrashed(p) && (includeConfirmed || p.status !== STATUS.CONFIRMED));
      if (!targets.length) return { done: 0, failed: [], stopped: false };
      const queue = targets.map((p) => ({ p, before: { status: p.status, desc: p.desc, design: p.design, actual: p.actual } }));
      const progress = { done: 0, total: queue.length, stop: false, name: '' };
      state.progress = progress;
      state.recognizing = true;
      const failed = [];
      const kept = [];
      emit('recognize-progress');
      emit('photos');
      // 這一輪是否已被拆掉：goHome() 會把 state.progress 清成 null（或之後另起一輪）。
      // 拆掉之後 state.photos 已經是空的，再 save() 會把這個資料夾的校對暫存整個洗成空的（bug W1），
      // 所以還在飛的那張回來時只能丟掉，不能再碰 state。
      const torn = () => state.progress !== progress;
      const worker = async () => {
        while (queue.length && !progress.stop) {
          const { p, before } = queue.shift();
          progress.name = p.name;
          try {
            const dir = app.dirOf(p.dir);
            const r = await rec.recognize(await app.fileOf(p), {
              prompt: state.prompt,
              folderName: dir?.name ?? '',
              rootName: state.root.name,
              api: state.api,
            });
            if (torn()) return;
            const touched = p.status !== before.status || p.desc !== before.desc || p.design !== before.design || p.actual !== before.actual;
            p.confidence = r.confidence ?? null;
            p.bbox = r.bbox ?? null;
            dropUrls(p, ['cropUrl']); // 框換了，舊的白板裁切要重做，不然重跑辨識永遠看到舊圖（bug W7）
            p.engine = state.engine;
            p.error = undefined;
            if (touched) {
              kept.push(p); // 使用者已經自己填過／確認過，三欄與狀態原封不動
            } else {
              p.desc = r.desc ?? '';
              p.design = r.design ?? '';
              p.actual = r.actual ?? '';
              p.source = 'ai';
              p.warn = fieldWarnings(p).join('；') || undefined; // 欄位一眼可見的毛病，右欄顯示
              p.status = statusFromResult(p);
            }
          } catch (e) {
            if (torn()) return;
            console.error('辨識失敗', p.name, e);
            p.status = STATUS.ERROR;
            p.engine = state.engine;
            p.error = e.message;
            failed.push(p);
          }
          progress.done += 1;
          save();
          emit('recognize-progress');
          emit('photos');
        }
      };
      await Promise.all([worker(), worker()]);
      if (torn()) return { done: progress.done, failed, kept, stopped: true, total: progress.total };
      state.recognizing = false;
      state.progress = null;
      emit('recognize-progress');
      emit('photos');
      state.lastFailed = failed;
      state.lastKept = kept;
      if (failed.length) emit('recognize-failed');
      return { done: progress.done, failed, kept, stopped: progress.stop, total: progress.total };
    },

    // ---------- 選取 / 篩選 ----------
    select(id) {
      if (state.selectedId === id) return;
      state.selectedId = id;
      emit('selection');
    },
    setChip(chip) {
      state.chip = chip;
      emit('filter');
    },
    setQuery(q) {
      state.query = q;
      emit('filter');
    },
    setDirFilter(path) {
      state.dirFilter = path;
      emit('filter');
    },
    toggleCollapse(dir) {
      if (state.collapsed.has(dir)) state.collapsed.delete(dir);
      else state.collapsed.add(dir);
      emit('filter');
    },

    // ---------- 勾選（多選） ----------
    isChecked(id) {
      return state.checked.has(id);
    },
    setChecked(ids, on) {
      for (const id of ids) {
        if (on) state.checked.add(id);
        else state.checked.delete(id);
      }
      emit('checked');
    },
    toggleChecked(id) {
      app.setChecked([id], !state.checked.has(id));
    },
    clearChecked() {
      if (!state.checked.size) return;
      state.checked.clear();
      emit('checked');
    },
    /** 勾選的照片，依表格順序。 */
    checkedPhotos() {
      return app.orderedPhotos().filter((p) => state.checked.has(p.id));
    },

    // ---------- 編輯 ----------
    setField(id, field, value) {
      const p = byId(id);
      if (!p || !['desc', 'design', 'actual'].includes(field)) return;
      if (p[field] === value) return;
      p[field] = value;
      save();
      emit('photos');
    },
    /** 確認這張並跳下一張待校對。已刪除的不能確認（欄位鎖住、統計不含它）；回傳有沒有確認成功。 */
    confirm(id) {
      const p = byId(id);
      if (!p || isTrashed(p)) return false;
      p.status = STATUS.CONFIRMED;
      save();
      emit('photos');
      app.gotoNextPending(id);
      return true;
    },
    skip(id) {
      return app.gotoNextPending(id);
    },
    /** 跳到下一張待校對；沒有就回 false（呼叫端才能給回饋，而不是靜靜不動）。 */
    gotoNextPending(fromId) {
      const next = nextPendingReview(app.visiblePhotos(), fromId) || nextPendingReview(app.orderedPhotos(), fromId);
      if (!next) return false;
      app.select(next.id);
      return true;
    },
    /** 上一張／下一張；已經到頭或到尾回 false。 */
    stepSelection(delta) {
      const list = app.visiblePhotos();
      if (!list.length) return false;
      const i = list.findIndex((p) => p.id === state.selectedId);
      const j = (i < 0 ? 0 : i) + delta;
      if (j < 0 || j >= list.length) return false;
      app.select(list[j].id);
      return true;
    },
    batchDesign(value, scope) {
      let targets;
      if (scope === 'visible') targets = app.visiblePhotos();
      else if (scope === 'dir') targets = state.photos.filter((p) => groupDirOf(p) === (state.dirFilter ?? ''));
      else targets = state.photos;
      targets = targets.filter((p) => !isTrashed(p)); // 已刪除的不跟著改
      for (const p of targets) p.design = value;
      save();
      emit('photos');
      return targets.length;
    },
    // ---------- 版型調整頁 ----------
    /** 開版型調整頁（入口頁的「讀取版型」）。file 可先帶一份拖進來的 docx。 */
    openTemplatePage(file = null) {
      state.templateFile = file;
      state.page = 'template';
      emit('page');
    },
    /** 調整頁完成：套用版型後回入口頁。tpl 給 null＝改用預設版面。 */
    applyTemplate(tpl) {
      state.template = tpl;
      state.templateFile = null;
      state.page = 'entry';
      emit('page');
    },
    /** 調整頁取消：不動目前的版型，回入口頁。 */
    closeTemplatePage() {
      state.templateFile = null;
      state.page = 'entry';
      emit('page');
    },

    /** 改某個資料夾的檢查日期（民國 7 碼）。dir 是資料夾路徑（根資料夾是 ''）。 */
    setDirDate(dir, compact) {
      // 不合法就丟錯，不要靜靜存下去；合法的一律正規化成民國 7 碼再存——
      // 使用者打西元（20260725）或帶斜線也解得開，但 loadDates 只認 7 碼，原樣存會在重開時被丟掉（bug W4）
      state.dates[dir] = rocCompact(parseRocInput(compact));
      saveDates(state.root?.name ?? '', state.dates);
      emit('date');
    },
    /**
     * 回入口頁。資料夾、版型、提示詞、辨識設定都留著（入口頁會帶回來），
     * 不必為了換個篩選重選一次資料夾；校對結果本來就在 localStorage。
     */
    goHome() {
      app.stopRecognize(); // 瀏覽器「上一頁」也會走到這裡，辨識可能還在跑（bug W1）
      for (const p of state.photos) dropUrls(p, ['thumbUrl', 'fullUrl', 'cropUrl']);
      // rootSummary 清掉：工作台可能搬過／刪過檔案，入口頁要重掃一次才不會顯示舊的張數
      Object.assign(state, { page: 'entry', tree: null, dirs: [], photos: [], selectedId: null, dirFilter: null, chip: 'all', query: '', recognizing: false, progress: null, rootSummary: null });
      state.collapsed = new Set();
      state.checked = new Set();
      emit('page');
    },

    // ---------- 順序 / 搬移 / 資料夾 ----------
    reorder(movingId, targetId, place) {
      const ids = reorderWithinDir(state.photos, movingId, targetId, place);
      if (!ids) return false;
      const order = assignOrder(ids);
      for (const p of state.photos) if (order.has(p.id)) p.order = order.get(p.id);
      save();
      emit('photos');
      return true;
    },
    /** 搬一張到資料夾。同資料夾 / 找不到 → false；搬移失敗丟錯。 */
    async moveToDir(id, dirPath) {
      const p = byId(id);
      if (!p || !app.dirOf(dirPath) || p.dir === dirPath) return false;
      const r = await app.moveManyToDir([id], dirPath);
      if (r.failed.length) throw new Error(r.failed[0].error);
      return r.moved > 0;
    },
    /**
     * 批次搬移到資料夾。一張失敗不影響其他張；回傳 { moved, failed: [{name, error}] }。
     * 搬完的照片會從勾選集合移除（id 隨路徑改變）。
     */
    async moveManyToDir(ids, dirPath) {
      const to = app.dirOf(dirPath);
      if (!to) throw new Error(`找不到資料夾：${dirPath || '（根資料夾）'}`);
      let nextOrder = Math.max(-1, ...state.photos.filter((x) => x.dir === dirPath).map((x) => x.order)) + 1;
      const result = { moved: 0, failed: [] };
      for (const id of ids) {
        const p = byId(id);
        if (!p || p.dir === dirPath) continue;
        const from = app.dirOf(p.dir);
        try {
          const newHandle = await moveFile(p.handle, from.handle, to.handle);
          p.handle = newHandle;
          p.file = null;
          dropUrls(p, ['fullUrl', 'cropUrl']); // 舊 File 的 blob URL 不能留給新 handle 用，讓檢視器重新讀（bug W10）；縮圖不變可留
          p.dir = dirPath;
          p.path = dirPath ? `${dirPath}/${p.name}` : p.name;
          state.checked.delete(p.id);
          if (state.selectedId === p.id) state.selectedId = p.path;
          p.id = p.path;
          p.order = nextOrder++;
          result.moved += 1;
        } catch (e) {
          console.error('搬移失敗', p.name, e);
          result.failed.push({ name: p.name, error: e.message });
        }
      }
      if (result.moved) {
        await app.rescan();
        save();
        emit('checked');
        emit('selection');
      }
      return result;
    },
    /**
     * 刪除＝搬進「照片所在資料夾」的 `_回收桶`（沒有就建），不是全部丟到根目錄，
     * 這樣表格可以把它留在原資料夾群組裡反灰顯示、一鍵還原。已在回收桶的略過。
     * 回傳 { moved, failed, alreadyTrashed }；一張失敗不影響其他張。
     */
    async trash(ids) {
      const byTrash = new Map(); // 回收桶路徑 → 要搬進去的 id
      let alreadyTrashed = 0;
      for (const id of ids) {
        const p = byId(id);
        if (!p) continue;
        if (isTrashDir(p.dir)) {
          alreadyTrashed += 1;
          continue;
        }
        const t = trashDirOf(p.dir);
        if (!byTrash.has(t)) byTrash.set(t, []);
        byTrash.get(t).push(id);
      }
      const result = { moved: 0, failed: [], alreadyTrashed };
      for (const [t, list] of byTrash) {
        try {
          if (!app.dirOf(t)) {
            await ensureDir(state.root, t);
            await app.rescan();
            if (!app.dirOf(t)) throw new Error(`建立回收桶資料夾「${t}」失敗`);
          }
          const r = await app.moveManyToDir(list, t);
          result.moved += r.moved;
          result.failed.push(...r.failed);
        } catch (e) {
          console.error('刪除失敗', t, e);
          for (const id of list) result.failed.push({ name: byId(id)?.name ?? id, error: e.message });
        }
      }
      return result;
    },
    /** 還原＝從回收桶搬回它原本所屬的那個資料夾。回傳 { moved, failed }。 */
    async restore(ids) {
      const byHome = new Map();
      for (const id of ids) {
        const p = byId(id);
        if (!p || !isTrashDir(p.dir)) continue;
        const home = ownerOfTrash(p.dir);
        if (!byHome.has(home)) byHome.set(home, []);
        byHome.get(home).push(id);
      }
      const result = { moved: 0, failed: [] };
      for (const [home, list] of byHome) {
        try {
          const r = await app.moveManyToDir(list, home);
          result.moved += r.moved;
          result.failed.push(...r.failed);
        } catch (e) {
          console.error('還原失敗', home, e);
          for (const id of list) result.failed.push({ name: byId(id)?.name ?? id, error: e.message });
        }
      }
      return result;
    },
    async addFolder(name) {
      await createDir(state.root, name);
      await app.rescan();
    },

    // ---------- 產生 Word ----------
    exportPlan() {
      const ordered = app.orderedPhotos();
      return { ...planExport(ordered, state.dirs), warnings: exportWarnings(ordered, state.template?.spec ?? null) };
    },
    async exportWord({ onProgress } = {}) {
      const { groups, skipped } = app.exportPlan();
      if (!groups.length) throw new Error('沒有可輸出的照片（內容說明都是空的）。');
      const results = [];
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        const { compact, display, dot, stamp } = app.dateInfo(g.dir); // 日期跟著資料夾走
        for (const p of g.photos) await app.fileOf(p);
        const { blob, failures } = await buildDocxBlob(g, {
          spec: state.template?.spec,
          rocDisplay: display,
          rocPhotoDate: dot,
          stamp,
          onProgress: (i, n) => onProgress?.({ group: gi + 1, groups: groups.length, i, n, folder: g.folderName }),
        });
        const name = outputFileName(compact, g.folderName);
        let written;
        if (state.readOnly) {
          download(blob, name);
          written = `${name}（已下載；唯讀模式無法寫進資料夾）`;
        } else {
          const dir = app.dirOf(g.dir);
          written = await writeFile(dir.handle, name, blob, outputFileName(compact, g.folderName, '_new'));
          written = g.dir ? `${g.dir}/${written}` : written;
        }
        results.push({ folder: g.folderName, file: written, count: g.photos.length, failures });
      }
      return { results, skipped };
    },
  };

  async function loadThumbs() {
    for (const p of state.photos) {
      if (p.thumbUrl) continue;
      try {
        p.thumbUrl = await makeThumbUrl(await app.fileOf(p));
      } catch (e) {
        console.error(e);
        p.thumbUrl = '';
      }
      emit('thumb');
    }
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  return app;
}
