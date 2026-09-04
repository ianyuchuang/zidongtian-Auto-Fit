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

test('recognizeAll：辨識期間使用者自己填過／確認過的，AI 回來不覆蓋（回歸：bug清單 A1）', async () => {
  const { app } = await setup();
  app.state.recognizerId = 'mock';
  app.state.engine = 'mock';
  const target = app.state.photos[0];
  const untouched = app.state.photos[3];
  const run = app.recognizeAll(); // 送出後、結果回來前……
  app.setField(target.id, 'desc', '我先打好的內容');
  app.setField(target.id, 'design', '我的設計值');
  app.confirm(target.id);
  const r = await run;
  assert.equal(target.desc, '我先打好的內容', '打的字不能被 AI 蓋掉');
  assert.equal(target.design, '我的設計值');
  assert.equal(target.status, 'confirmed', '已確認不能被打回待校對');
  assert.ok(r.kept.includes(target));
  assert.ok(target.bbox, '仍然要補上白板裁切用的 bbox');
  assert.equal(untouched.source, 'ai', '沒動過的照片照樣填 AI 結果');
  assert.equal(r.total, 4);
});

test('recognizeAll：可以只跑指定的照片；重複呼叫不會疊在一起', async () => {
  const { app } = await setup();
  app.state.recognizerId = 'mock';
  app.state.engine = 'mock';
  const one = app.state.photos[1];
  const r = await app.recognizeAll({ photos: [one] });
  assert.equal(r.total, 1);
  assert.equal(one.source, 'ai');
  assert.equal(app.state.photos[0].status, 'pending', '沒指定的不動');
  assert.equal(app.pendingPhotos().length, 3);
  // 已確認的預設不重跑
  app.confirm(app.state.photos[0].id);
  assert.ok(!app.redoablePhotos().includes(app.state.photos[0]));
  assert.ok(app.redoablePhotos({ includeConfirmed: true }).includes(app.state.photos[0]));
});

test('recognizeAll：回收桶裡的照片不辨識', async () => {
  const { app } = await setup();
  app.state.recognizerId = 'mock';
  app.state.engine = 'mock';
  await app.trash(['4F/a.jpg']);
  const gone = app.photo('4F/_回收桶/a.jpg');
  assert.equal(gone.status, 'pending');
  await app.recognizeAll();
  assert.equal(gone.status, 'pending', '已刪除的不該被排進辨識');
  assert.ok(!app.pendingPhotos().includes(gone));
});

test('setRecognizer：只發 engine，不發 page（回歸：按「開始辨識」被打回首頁）', async () => {
  const { app, events } = await setup();
  app.state.page = 'work';
  events.length = 0;
  app.setRecognizer({ recognizerId: 'api', api: { provider: 'claude', apiKey: 'k', model: 'm' }, prompt: '白板' });
  assert.deepEqual(events, ['engine']);
  assert.equal(app.state.page, 'work', '設定辨識方式不是換頁');
  assert.equal(app.state.engine, engineId('api', { provider: 'claude' }));
  assert.equal(app.state.prompt, '白板');
});

test('檢查日期：每個資料夾各一個，沒設過用今天，不合法要丟錯', async () => {
  const { app } = await setup();
  const today = app.dateInfo().compact;
  assert.equal(app.dateInfo('4F').compact, today); // 沒設過 → 預設今天
  app.setDirDate('4F', '1150725');
  assert.equal(app.dateInfo('4F').compact, '1150725');
  assert.equal(app.dateInfo('4F').display, '115年07月25日');
  assert.equal(app.dateInfo('4F').stamp, '2026-07-25');
  assert.equal(app.dateInfo('5F').compact, today); // 別的資料夾不受影響
  assert.throws(() => app.setDirDate('5F', '115072'), /看不懂的日期|日期不存在/);
  assert.equal(app.dateInfo('5F').compact, today);
});

