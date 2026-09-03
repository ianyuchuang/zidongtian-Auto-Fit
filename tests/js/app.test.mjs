// app.js 的動作層（用記憶體 handle，不碰 DOM）：勾選、批次搬移、刪除到回收桶。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, engineId } from '../../web/js/app.js';
import { MemoryDirectoryHandle } from '../../web/js/fs/memory.js';
import { TRASH_DIR, trashDirOf } from '../../web/js/state.js';
import { exists } from '../../web/js/fs/adapter.js';
import { dropIds, DND_MULTI, DND_SINGLE } from '../../web/js/ui/dnd.js';

async function setup() {
  const root = new MemoryDirectoryHandle('帷幕骨架');
  const f4 = await root.getDirectoryHandle('4F', { create: true });
  const f5 = await root.getDirectoryHandle('5F', { create: true });
  f4.putFile('a.jpg', new File(['a'], 'a.jpg'));
  f4.putFile('b.jpg', new File(['b'], 'b.jpg'));
  f5.putFile('c.jpg', new File(['c'], 'c.jpg'));
  f5.putFile('a.jpg', new File(['dup'], 'a.jpg')); // 與 4F/a.jpg 同名，搬過去要失敗
  const app = createApp();
  app.state.root = root;
  const events = [];
  app.subscribe((what) => events.push(what));
  await app.rescan();
  return { app, root, events };
}

test('勾選：setChecked / toggle / clear / checkedPhotos 依表格順序；rescan 後移除不存在的 id', async () => {
  const { app, events } = await setup();
  app.setChecked(['5F/c.jpg', '4F/a.jpg'], true);
  assert.deepEqual(app.checkedPhotos().map((p) => p.id), ['4F/a.jpg', '5F/c.jpg']);
  app.toggleChecked('4F/a.jpg');
  assert.equal(app.isChecked('4F/a.jpg'), false);
  assert.ok(events.includes('checked'));
  app.setChecked(['ghost'], true);
  await app.rescan();
  assert.deepEqual([...app.state.checked], ['5F/c.jpg']);
  app.clearChecked();
  assert.equal(app.state.checked.size, 0);
});

test('moveManyToDir：整批搬、一張失敗不影響其他、id 隨路徑改、勾選清掉、選取跟著走', async () => {
  const { app, root } = await setup();
  app.setChecked(['4F/a.jpg', '4F/b.jpg'], true);
  app.select('4F/b.jpg');
  const r = await app.moveManyToDir(['4F/a.jpg', '4F/b.jpg', '5F/c.jpg'], '5F');
  assert.equal(r.moved, 1); // b 成功；a 同名失敗；c 本來就在 5F 略過
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0].error, /同名/);
  assert.equal(r.failed[0].name, 'a.jpg');
  const f4 = await root.getDirectoryHandle('4F');
  const f5 = await root.getDirectoryHandle('5F');
  assert.equal(await exists(f4, 'b.jpg'), false);
  assert.equal(await exists(f5, 'b.jpg'), true);
  assert.equal(await exists(f4, 'a.jpg'), true, '失敗的要留在原地');
  assert.deepEqual(app.state.photos.map((p) => p.id).sort(), ['4F/a.jpg', '5F/a.jpg', '5F/b.jpg', '5F/c.jpg']);
  assert.equal(app.state.selectedId, '5F/b.jpg');
  assert.deepEqual([...app.state.checked], ['4F/a.jpg'], '搬成功的從勾選移除，失敗的留著');
  const b = app.photo('5F/b.jpg');
  assert.ok(b.order > app.photo('5F/c.jpg').order, '搬過去排在最後');
  await assert.rejects(app.moveManyToDir(['5F/c.jpg'], '6F'), /找不到資料夾/);
});

test('moveToDir：單張介面不變（同資料夾 false、失敗丟錯）', async () => {
  const { app } = await setup();
  assert.equal(await app.moveToDir('5F/c.jpg', '5F'), false);
  assert.equal(await app.moveToDir('nope', '5F'), false);
  await assert.rejects(app.moveToDir('4F/a.jpg', '5F'), /同名/);
  assert.equal(await app.moveToDir('4F/b.jpg', ''), true);
  assert.ok(app.photo('b.jpg'));
});

