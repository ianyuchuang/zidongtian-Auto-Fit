// 版型頁：掛／拆頁時事件要收乾淨（2026-09-04 的 bug：存成版型跳好幾個「儲存成功」、套的卻是上一次的版型）。
// 用最小的假 DOM：只記 addEventListener／removeEventListener，並照 { signal } 的規矩在 abort 時拆掉。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountTemplatePage, clampInt, readParts, partsHtml, alignMenuHtml } from '../../web/js/ui/template-page.js';

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
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  /** 照瀏覽器的規矩呼叫掛在這顆元素上的某種事件。 */
  fire(type, event) {
    return Promise.all(this.listeners.filter((l) => l.type === type).map((l) => l.fn(event)));
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
    for (const t of ['click', 'change', 'dragstart', 'dragend', 'contextmenu']) assert.equal(c.count(t), 1, t);
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
    for (const t of ['click', 'change', 'dragstart', 'dragend', 'contextmenu']) assert.equal(c.count(t), 1, t);
    assert.equal(win.count('resize'), 1);
    assert.equal(c.count('contextmenu'), 1);
  });
});

test('拆掉後格子右鍵選單的監聽（容器的 contextmenu、window 的關閉事件）都收掉', () => {
  withWindow((win) => {
    const c = new FakeContainer();
    const unmount = mountTemplatePage(c, fakeApp());
    assert.equal(c.count('contextmenu'), 1);
    for (const t of ['mousedown', 'keydown', 'scroll']) assert.equal(win.count(t), 1, t);
    unmount();
    assert.equal(c.count('contextmenu'), 0);
    for (const t of ['mousedown', 'keydown', 'scroll']) assert.equal(win.count(t), 0, t);
  });
});

test('還沒讀版型、或右鍵不在格子上：不擋瀏覽器預設選單', async () => {
  await withWindow(async () => {
    const c = new FakeContainer();
    mountTemplatePage(c, fakeApp());
    let prevented = 0;
    await c.fire('contextmenu', { target: { closest: () => null }, preventDefault: () => prevented++ });
    await c.fire('contextmenu', { target: { closest: () => ({ dataset: { cell: '1.0' } }) }, preventDefault: () => prevented++ });
    assert.equal(prevented, 0); // spec 是 null，格子也不存在
  });
});

