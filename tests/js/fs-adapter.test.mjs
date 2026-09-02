import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDirectoryHandle, memoryTreeFromFileList } from '../../web/js/fs/memory.js';
import { scanTree, flattenDirs, findDir, moveFile, createDir, writeFile, exists } from '../../web/js/fs/adapter.js';

function sampleRoot() {
  const root = new MemoryDirectoryHandle('帷幕骨架');
  root.putFile('root.jpg', new File(['r'], 'root.jpg'));
  const f4 = new MemoryDirectoryHandle('4F', root);
  root._entries.set('4F', f4);
  f4.putFile('4F檢查(2)-700mm±10-701mm.jpg', new File(['2'], 'x'));
  f4.putFile('4F檢查(1)-700mm±10-700mm.jpg', new File(['1'], 'x'));
  f4.putFile('~$50725 4f東側.docx', new File(['t'], 'x'));
  const f5 = new MemoryDirectoryHandle('5F', root);
  root._entries.set('5F', f5);
  f5.putFile('203662_0.jpg', new File(['a'], 'x'));
  f5.putFile('Thumbs.db', new File(['t'], 'x'));
  return root;
}

test('scanTree：只收照片、略過雜檔、自然排序、path 用 / 串接', async () => {
  const tree = await scanTree(sampleRoot());
  assert.equal(tree.path, '');
  assert.deepEqual(tree.files.map((f) => f.path), ['root.jpg']);
  assert.deepEqual(tree.children.map((c) => c.name), ['4F', '5F']);
  assert.deepEqual(tree.children[0].files.map((f) => f.name), ['4F檢查(1)-700mm±10-700mm.jpg', '4F檢查(2)-700mm±10-701mm.jpg']);
  assert.deepEqual(tree.children[1].files.map((f) => f.path), ['5F/203662_0.jpg']);
  const dirs = flattenDirs(tree);
  assert.deepEqual(dirs.map((d) => [d.path, d.depth, d.fileCount]), [['', 0, 1], ['4F', 1, 2], ['5F', 1, 1]]);
  assert.equal(findDir(tree, '5F').name, '5F');
  assert.equal(findDir(tree, 'nope'), null);
});

test('moveFile：複製 + 刪原檔；同名檔存在時拒絕', async () => {
  const root = sampleRoot();
  const f4 = await root.getDirectoryHandle('4F');
  const f5 = await root.getDirectoryHandle('5F');
  const h = await f5.getFileHandle('203662_0.jpg');
  const nh = await moveFile(h, f5, f4);
  assert.equal(nh.name, '203662_0.jpg');
  assert.equal(await exists(f5, '203662_0.jpg'), false);
  assert.equal(await exists(f4, '203662_0.jpg'), true);
  assert.equal(await (await nh.getFile()).text(), 'a');
  // 搬回去後再放一個同名檔在目標 → 拒絕
  f5.putFile('203662_0.jpg', new File(['dup'], 'x'));
  await assert.rejects(moveFile(nh, f4, f5), /已有同名檔案/);
  assert.equal(await exists(f4, '203662_0.jpg'), true, '失敗時原檔要留著');
});

test('createDir：建立、重複與不合法名稱丟錯', async () => {
  const root = sampleRoot();
  const d = await createDir(root, ' 6F ');
  assert.equal(d.name, '6F');
  await assert.rejects(createDir(root, '6F'), /已存在/);
  await assert.rejects(createDir(root, 'a/b'), /不合法/);
  await assert.rejects(createDir(root, '  '), /不合法/);
});

test('writeFile：主檔名失敗時改用替代檔名', async () => {
  const root = sampleRoot();
  const name = await writeFile(root, 'out.docx', new Blob(['x']));
  assert.equal(name, 'out.docx');
  const orig = root.getFileHandle.bind(root);
  root.getFileHandle = async (n, o) => {
    if (n === 'out.docx') throw new Error('locked');
    return orig(n, o);
  };
  assert.equal(await writeFile(root, 'out.docx', new Blob(['y']), 'out_new.docx'), 'out_new.docx');
  await assert.rejects(writeFile(root, 'out.docx', new Blob(['z'])), /locked/);
});

test('memoryTreeFromFileList：依 webkitRelativePath 建樹', async () => {
  const mkf = (rel) => {
    const f = new File(['x'], rel.split('/').pop());
    Object.defineProperty(f, 'webkitRelativePath', { value: rel });
    return f;
  };
  const root = memoryTreeFromFileList([mkf('帷幕骨架/4F/a.jpg'), mkf('帷幕骨架/5F/b.jpg'), mkf('帷幕骨架/c.jpg')]);
  assert.equal(root.name, '帷幕骨架');
  const tree = await scanTree(root);
  assert.deepEqual(flattenDirs(tree).map((d) => d.path), ['', '4F', '5F']);
  assert.deepEqual(tree.files.map((f) => f.name), ['c.jpg']);
});