test('檢查日期：打西元或帶斜線也要正規化成民國 7 碼存，重開才讀得回來（回歸 W4）', async () => {
  const { loadDates } = await import('../../web/js/storage.js');
  const store = new FakeStorage();
  const prev = globalThis.localStorage;
  globalThis.localStorage = store;
  try {
    const { app } = await setup();
    app.setDirDate('4F', '20260725');
    app.setDirDate('5F', '115/08/01');
    assert.deepEqual(app.state.dates, { '4F': '1150725', '5F': '1150801' });
    assert.deepEqual(loadDates(app.state.root.name, store), { '4F': '1150725', '5F': '1150801' });
  } finally {
    globalThis.localStorage = prev;
  }
});

test('pickRoot：入口頁選好的資料夾要留在 state（回歸：選完資料夾再拖 docx 進來就忘掉）', () => {
  const app = createApp();
  const root = new MemoryDirectoryHandle('帷幕骨架');
  app.pickRoot({ rootHandle: root, readOnly: false, label: '帷幕骨架' });
  app.setRootSummary('4F・5F 共 12 張');
  // 拖版型 docx 進入口頁 → 版型調整頁 → 回入口頁（不管是套用或取消）
  app.openTemplatePage(new File(['x'], 'a.docx'));
  assert.equal(app.state.page, 'template');
  app.applyTemplate({ name: 'a.docx', file: null, spec: { id: 't1' } });
  assert.equal(app.state.page, 'entry');
  assert.equal(app.state.root, root, '資料夾要還在');
  assert.equal(app.state.rootLabel, '帷幕骨架');
  assert.equal(app.state.rootSummary, '4F・5F 共 12 張', '掃過的摘要留著，回來不必重掃');
  app.openTemplatePage(null);
  app.closeTemplatePage(); // 取消也一樣
  assert.equal(app.state.root, root);
});

test('pickRoot：換資料夾要清掉舊摘要；同一個資料夾不覆蓋「（範例）」這種標示', () => {
  const app = createApp();
  const a = new MemoryDirectoryHandle('甲案');
  const b = new MemoryDirectoryHandle('乙案');
  app.pickRoot({ rootHandle: a, readOnly: true, label: '甲案（範例）' });
  app.setRootSummary('甲案的摘要');
  app.pickRoot({ rootHandle: a, readOnly: true }); // 沒帶 label＝同一個資料夾，維持原樣
  assert.equal(app.state.rootLabel, '甲案（範例）');
  assert.equal(app.state.rootSummary, '甲案的摘要');
  app.pickRoot({ rootHandle: b, readOnly: false });
  assert.equal(app.state.root, b);
  assert.equal(app.state.rootLabel, '乙案');
  assert.equal(app.state.rootSummary, null, '換了資料夾不能顯示上一個的摘要');
  assert.equal(app.state.readOnly, false);
});

test('goHome：資料夾留著、摘要要重掃（工作台可能搬過或刪過檔案）', async () => {
  const { app } = await setup();
  app.pickRoot({ rootHandle: app.state.root, readOnly: false, label: '帷幕骨架' });
  app.setRootSummary('舊的摘要');
  app.state.page = 'work';
  app.goHome();
  assert.equal(app.state.page, 'entry');
  assert.ok(app.state.root, '資料夾不必重選');
  assert.equal(app.state.rootLabel, '帷幕骨架');
  assert.equal(app.state.rootSummary, null);
});

class FakeStorage {
  constructor() {
    this.m = new Map();
    this.writes = 0;
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    this.writes += 1;
    this.m.set(k, String(v));
  }
  removeItem(k) {
    this.m.delete(k);
  }
}

