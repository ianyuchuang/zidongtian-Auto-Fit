import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializePhotos, applySaved, savePhotos, loadSaved, storageKey, legacyStorageKey } from '../../web/js/storage.js';

class FakeStorage {
  constructor() {
    this.m = new Map();
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    this.m.set(k, String(v));
  }
  removeItem(k) {
    this.m.delete(k);
  }
}

test('serializePhotos：只存需要的欄位，不存 handle/file；pending 也存', () => {
  const out = serializePhotos([
    { path: '4F/a.jpg', desc: 'a', design: '1', actual: '2', status: 'confirmed', order: 3, handle: {}, file: {}, confidence: null, source: 'filename', bbox: null },
    { path: '5F/b.jpg', desc: '', status: 'pending', order: 0 },
  ]);
  assert.deepEqual(Object.keys(out), ['4F/a.jpg', '5F/b.jpg']);
  assert.deepEqual(out['4F/a.jpg'], { desc: 'a', design: '1', actual: '2', confidence: null, source: 'filename', status: 'confirmed', bbox: null, order: 3 });
});

test('沒跑 AI、純手打的照片（狀態仍是 pending）：三欄與拖曳順序重開要還在（回歸 W2）', () => {
  const st = new FakeStorage();
  savePhotos(
    'root',
    [
      { path: 'a.jpg', desc: '手打', design: '10', actual: '11', status: 'pending', confidence: null, source: null, bbox: null, order: 1 },
      { path: 'b.jpg', desc: '', design: '', actual: '', status: 'pending', confidence: null, source: null, bbox: null, order: 0 },
    ],
    st,
  );
  const fresh = [
    { path: 'a.jpg', desc: '', design: '', actual: '', status: 'pending', order: 0 },
    { path: 'b.jpg', desc: '', design: '', actual: '', status: 'pending', order: 1 },
  ];
  const { applied } = applySaved(fresh, loadSaved('root', st), { engine: 'mock' });
  assert.equal(applied, 2);
  assert.deepEqual([fresh[0].desc, fresh[0].design, fresh[0].actual, fresh[0].status], ['手打', '10', '11', 'pending']);
  assert.deepEqual([fresh[0].order, fresh[1].order], [1, 0], '拖過的順序要保留');
});

test('save → load → apply 來回一致', () => {
  const st = new FakeStorage();
  const photos = [{ path: 'x.jpg', desc: 'd', design: 'e', actual: 'f', status: 'ai', confidence: 80, source: 'ai', bbox: { x: 0, y: 0, w: 1, h: 1 }, order: 1 }];
  savePhotos('root', photos, st);
  assert.ok(st.getItem(storageKey('root')));
  const fresh = [{ path: 'x.jpg', desc: '', status: 'pending', order: 0 }, { path: 'y.jpg', desc: 'y', status: 'parsed', order: 1 }];
  const { applied, redo } = applySaved(fresh, loadSaved('root', st));
  assert.equal(applied, 1);
  assert.equal(redo, 0);
  assert.equal(fresh[0].desc, 'd');
  assert.equal(fresh[0].status, 'ai');
  assert.equal(fresh[0].order, 1);
  assert.equal(fresh[1].desc, 'y');
});

test('applySaved：換了辨識引擎 → 別的引擎跑的、未確認的 AI 結果不套回（重新辨識），已確認與檔名解析照套（回歸：模擬辨識的暫存蓋掉 LLM API）', () => {
  const st = new FakeStorage();
  savePhotos(
    'root',
    [
      { path: 'a.jpg', desc: '假', design: '1', actual: '2', status: 'ai', confidence: 80, source: 'ai', engine: 'mock', order: 5 },
      { path: 'b.jpg', desc: '真', design: '1', actual: '2', status: 'confirmed', confidence: 80, source: 'ai', engine: 'mock', order: 6 },
      { path: 'c.jpg', desc: '檔', design: '1', actual: '2', status: 'parsed', confidence: null, source: 'filename', order: 7 },
      { path: 'd.jpg', desc: '舊', design: '1', actual: '2', status: 'low', confidence: 40, source: 'ai', order: 8 }, // 舊版暫存沒有 engine
    ],
    st,
  );
  const fresh = ['a', 'b', 'c', 'd'].map((n, i) => ({ path: `${n}.jpg`, desc: '', status: 'pending', order: i }));
  const r = applySaved(fresh, loadSaved('root', st), { engine: 'api:claude' });
  assert.deepEqual(r, { applied: 2, redo: 2 });
  assert.equal(fresh[0].status, 'pending', '模擬辨識的結果要重跑');
  assert.equal(fresh[0].desc, '');
  assert.equal(fresh[0].order, 5, '但排序保留');
  assert.equal(fresh[1].status, 'confirmed', '已確認的保留');
  assert.equal(fresh[2].status, 'parsed');
  assert.equal(fresh[3].status, 'pending', '沒記錄引擎的舊 AI 結果也重跑');
  // 同一個引擎重開 → 全部套回（不重複花錢）
  const again = ['a', 'b', 'c', 'd'].map((n, i) => ({ path: `${n}.jpg`, desc: '', status: 'pending', order: i }));
  assert.deepEqual(applySaved(again, loadSaved('root', st), { engine: 'mock' }), { applied: 3, redo: 1 });
  assert.equal(again[0].status, 'ai');
});