test('trash：搬進「所在資料夾」自己的 _回收桶（不是全部丟到根目錄）', async () => {
  const { app, root } = await setup();
  assert.equal(app.dirOf(trashDirOf('4F')), null);
  const r = await app.trash(['4F/a.jpg', '5F/c.jpg']);
  assert.deepEqual({ moved: r.moved, failed: r.failed, alreadyTrashed: r.alreadyTrashed }, { moved: 2, failed: [], alreadyTrashed: 0 });
  assert.ok(app.dirOf('4F/_回收桶'), '4F 要有自己的回收桶');
  assert.ok(app.dirOf('5F/_回收桶'), '5F 要有自己的回收桶');
  const t4 = await (await root.getDirectoryHandle('4F')).getDirectoryHandle(TRASH_DIR);
  const t5 = await (await root.getDirectoryHandle('5F')).getDirectoryHandle(TRASH_DIR);
  assert.equal(await exists(t4, 'a.jpg'), true);
  assert.equal(await exists(t5, 'c.jpg'), true);
  assert.equal(await exists(t4, 'c.jpg'), false, 'c 是 5F 的，不能跑到 4F 的回收桶');
  // 已在回收桶的略過
  const r2 = await app.trash(['4F/_回收桶/a.jpg', '4F/b.jpg']);
  assert.equal(r2.moved, 1);
  assert.equal(r2.alreadyTrashed, 1);
  // 回收桶已存在（例如上次留下的）也能用
  const app2 = createApp();
  app2.state.root = root;
  await app2.rescan();
  const r3 = await app2.trash(['5F/a.jpg']);
  assert.equal(r3.moved, 1);
});

test('restore：從回收桶搬回原本那個資料夾，不需要使用者自己拖', async () => {
  const { app, root } = await setup();
  await app.trash(['4F/a.jpg', '5F/c.jpg']);
  const r = await app.restore(['4F/_回收桶/a.jpg', '5F/_回收桶/c.jpg']);
  assert.deepEqual({ moved: r.moved, failed: r.failed }, { moved: 2, failed: [] });
  assert.ok(app.photo('4F/a.jpg'), 'a 要回到 4F');
  assert.ok(app.photo('5F/c.jpg'), 'c 要回到 5F');
  assert.equal(await exists(await root.getDirectoryHandle('4F'), 'a.jpg'), true);
  // 不在回收桶的照片呼叫 restore 不動作
  const r2 = await app.restore(['4F/b.jpg']);
  assert.deepEqual({ moved: r2.moved, failed: r2.failed }, { moved: 0, failed: [] });
});

test('已刪除的照片不進統計、不被批次修改設計值掃到', async () => {
  const { app } = await setup();
  await app.trash(['4F/a.jpg']);
  assert.equal(app.counts().all, 3);
  assert.equal(app.counts().trashed, 1);
  app.batchDesign('X', 'all');
  assert.equal(app.photo('4F/_回收桶/a.jpg').design, '', '已刪除的不跟著改');
  assert.equal(app.photo('4F/b.jpg').design, 'X');
});

test('dropIds：多張 JSON 優先，其次單張，壞掉的 JSON 落回單張', () => {
  const dt = (map) => ({ getData: (k) => map[k] ?? '' });
  assert.deepEqual(dropIds(dt({ [DND_MULTI]: '["a","b"]', [DND_SINGLE]: 'a' })), ['a', 'b']);
  assert.deepEqual(dropIds(dt({ [DND_SINGLE]: 'a' })), ['a']);
  assert.deepEqual(dropIds(dt({ [DND_MULTI]: '{bad', [DND_SINGLE]: 'a' })), ['a']);
  assert.deepEqual(dropIds(dt({ [DND_MULTI]: '[]' })), []);
  assert.deepEqual(dropIds(dt({})), []);
});

test('engineId：模擬＝mock、LLM API 帶供應商（換家也算換引擎）', () => {
  assert.equal(engineId('mock', null), 'mock');
  assert.equal(engineId('api', { provider: 'claude' }), 'api:claude');
  assert.equal(engineId('api', { provider: 'gemini' }), 'api:gemini');
  assert.equal(engineId('local', null), 'local');
});

test('recognizeAll：結果記引擎；失敗時狀態 error、留下原因並發 recognize-failed（回歸：之前失敗只有 console）', async () => {
  const { app, events } = await setup();
  app.state.recognizerId = 'mock';
  app.state.engine = 'mock';
  await app.recognizeAll();
  for (const p of app.state.photos) {
    assert.equal(p.engine, 'mock');
    assert.equal(p.source, 'ai');
  }
  assert.ok(!events.includes('recognize-failed'));

  const { app: app2, events: ev2 } = await setup();
  app2.state.recognizerId = 'api';
  app2.state.api = { provider: 'claude', apiKey: '' }; // 沒金鑰 → 每張都要大聲失敗
  app2.state.engine = 'api:claude';
  await app2.recognizeAll();
  assert.ok(app2.state.photos.every((p) => p.status === 'error'));
  assert.match(app2.state.photos[0].error, /金鑰/);
  assert.equal(app2.state.lastFailed.length, 4);
  assert.ok(ev2.includes('recognize-failed'));
});