test('goHome 在辨識中途（瀏覽器上一頁）：停掉辨識、還在飛的結果不能再 save，校對暫存不會被洗成空的（回歸 W1）', async () => {
  const { savePhotos, loadSaved } = await import('../../web/js/storage.js');
  const store = new FakeStorage();
  const prev = globalThis.localStorage;
  globalThis.localStorage = store;
  try {
    const { app } = await setup();
    savePhotos(app.state.root.name, [{ path: '4F/a.jpg', desc: '手打的', design: '1', actual: '2', status: 'confirmed', order: 0 }], store);
    app.state.page = 'work';
    app.state.recognizerId = 'mock';
    app.state.engine = 'mock';
    const run = app.recognizeAll();
    await new Promise((r) => setTimeout(r, 30)); // 模擬辨識每張 250ms，這時還沒有任何結果回來
    app.goHome();
    assert.equal(app.state.recognizing, false);
    const writesAfterHome = store.writes;
    const r = await run;
    assert.equal(r.stopped, true);
    assert.equal(store.writes, writesAfterHome, '離開工作台後不能再寫暫存');
    assert.equal(loadSaved(app.state.root.name, store)['4F/a.jpg'].desc, '手打的', '暫存要原封不動');
    assert.equal(app.state.progress, null);
  } finally {
    globalThis.localStorage = prev;
  }
});

test('open：入口頁沒帶辨識設定 → 沿用上次選的方式／金鑰／提示詞，引擎比對照常（回歸 W3）', async () => {
  const app = createApp();
  const root = new MemoryDirectoryHandle('帷幕骨架');
  (await root.getDirectoryHandle('4F', { create: true })).putFile('a.jpg', new File(['a'], 'a.jpg'));
  await app.open({ rootHandle: root });
  assert.equal(app.state.recognizerId, null, '還沒選過辨識方式');
  assert.equal(app.state.engine, null);
  const api = { provider: 'claude', apiKey: 'k', model: 'm' };
  app.setRecognizer({ recognizerId: 'api', api, prompt: '白板在右下' });
  app.goHome();
  await app.open({ rootHandle: root }); // 入口頁的呼叫方式：只帶資料夾與版型
  assert.equal(app.state.recognizerId, 'api');
  assert.deepEqual(app.state.api, api);
  assert.equal(app.state.prompt, '白板在右下');
  assert.equal(app.state.engine, 'api:claude');
  await app.open({ rootHandle: root, recognizerId: 'mock', prompt: '' }); // 明確帶就照帶的
  assert.equal(app.state.recognizerId, 'mock');
  assert.equal(app.state.api, null);
  assert.equal(app.state.prompt, '');
  assert.equal(app.state.engine, 'mock');
});

test('recognizeAll：排隊時已經「已確認」的不重跑，除非明講 includeConfirmed（回歸 W5）', async () => {
  const { scopePhotos } = await import('../../web/js/ui/recognize.js');
  const { app } = await setup();
  app.state.recognizerId = 'mock';
  app.state.engine = 'mock';
  const done = app.state.photos[0];
  app.setField(done.id, 'desc', '校對過的');
  app.confirm(done.id);
  app.setChecked([done.id, app.state.photos[1].id], true);
  assert.deepEqual(scopePhotos(app, 'checked').map((p) => p.id), [app.state.photos[1].id], '「目前勾選的」也要排除已確認');
  assert.equal(scopePhotos(app, 'checked', { includeConfirmed: true }).length, 2);
  assert.throws(() => scopePhotos(app, 'nope'), /沒有這種辨識範圍/);
  // 就算呼叫端硬塞已確認的照片進來，沒有 includeConfirmed 也不能洗掉
  const r = await app.recognizeAll({ photos: [done, app.state.photos[1]] });
  assert.equal(r.total, 1);
  assert.equal(done.desc, '校對過的');
  assert.equal(done.status, 'confirmed');
  // 明講才重跑
  const r2 = await app.recognizeAll({ photos: [done], includeConfirmed: true });
  assert.equal(r2.total, 1);
  assert.equal(done.source, 'ai');
  assert.notEqual(done.status, 'confirmed', '重跑後回到待校對');
});