test('loadSaved：壞掉的 JSON 回空物件', () => {
  const st = new FakeStorage();
  st.setItem(storageKey('r'), '{bad');
  assert.deepEqual(loadSaved('r', st), {});
});

test('各資料夾的檢查日期：存、讀、擋掉壞資料', async () => {
  const { loadDates, saveDates, datesKey } = await import('../../web/js/storage.js');
  const m = new Map();
  const store = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
  saveDates('帷幕骨架', { '4F': '1150725', '5F': '1150801' }, store);
  assert.equal(m.has(datesKey('帷幕骨架')), true);
  assert.deepEqual(loadDates('帷幕骨架', store), { '4F': '1150725', '5F': '1150801' });
  assert.deepEqual(loadDates('別的資料夾', store), {});
  store.setItem(datesKey('壞的'), '{不是 JSON');
  assert.deepEqual(loadDates('壞的', store), {});
  store.setItem(datesKey('怪值'), JSON.stringify({ '4F': '115', '5F': 1150801, '6F': '1150801' }));
  assert.deepEqual(loadDates('怪值', store), { '6F': '1150801' }); // 只留 7 碼字串
});

test('低信心的「欄位毛病」說明（warn）重開要還在（回歸 W14）', () => {
  const st = new FakeStorage();
  savePhotos('root', [{ path: 'a.jpg', desc: '', design: '1', actual: '2', status: 'low', confidence: 90, source: 'ai', engine: 'mock', order: 0, warn: '內容說明是空的' }], st);
  const fresh = [{ path: 'a.jpg', desc: '', status: 'pending', order: 0 }];
  applySaved(fresh, loadSaved('root', st), { engine: 'mock' });
  assert.equal(fresh[0].warn, '內容說明是空的');
});

test('校對暫存的 key 有 photos: 前綴，資料夾叫 api-keys / templates 也不會撞到其他設定（回歸 W15）', () => {
  const st = new FakeStorage();
  st.setItem('autofit:v1:api-keys', JSON.stringify({ provider: 'claude', keys: { claude: 'sk' } }));
  assert.equal(storageKey('api-keys'), 'autofit:v1:photos:api-keys');
  assert.deepEqual(loadSaved('api-keys', st), {}, '不能把金鑰設定當成暫存讀');
  savePhotos('api-keys', [{ path: 'a.jpg', desc: 'x', status: 'parsed', order: 0 }], st);
  assert.equal(st.getItem('autofit:v1:api-keys'), JSON.stringify({ provider: 'claude', keys: { claude: 'sk' } }), '金鑰設定不能被蓋掉');
  assert.equal(legacyStorageKey('templates'), null);
  assert.equal(legacyStorageKey('dates:4F'), null);
  assert.equal(legacyStorageKey('帷幕骨架'), 'autofit:v1:帷幕骨架');
});

test('舊版 key 的暫存第一次讀取時搬到新 key（既有使用者不掉暫存）', () => {
  const st = new FakeStorage();
  const rec = { 'a.jpg': { desc: '舊', status: 'confirmed', order: 0 } };
  st.setItem('autofit:v1:帷幕骨架', JSON.stringify(rec));
  assert.deepEqual(loadSaved('帷幕骨架', st), rec);
  assert.equal(st.getItem('autofit:v1:帷幕骨架'), null, '舊 key 搬走');
  assert.equal(st.getItem(storageKey('帷幕骨架')), JSON.stringify(rec));
  assert.deepEqual(loadSaved('帷幕骨架', st), rec, '第二次直接讀新 key');
});

test('loadSaved：暫存被寫成 "null"／陣列／字串 → 當作沒有（回傳 {}），applySaved 才不會炸', () => {
  for (const bad of ['null', '[]', '"x"', '123']) {
    const st = new FakeStorage();
    st.setItem(storageKey('root'), bad);
    assert.deepEqual(loadSaved('root', st), {}, `壞掉的暫存 ${bad}`);
    assert.doesNotThrow(() => applySaved([{ path: 'a.jpg', desc: '', status: 'pending', order: 0 }], loadSaved('root', st), { engine: null }));
  }
  const st = new FakeStorage();
  st.setItem(storageKey('root'), '{"a.jpg":{"desc":"還在"}}');
  assert.equal(loadSaved('root', st)['a.jpg'].desc, '還在', '正常的物件照讀');
});
