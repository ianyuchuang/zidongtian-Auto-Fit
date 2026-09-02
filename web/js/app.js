// 應用狀態與動作（不碰 DOM）。UI 模組訂閱 app.subscribe() 並呼叫這裡的動作。

import { scanTree, flattenDirs, findDir, moveFile, createDir, writeFile } from './fs/adapter.js';
import { parsePhotoName } from './filename.js';
import {
  STATUS,
  statusFromConfidence,
  sortPhotos,
  filterPhotos,
  counts,
  reorderWithinDir,
  assignOrder,
  nextPendingReview,
} from './state.js';
import { loadSaved, savePhotos, applySaved } from './storage.js';
import { makeThumbUrl, makeCropUrl } from './imaging.js';
import { getRecognizer } from './recognizer/index.js';
import { planExport, exportWarnings, outputFileName } from './docx-model.js';
import { buildDocxBlob } from './docx-export.js';
import { rocCompact, rocDisplay, stampText } from './rocdate.js';

export function createApp() {
  const listeners = new Set();
  const state = {
    page: 'entry',
    root: null, // 根資料夾 handle
    readOnly: false, // 記憶體複本（範例 / 不支援 File System Access API）
    tree: null,
    dirs: [], // flattenDirs(tree)
    photos: [],
    date: new Date(),
    template: null, // {name, file} | null
    prompt: '',
    recognizerId: 'mock',
    selectedId: null,
    dirFilter: null, // 左樹點選的資料夾路徑；null = 全部
    chip: 'all',
    query: '',
    collapsed: new Set(),
    recognizing: false,
  };

  const emit = (what) => {
    for (const fn of listeners) fn(what, state);
  };
  const save = () => {
    if (state.root) savePhotos(state.root.name, state.photos);
  };
  const byId = (id) => state.photos.find((p) => p.id === id) || null;

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
    dateInfo() {
      return { compact: rocCompact(state.date), display: rocDisplay(state.date), stamp: stampText(state.date) };
    },

    // ---------- 開啟資料夾 ----------
    async open({ rootHandle, readOnly = false, date, template = null, prompt = '', recognizerId = 'mock' }) {
      state.root = rootHandle;
      state.readOnly = readOnly;
      state.date = date;
      state.template = template;
      state.prompt = prompt;
      state.recognizerId = recognizerId;
      await app.rescan();
      const saved = loadSaved(rootHandle.name);
      applySaved(state.photos, saved);
      state.page = 'work';
      state.selectedId = state.photos[0]?.id ?? null;
      emit('page');
      loadThumbs();
      app.recognizeAll();
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
    async cropUrl(p) {
      if (!p.bbox) return null;
      if (!p.cropUrl) p.cropUrl = await makeCropUrl(await app.fileOf(p), p.bbox);
      return p.cropUrl;
    },

    // ---------- 辨識 ----------
    async recognizeAll() {
      const rec = getRecognizer(state.recognizerId);
      const queue = state.photos.filter((p) => p.status === STATUS.PENDING);
      if (!queue.length) return;
      state.recognizing = true;
      emit('photos');
      const worker = async () => {
        while (queue.length) {
          const p = queue.shift();
          try {
            const dir = app.dirOf(p.dir);
            const r = await rec.recognize(await app.fileOf(p), {
              prompt: state.prompt,
              folderName: dir?.name ?? '',
              rootName: state.root.name,
            });
            p.desc = r.desc ?? '';
            p.design = r.design ?? '';
            p.actual = r.actual ?? '';
            p.confidence = r.confidence ?? null;
            p.bbox = r.bbox ?? null;
            p.source = 'ai';
            p.status = statusFromConfidence(p.confidence);
          } catch (e) {
            console.error('辨識失敗', p.name, e);
            p.status = STATUS.ERROR;
            p.error = e.message;
          }
          save();
          emit('photos');
        }
      };
      await Promise.all([worker(), worker()]);
      state.recognizing = false;
      emit('photos');
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

    // ---------- 編輯 ----------
    setField(id, field, value) {
      const p = byId(id);
      if (!p || !['desc', 'design', 'actual'].includes(field)) return;
      if (p[field] === value) return;
      p[field] = value;
      save();
      emit('photos');
    },
    confirm(id) {
      const p = byId(id);
      if (!p) return;
      p.status = STATUS.CONFIRMED;
      save();
      emit('photos');
      app.gotoNextPending(id);
    },
    skip(id) {
      app.gotoNextPending(id);
    },
    gotoNextPending(fromId) {
      const next = nextPendingReview(app.visiblePhotos(), fromId) || nextPendingReview(app.orderedPhotos(), fromId);
      if (next) app.select(next.id);
    },
    stepSelection(delta) {
      const list = app.visiblePhotos();
      if (!list.length) return;
      const i = list.findIndex((p) => p.id === state.selectedId);
      const j = Math.min(list.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta));
      app.select(list[j].id);
    },
    batchDesign(value, scope) {
      let targets;
      if (scope === 'visible') targets = app.visiblePhotos();
      else if (scope === 'dir') targets = state.photos.filter((p) => p.dir === (state.dirFilter ?? ''));
      else targets = state.photos;
      for (const p of targets) p.design = value;
      save();
      emit('photos');
      return targets.length;
    },
    setDate(date) {
      state.date = date;
      emit('date');
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
    async moveToDir(id, dirPath) {
      const p = byId(id);
      const to = app.dirOf(dirPath);
      if (!p || !to || p.dir === dirPath) return false;
      const from = app.dirOf(p.dir);
      const newHandle = await moveFile(p.handle, from.handle, to.handle);
      const maxOrder = Math.max(-1, ...state.photos.filter((x) => x.dir === dirPath).map((x) => x.order));
      p.handle = newHandle;
      p.file = null;
      p.dir = dirPath;
      p.path = dirPath ? `${dirPath}/${p.name}` : p.name;
      p.id = p.path;
      p.order = maxOrder + 1;
      if (state.selectedId === id) state.selectedId = p.id;
      await app.rescan();
      save();
      emit('selection');
      return true;
    },
    async addFolder(name) {
      await createDir(state.root, name);
      await app.rescan();
    },

    // ---------- 產生 Word ----------
    exportPlan() {
      const ordered = app.orderedPhotos();
      return { ...planExport(ordered, state.dirs), warnings: exportWarnings(ordered) };
    },
    async exportWord({ onProgress } = {}) {
      const { groups, skipped } = app.exportPlan();
      if (!groups.length) throw new Error('沒有可輸出的照片（內容說明都是空的）。');
      const { compact, display, stamp } = app.dateInfo();
      const results = [];
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        for (const p of g.photos) await app.fileOf(p);
        const { blob, failures } = await buildDocxBlob(g, {
          rocDisplay: display,
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
