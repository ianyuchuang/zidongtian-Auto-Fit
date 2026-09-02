import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializePhotos, applySaved, savePhotos, loadSaved, storageKey } from '../../web/js/storage.js';

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

test('serializePhotos：只存需要的欄位、略過 pending，不存 handle/file', () => {
  const out = serializePhotos([
    { path: '4F/a.jpg', desc: 'a', design: '1', actual: '2', status: 'confirmed', order: 3, handle: {}, file: {}, confidence: null, source: 'filename', bbox: null },
    { path: '5F/b.jpg', desc: '', status: 'pending', order: 0 },
  ]);
  assert.deepEqual(Object.keys(out), ['4F/a.jpg']);
  assert.deepEqual(out['4F/a.jpg'], { desc: 'a', design: '1', actual: '2', confidence: null, source: 'filename', status: 'confirmed', bbox: null, order: 3 });
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
