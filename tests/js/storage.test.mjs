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
  const n = applySaved(fresh, loadSaved('root', st));
  assert.equal(n, 1);
  assert.equal(fresh[0].desc, 'd');
  assert.equal(fresh[0].status, 'ai');
  assert.equal(fresh[0].order, 1);
  assert.equal(fresh[1].desc, 'y');
});

test('loadSaved：壞掉的 JSON 回空物件', () => {
  const st = new FakeStorage();
  st.setItem(storageKey('r'), '{bad');
  assert.deepEqual(loadSaved('r', st), {});
});