test('recognizeAll：重跑辨識要把舊的白板裁切丟掉，之後才會照新的 bbox 重裁（回歸 W7）', async () => {
  const { app } = await setup();
  app.state.recognizerId = 'mock';
  app.state.engine = 'mock';
  const p = app.state.photos[0];
  p.cropUrl = 'blob:old';
  await app.recognizeAll({ photos: [p] });
  assert.ok(p.bbox);
  assert.equal(p.cropUrl, null);
});

test('confirm：已刪除的照片不能被確認（回歸 W9：全域 Enter 會確認到回收桶裡的那張）', async () => {
  const { app } = await setup();
  await app.trash(['4F/a.jpg']);
  const gone = app.photo('4F/_回收桶/a.jpg');
  assert.equal(app.confirm(gone.id), false);
  assert.equal(gone.status, 'pending');
  assert.equal(app.confirm('ghost'), false);
  assert.equal(app.confirm('4F/b.jpg'), true);
  assert.equal(app.photo('4F/b.jpg').status, 'confirmed');
});

test('搬移／刪除／還原後，舊檔案的大圖與裁切 URL 要清掉讓檢視器重讀（回歸 W10）', async () => {
  const { app } = await setup();
  const mark = (p) => Object.assign(p, { fullUrl: 'blob:full', cropUrl: 'blob:crop', thumbUrl: 'blob:thumb' });
  mark(app.photo('4F/a.jpg'));
  await app.trash(['4F/a.jpg']);
  let p = app.photo('4F/_回收桶/a.jpg');
  assert.equal(p.fullUrl, null);
  assert.equal(p.cropUrl, null);
  assert.equal(p.thumbUrl, 'blob:thumb', '縮圖內容沒變，留著');
  mark(p);
  await app.restore([p.id]);
  p = app.photo('4F/a.jpg');
  assert.equal(p.fullUrl, null);
  mark(app.photo('4F/b.jpg'));
  await app.moveToDir('4F/b.jpg', '5F');
  assert.equal(app.photo('5F/b.jpg').fullUrl, null);
});

test('辨識失敗的照片仍算「尚未辨識」，能被再排進辨識、也會被「下一張」走到（回歸 W11）', async () => {
  const { app } = await setup();
  const p = app.state.photos[0];
  p.status = 'error';
  p.error = '沒金鑰';
  assert.ok(app.pendingPhotos().includes(p));
  app.select(app.state.photos[1].id);
  assert.equal(app.gotoNextPending(app.state.photos[1].id), true);
  assert.equal(app.state.selectedId, p.id);
});

test('restore：搬回原本的位置，不是排到最後（回歸 W17）', async () => {
  const { app } = await setup();
  const ids = () => app.orderedPhotos().filter((p) => p.dir === '4F').map((p) => p.id);
  assert.deepEqual(ids(), ['4F/a.jpg', '4F/b.jpg']);
  await app.trash(['4F/a.jpg']);
  assert.equal(app.photo('4F/_回收桶/a.jpg').homeOrder, 0);
  await app.restore(['4F/_回收桶/a.jpg']);
  assert.deepEqual(ids(), ['4F/a.jpg', '4F/b.jpg'], 'a 要回到 b 前面');
  assert.equal(app.photo('4F/a.jpg').homeOrder, undefined);
});

test('stepSelection：目前選的不在篩選結果裡 → 下一張是第一張、上一張是最後一張（回歸 W18）', async () => {
  const { app } = await setup();
  app.select('5F/c.jpg');
  app.setDirFilter('4F'); // 5F/c 被篩掉
  assert.equal(app.stepSelection(1), true);
  assert.equal(app.state.selectedId, '4F/a.jpg', '不能跳過第一張');
  app.select('5F/c.jpg');
  assert.equal(app.stepSelection(-1), true);
  assert.equal(app.state.selectedId, '4F/b.jpg');
  assert.equal(app.stepSelection(1), false, '到尾了');
});
