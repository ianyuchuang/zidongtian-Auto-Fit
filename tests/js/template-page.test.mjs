// 版型頁：掛／拆頁時事件要收乾淨（2026-09-04 的 bug：存成版型跳好幾個「儲存成功」、套的卻是上一次的版型）。
// 用最小的假 DOM：只記 addEventListener／removeEventListener，並照 { signal } 的規矩在 abort 時拆掉。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountTemplatePage } from '../../web/js/ui/template-page.js';

class FakeEl {
  constructor() {
    this.listeners = []; // [{ type, fn }]
    this.style = {};
    this.innerHTML = '';
    this.textContent = '';
    this.hidden = false;
    this.value = '';
    this.disabled = false;
  }
  addEventListener(type, fn, opts) {
    const rec = { type, fn };
    this.listeners.push(rec);
    opts?.signal?.addEventListener('abort', () => this.removeEventListener(type, fn));
  }
  removeEventListener(type, fn) {
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn));
  }
  count(type) {
    return this.listeners.filter((l) => l.type === type).length;
  }
}

/** 共用容器：#tpl-drop 回 null（bindPick 就不會綁選檔框），其他選擇器各給一顆假元素。 */
class FakeContainer extends FakeEl {
  constructor() {
    super();
    this.els = new Map();
  }
  querySelector(sel) {
    if (sel === '#tpl-drop') return null;
    if (!this.els.has(sel)) this.els.set(sel, new FakeEl());
    return this.els.get(sel);
  }
  querySelectorAll() {
    return [];
  }
}

const fakeApp = () => ({ state: { templateFile: null }, applyTemplate() {}, closeTemplatePage() {} });

function withWindow(fn) {
  const prev = globalThis.window;
  const win = new FakeEl();
  globalThis.window = win;
  try {
    return fn(win);
  } finally {
    globalThis.window = prev;
  }
}

test('mountTemplatePage 回傳 unmount，拆掉後容器與 window 上的監聽都收掉', () => {
  withWindow((win) => {
    const c = new FakeContainer();
    const unmount = mountTemplatePage(c, fakeApp());
    assert.equal(typeof unmount, 'function');
    for (const t of ['click', 'change', 'dragstart', 'dragend']) assert.equal(c.count(t), 1, t);
    assert.equal(win.count('resize'), 1);
    unmount();
    assert.equal(c.listeners.length, 0);
    assert.equal(win.listeners.length, 0);
  });
});

test('拆掉再掛同一個容器，每種事件只剩一套（不會疊上舊閉包）', () => {
  withWindow((win) => {
    const c = new FakeContainer();
    for (let i = 0; i < 3; i++) {
      const unmount = mountTemplatePage(c, fakeApp());
      unmount();
    }
    mountTemplatePage(c, fakeApp());
    for (const t of ['click', 'change', 'dragstart', 'dragend']) assert.equal(c.count(t), 1, t);
    assert.equal(win.count('resize'), 1);
  });
});

test('沒 unmount 就重掛會疊起來（證明前面那條測的是真的）', () => {
  withWindow(() => {
    const c = new FakeContainer();
    mountTemplatePage(c, fakeApp());
    mountTemplatePage(c, fakeApp());
    assert.equal(c.count('click'), 2);
  });
});

test('還沒讀版型時按「存成版型」不會炸（舊閉包或誤觸都只是沒反應）', async () => {
  await withWindow(async () => {
    const c = new FakeContainer();
    mountTemplatePage(c, fakeApp());
    const click = c.listeners.find((l) => l.type === 'click').fn;
    const btn = { dataset: { act: 'save' } };
    await click({ target: { closest: () => btn } });
  });
});
