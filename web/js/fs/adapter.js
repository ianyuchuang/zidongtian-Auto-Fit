// 檔案系統操作層：所有對資料夾/檔案的存取都經過這裡。
// handle 可以是瀏覽器 File System Access API 的 handle，或 fs/memory.js 的記憶體 handle。

import { isPhotoName, naturalCompare } from '../filename.js';
import { TRASH_DIR } from '../state.js';

/**
 * 遞迴掃描資料夾 → 樹。每個節點：{ name, path, handle, files: [{name, path, handle}], children: [節點] }
 * path 用 '/' 串接、根為 ''。檔案與子資料夾都自然排序。
 */
export async function scanTree(dirHandle, path = '') {
  const node = { name: dirHandle.name, path, handle: dirHandle, files: [], children: [] };
  for await (const h of dirHandle.values()) {
    if (h.kind === 'directory') {
      if (h.name.startsWith('.')) continue;
      node.children.push(await scanTree(h, path ? `${path}/${h.name}` : h.name));
    } else if (h.kind === 'file' && isPhotoName(h.name)) {
      node.files.push({ name: h.name, path: path ? `${path}/${h.name}` : h.name, handle: h });
    }
  }
  node.files.sort((a, b) => naturalCompare(a.name, b.name));
  // 回收桶固定排在同一層的最後，不要夾在樓層資料夾中間
  node.children.sort((a, b) => {
    const ta = a.name === TRASH_DIR ? 1 : 0;
    const tb = b.name === TRASH_DIR ? 1 : 0;
    if (ta !== tb) return ta - tb;
    return naturalCompare(a.name, b.name);
  });
  return node;
}

/** 樹攤平成資料夾清單（深度優先，含根）：[{path, name, handle, depth, fileCount, node}] */
export function flattenDirs(tree) {
  const out = [];
  (function walk(n, depth) {
    out.push({ path: n.path, name: n.name, handle: n.handle, depth, fileCount: n.files.length, node: n });
    for (const c of n.children) walk(c, depth + 1);
  })(tree, 0);
  return out;
}

export function findDir(tree, path) {
  return flattenDirs(tree).find((d) => d.path === path) ?? null;
}

/**
 * 搬移檔案到另一個資料夾（保留檔名）。
 * 目標已有同名檔 → 丟錯，不覆蓋。優先用原生 move()，不支援就「複製 + 刪原檔」。
 * 回傳新的 file handle。
 */
export async function moveFile(fileHandle, fromDir, toDir) {
  const name = fileHandle.name;
  if (await exists(toDir, name)) throw new Error(`目標資料夾「${toDir.name}」已有同名檔案：${name}`);
  if (typeof fileHandle.move === 'function') {
    try {
      await fileHandle.move(toDir);
      return await toDir.getFileHandle(name);
    } catch (e) {
      // 本機資料夾多半不支援 move()，改走複製 + 刪除
    }
  }
  // 複製 + 刪除：任一步失敗都要把目的地的複本清掉，不然留下孤兒複本，
  // 下次再搬同一張會永遠被「目標資料夾已有同名檔案」擋住。
  const file = await fileHandle.getFile();
  const dest = await toDir.getFileHandle(name, { create: true });
  const undoCopy = () => toDir.removeEntry(name).catch(() => {});
  try {
    const w = await dest.createWritable();
    await w.write(file);
    await w.close();
  } catch (e) {
    await undoCopy();
    throw e;
  }
  try {
    await fromDir.removeEntry(name);
  } catch (e) {
    await undoCopy();
    throw new Error(`「${name}」已複製到目的地但原檔刪不掉（可能被其他程式開著），已把複本移除：${e?.message ?? e}`);
  }
  return dest;
}

export async function exists(dirHandle, name) {
  try {
    await dirHandle.getFileHandle(name);
    return true;
  } catch (e) {
    if (e && e.name === 'TypeMismatchError') return true;
    return false;
  }
}

export async function createDir(dirHandle, name) {
  const clean = name.trim();
  if (!clean || /[\\/:*?"<>|]/.test(clean)) throw new Error(`資料夾名稱不合法：${name}`);
  try {
    await dirHandle.getDirectoryHandle(clean);
    throw new Error(`資料夾已存在：${clean}`);
  } catch (e) {
    if (e.name !== 'NotFoundError') throw e;
  }
  return dirHandle.getDirectoryHandle(clean, { create: true });
}

/** 依路徑逐層建立資料夾（已存在就直接用），回傳最底層的 handle。'4F/_回收桶' → 兩層。 */
export async function ensureDir(rootHandle, path) {
  let dir = rootHandle;
  for (const seg of String(path ?? '')
    .split('/')
    .filter(Boolean)) {
    dir = await dir.getDirectoryHandle(seg, { create: true });
  }
  return dir;
}

/**
 * 寫檔。若主檔名寫不進去（例如 Word 正開著），改用 altName；還是失敗就丟錯。
 * 回傳實際寫入的檔名。
 */
export async function writeFile(dirHandle, name, blob, altName = null) {
  const tryWrite = async (n) => {
    const h = await dirHandle.getFileHandle(n, { create: true });
    const w = await h.createWritable();
    await w.write(blob);
    await w.close();
    return n;
  };
  try {
    return await tryWrite(name);
  } catch (e) {
    if (!altName) throw e;
    return tryWrite(altName);
  }
}

/** 入口頁顯示用的摘要：{ name, subdirs: 第一層子資料夾名, dirCount: 含下層的子資料夾數, fileCount: 照片總數 } */
export function describeTree(tree) {
  let fileCount = 0;
  let dirCount = 0;
  (function walk(n) {
    fileCount += n.files.length;
    for (const c of n.children) {
      dirCount += 1;
      walk(c);
    }
  })(tree);
  return { name: tree.name, subdirs: tree.children.map((c) => c.name), dirCount, fileCount };
}

/** describeTree 的結果 → 一行文字，例：「子資料夾：2F、3F、4F、5F（下層共 20 個）・共 502 張照片」 */
export function treeSummaryText({ subdirs, dirCount, fileCount }, maxShown = 8) {
  const parts = [];
  if (subdirs.length) {
    const shown = subdirs.slice(0, maxShown).join('、') + (subdirs.length > maxShown ? '…' : '');
    const nested = dirCount > subdirs.length ? `（下層共 ${dirCount} 個）` : '';
    parts.push(`子資料夾：${shown}${nested}`);
  } else {
    parts.push('沒有子資料夾');
  }
  parts.push(`共 ${fileCount} 張照片`);
  return parts.join('・');
}
