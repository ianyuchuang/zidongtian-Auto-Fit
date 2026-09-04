import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listTemplates, saveTemplate, getTemplate, removeTemplate, rememberFor, lastFor, LIB_KEY } from '../../web/js/template/library.js';
import { defaultSpec } from '../../web/js/template/spec.js';

const fakeStore = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
};

test('存、列、取、刪', () => {
  const s = fakeStore();
  const a = saveTemplate(defaultSpec(), '輕隔間', s);
  assert.equal(a.name, '輕隔間');
  assert.equal(a.spec.name, '輕隔間');
  assert.deepEqual(listTemplates(s).map((t) => t.name), ['輕隔間']);
  assert.equal(getTemplate(a.id, s).spec.grid.perRow, 2);
  removeTemplate(a.id, s);
  assert.deepEqual(listTemplates(s), []);
});

test('同名覆蓋，不會愈存愈多份', () => {
  const s = fakeStore();
  saveTemplate(defaultSpec(), '同一份', s);
  const spec = defaultSpec();
  spec.grid.perRow = 3;
  saveTemplate(spec, '同一份', s);
  const list = listTemplates(s);
  assert.equal(list.length, 1);
  assert.equal(list[0].spec.grid.perRow, 3);
});

test('存進去的是複本，之後改 spec 不會動到庫裡那份', () => {
  const s = fakeStore();
  const spec = defaultSpec();
  saveTemplate(spec, 'X', s);
  spec.grid.perRow = 5;
  assert.equal(listTemplates(s)[0].spec.grid.perRow, 2);
});

test('記住每個資料夾上次用的版型', () => {
  const s = fakeStore();
  const t = saveTemplate(defaultSpec(), '電氣', s);
  rememberFor('帷幕骨架', t.id, s);
  assert.equal(lastFor('帷幕骨架', s).name, '電氣');
  assert.equal(lastFor('別的資料夾', s), null);
  rememberFor('帷幕骨架', null, s); // 改用預設版面
  assert.equal(lastFor('帷幕骨架', s), null);
});

test('壞掉的 JSON 當作空的，不要炸掉入口頁', () => {
  const s = fakeStore();
  s.setItem(LIB_KEY, '{壞掉');
  assert.deepEqual(listTemplates(s), []);
  assert.equal(lastFor('x', s), null);
});

test('同名再存沿用原 id，資料夾記住的版型不會斷', () => {
  const s = fakeStore();
  const a = saveTemplate(defaultSpec(), '電氣', s);
  rememberFor('帷幕骨架', a.id, s);
  const spec = defaultSpec();
  spec.grid.perRow = 3;
  const b = saveTemplate(spec, '電氣', s);
  assert.equal(b.id, a.id);
  assert.equal(b.spec.id, a.id);
  assert.equal(lastFor('帷幕骨架', s).spec.grid.perRow, 3);
});

test('同一毫秒連存兩份不同名的版型，id 不會撞', () => {
  const s = fakeStore();
  const ids = new Set();
  for (let i = 0; i < 50; i++) ids.add(saveTemplate(defaultSpec(), `版型${i}`, s).id);
  assert.equal(ids.size, 50);
  assert.equal(listTemplates(s).length, 50);
});
