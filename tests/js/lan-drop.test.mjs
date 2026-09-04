// 內網（http://<IP>:8765，非安全內容環境）拖資料夾：沒有 getAsFileSystemHandle，
// 要靠 webkitGetAsEntry 讀成唯讀複本，不能被當成「其他檔案」拒收（2026-09-04 同事回報）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryTreeFromEntry } from '../../web/js/fs/memory.js';
import { scanTree, describeTree, treeSummaryText } from '../../web/js/fs/adapter.js';
import { classifyDrop, dropKind } from '../../web/js/ui/dnd.js';

// 假的 FileSystemEntry 樹。readEntries 模仿 Chrome：一次只回一小批，回空陣列才算讀完。
function fileEntry(name) {
  return { isFile: true, isDirectory: false, name, file: (ok) => ok(new File([name], name, { type: 'image/jpeg' })) };
}
function dirEntry(name, children, { batch = 2, calls } = {}) {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader() {
      let i = 0;
      return {
        readEntries(ok) {
          calls?.push(name);
          const b = children.slice(i, i + batch);
          i += batch;
          setTimeout(() => ok(b), 0);
        },
      };
    },
  };
}
function sampleEntry(calls) {
  const opt = { calls };
  return dirEntry(
    '帷幕骨架',
    [
      dirEntry('4F', [fileEntry('4F檢查(1)-700mm±10-700mm.jpg'), fileEntry('4F檢查(2)-700mm±10-701mm.jpg'), fileEntry('4F檢查(3)-700mm±10-702mm.jpg')], opt),
      dirEntry('5F', [fileEntry('203662_0.jpg'), fileEntry('Thumbs.db')], opt),
      dirEntry('6F', [], opt), // 空樓層也要留著
      fileEntry('root.jpg'),
    ],
    opt,
  );
}

test('dropKind：沒有 handle 時看 entry.isDirectory，資料夾名當 fileName 不會被判成 other-file', () => {
  // Chrome 在非安全來源會把資料夾當成同名的 File 放進 dt.files
  const k = dropKind({ handle: null, entry: { isDirectory: true, name: '帷幕骨架' }, fileName: '帷幕骨架' });
  assert.deepEqual(k, { isDirectory: true, fileName: '帷幕骨架' });
  assert.equal(classifyDrop(k), 'folder');
  // 有 handle 以 handle.kind 為準
  assert.equal(classifyDrop(dropKind({ handle: { kind: 'directory', name: 'x' }, entry: null, fileName: 'x' })), 'folder');
  assert.equal(classifyDrop(dropKind({ handle: { kind: 'file', name: 'a.docx' }, entry: { isDirectory: false }, fileName: 'a.docx' })), 'template');
  // 檔案走原本的規則
  assert.equal(classifyDrop(dropKind({ entry: { isFile: true, isDirectory: false, name: 'a.docx' }, fileName: 'a.docx' })), 'template');
  assert.equal(classifyDrop(dropKind({ entry: { isFile: true, isDirectory: false, name: 'a.txt' }, fileName: 'a.txt' })), 'other-file');
  assert.equal(classifyDrop(dropKind({})), 'unsupported');
});

test('memoryTreeFromEntry：遞迴讀、readEntries 分批全部讀完、空資料夾保留', async () => {
  const calls = [];
  const root = await memoryTreeFromEntry(sampleEntry(calls));
  assert.equal(root.kind, 'directory');
  assert.equal(root.name, '帷幕骨架');
  // 根有 4 個子項 → 批次 2 要呼叫 3 次（2、2、空）；4F 有 3 個 → 2、1、空
  assert.equal(calls.filter((c) => c === '帷幕骨架').length, 3);
  assert.equal(calls.filter((c) => c === '4F').length, 3);
  const names = [];
  for await (const k of root.keys()) names.push(k);
  assert.deepEqual(names.sort(), ['4F', '5F', '6F', 'root.jpg']);
  const f4 = await root.getDirectoryHandle('4F');
  const f4names = [];
  for await (const k of f4.keys()) f4names.push(k);
  assert.equal(f4names.length, 3, '第二批（第 3 個檔）也要讀到');
  const f6 = await root.getDirectoryHandle('6F');
  assert.equal(f6.kind, 'directory');
  const file = await (await f4.getFileHandle('4F檢查(3)-700mm±10-702mm.jpg')).getFile();
  assert.equal(await file.text(), '4F檢查(3)-700mm±10-702mm.jpg');
  // 接到 adapter：5 張照片、雜檔略過、空樓層仍在摘要裡
  const tree = await scanTree(root);
  const d = describeTree(tree);
  assert.equal(d.fileCount, 5);
  assert.equal(d.dirCount, 3);
  assert.deepEqual(tree.children.map((c) => c.name), ['4F', '5F', '6F']);
  assert.match(treeSummaryText(d), /6F/);
});

test('memoryTreeFromEntry：拖進來的不是資料夾就大聲失敗', async () => {
  await assert.rejects(memoryTreeFromEntry(fileEntry('a.jpg')), /不是資料夾/);
  await assert.rejects(memoryTreeFromEntry(null), /不是資料夾/);
});
