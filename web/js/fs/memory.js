// 記憶體版的目錄/檔案 handle，介面模仿 File System Access API 的子集合。
// 用途：(1) 測試 fs/adapter.js；(2) 瀏覽器不支援 showDirectoryPicker 或載入範例時的唯讀模式。

export class MemoryFileHandle {
  constructor(name, file, parent) {
    this.kind = 'file';
    this.name = name;
    this._file = file;
    this._parent = parent;
  }

  async getFile() {
    return this._file;
  }

  async createWritable() {
    const chunks = [];
    const self = this;
    return {
      async write(chunk) {
        chunks.push(chunk);
      },
      async close() {
        self._file = new File(chunks, self.name, { type: self._file?.type || '' });
      },
      async abort() {},
    };
  }

  async isSameEntry(other) {
    return other === this;
  }
}

export class MemoryDirectoryHandle {
  constructor(name, parent = null) {
    this.kind = 'directory';
    this.name = name;
    this._entries = new Map();
    this._parent = parent;
  }

  async *values() {
    for (const h of this._entries.values()) yield h;
  }

  async *entries() {
    for (const [k, v] of this._entries) yield [k, v];
  }

  async *keys() {
    for (const k of this._entries.keys()) yield k;
  }

  async getFileHandle(name, { create = false } = {}) {
    const h = this._entries.get(name);
    if (h) {
      if (h.kind !== 'file') throw mkError('TypeMismatchError', `${name} 不是檔案`);
      return h;
    }
    if (!create) throw mkError('NotFoundError', `找不到檔案：${name}`);
    const nh = new MemoryFileHandle(name, new File([], name), this);
    this._entries.set(name, nh);
    return nh;
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    const h = this._entries.get(name);
    if (h) {
      if (h.kind !== 'directory') throw mkError('TypeMismatchError', `${name} 不是資料夾`);
      return h;
    }
    if (!create) throw mkError('NotFoundError', `找不到資料夾：${name}`);
    const nd = new MemoryDirectoryHandle(name, this);
    this._entries.set(name, nd);
    return nd;
  }

  async removeEntry(name) {
    if (!this._entries.has(name)) throw mkError('NotFoundError', `找不到：${name}`);
    this._entries.delete(name);
  }

  async isSameEntry(other) {
    return other === this;
  }

  async queryPermission() {
    return 'granted';
  }

  async requestPermission() {
    return 'granted';
  }

  /** 測試/範例用：直接放一個檔案。 */
  putFile(name, file) {
    const h = new MemoryFileHandle(name, file, this);
    this._entries.set(name, h);
    return h;
  }
}

function mkError(name, message) {
  const e = new Error(message);
  e.name = name;
  return e;
}

/**
 * 從 <input webkitdirectory> 的 FileList 建立記憶體目錄樹。
 * 每個 file.webkitRelativePath 形如 '根/子/檔.jpg'。
 */
export function memoryTreeFromFileList(files) {
  let root = null;
  for (const f of files) {
    const parts = (f.webkitRelativePath || f.name).split('/');
    if (!root) root = new MemoryDirectoryHandle(parts.length > 1 ? parts[0] : '照片');
    let dir = root;
    const segs = parts.length > 1 ? parts.slice(1, -1) : [];
    for (const s of segs) {
      let next = dir._entries.get(s);
      if (!next) {
        next = new MemoryDirectoryHandle(s, dir);
        dir._entries.set(s, next);
      }
      dir = next;
    }
    dir.putFile(parts[parts.length - 1], f);
  }
  return root;
}