test('alignMenuHtml：水平／垂直各三項，目前的選擇打勾（沒寫＝靠左、垂直置中）', () => {
  const html = alignMenuHtml({ kind: 'text' });
  for (const v of ['left', 'center', 'right']) assert.match(html, new RegExp(`data-align="${v}"`));
  for (const v of ['top', 'center', 'bottom']) assert.match(html, new RegExp(`data-valign="${v}"`));
  assert.match(html, /on" data-align="left">/);
  assert.match(html, /on" data-valign="center">/);
  assert.equal((html.match(/tp-menu-tick/g) ?? []).length, 2);
  const h2 = alignMenuHtml({ kind: 'photo', align: 'right', vAlign: 'bottom' });
  assert.match(h2, /on" data-align="right">/);
  assert.match(h2, /on" data-valign="bottom">/);
  assert.doesNotMatch(h2, /on" data-align="left">/);
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

test('clampInt：數字框打 2.5／空白／超界都修成範圍內的整數', () => {
  assert.equal(clampInt('2.5', 1, 6, 1), 3);
  assert.equal(clampInt('', 1, 6, 4), 4); // 空白＝維持原值
  assert.equal(clampInt('abc', 1, 6, 4), 4);
  assert.equal(clampInt('0', 10, 2000, 300), 10);
  assert.equal(clampInt('99999', 10, 2000, 300), 2000);
  assert.equal(clampInt('300', 10, 2000, 50), 300);
});

// ---- 說明格一行的讀寫（Shift+Enter 的換行）----
const T = (t) => ({ nodeType: 3, nodeName: '#text', nodeValue: t });
const BR = () => ({ nodeType: 1, nodeName: 'BR' });
const TAG = (f) => ({ nodeType: 1, nodeName: 'SPAN', classList: { contains: (c) => c === 'tp-tag' }, dataset: { field: f } });
const el = (...childNodes) => ({ childNodes });

test('readParts：結尾兩顆 <br> 只留一顆（瀏覽器補的佔位符），單獨一顆是使用者的換行要留', () => {
  assert.deepEqual(readParts(el(T('a'), BR(), BR())), [{ text: 'a' }, { br: true }]);
  assert.deepEqual(readParts(el(T('a'), BR())), [{ text: 'a' }, { br: true }]);
  assert.deepEqual(readParts(el(T('a'), BR(), T('b'))), [{ text: 'a' }, { br: true }, { text: 'b' }]);
  assert.deepEqual(readParts(el(TAG('desc'), T('，'), TAG(''))), [{ field: 'desc' }, { text: '，' }, { field: null }]);
  assert.deepEqual(readParts(el()), []);
});

test('partsHtml ↔ readParts：結尾換行重畫後不會掉', () => {
  const parts = [{ text: '備註' }, { br: true }];
  const html = partsHtml(parts);
  assert.equal(html, '備註<br><br>'); // 多補一顆，contenteditable 才看得見那個換行
  // 模擬瀏覽器把這段 HTML 掛上去後再讀回來
  assert.deepEqual(readParts(el(T('備註'), BR(), BR())), parts);
  assert.equal(partsHtml([{ text: 'a' }, { br: true }, { text: 'b' }]), 'a<br>b');
  assert.equal(partsHtml([{ field: 'none' }, { text: 'x' }]), 'x'); // 'none' 不畫
});

test('「完成，使用這個版型」會先存進版型庫，套用的 spec 帶著庫裡的 id', async () => {
  const { saveTemplate, listTemplates, getTemplate } = await import('../../web/js/template/library.js');
  const { defaultSpec } = await import('../../web/js/template/spec.js');
  const store = new Map();
  const prevLS = globalThis.localStorage;
  const prevDoc = globalThis.document;
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const toasts = [];
  // toast 只用到這些：template 元素拿 innerHTML 的第一個節點、#toast-root 收下它
  globalThis.document = {
    createElement: () => ({ set innerHTML(h) { this.content = { firstElementChild: { html: h, remove() {} } }; } }),
    getElementById: () => ({ appendChild: (t) => toasts.push(t.html) }),
  };
  try {
    await withWindow(async () => {
      const saved = saveTemplate(defaultSpec(), '電氣');
      const applied = [];
      const app = { ...fakeApp(), applyTemplate: (t) => applied.push(t) };
      const c = new FakeContainer();
      mountTemplatePage(c, app);
      const btn = (act, id) => ({ target: { closest: () => ({ dataset: { act, id } }) } });
      await c.fire('click', btn('pick-edit', saved.id)); // 從版型庫「調整」
      // 改了每列張數（走 change 事件），沒按「存成版型」就直接按「完成」
      await c.fire('change', { target: { dataset: { grid: 'perRow' }, value: '3', max: '6' } });
      c.querySelector('#tpl-name').value = '電氣';
      await c.fire('click', btn('use'));
      assert.equal(applied.length, 1);
      assert.equal(applied[0].spec.id, saved.id, '同名重存要沿用原本的 id');
      assert.equal(applied[0].spec.grid.perRow, 3);
      assert.equal(listTemplates().length, 1);
      assert.equal(getTemplate(saved.id).spec.grid.perRow, 3, '庫裡那份也要是改過的');
      assert.equal(toasts.length, 1, '只跳一次「已存成版型」');
      assert.match(toasts[0], /已存成版型/);
    });
  } finally {
    globalThis.localStorage = prevLS;
    globalThis.document = prevDoc;
  }
});
