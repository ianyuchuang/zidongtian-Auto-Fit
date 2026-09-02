// 燈箱的縮放/平移數學（純函式，不碰 DOM）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp, wheelFactor, zoomAt, clampPan, isTypingTarget, MIN_SCALE, MAX_SCALE, IDENTITY } from '../../web/js/ui/lightbox.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('clamp 夾在上下界之間', () => {
  assert.equal(clamp(5, 1, 8), 5);
  assert.equal(clamp(-3, 1, 8), 1);
  assert.equal(clamp(99, 1, 8), 8);
});

test('wheelFactor：往上滾（deltaY<0）放大、往下滾縮小、不動為 1', () => {
  assert.ok(wheelFactor(-100) > 1);
  assert.ok(wheelFactor(100) < 1);
  near(wheelFactor(0), 1);
  // 反向滾同樣格數要能回到原點
  near(wheelFactor(-100) * wheelFactor(100), 1, 1e-12);
});

test('zoomAt：游標所在的點縮放後仍停在同一個螢幕位置', () => {
  const before = { scale: 1, tx: 0, ty: 0 };
  const px = 120;
  const py = 90;
  const after = zoomAt(before, { factor: 2, px, py });
  assert.equal(after.scale, 2);
  // 錨點在圖上的座標：(px - tx) / scale，縮放前後必須相同
  near((px - before.tx) / before.scale, (px - after.tx) / after.scale);
  near((py - before.ty) / before.scale, (py - after.ty) / after.scale);
});

test('zoomAt：縮放倍率夾在 MIN_SCALE~MAX_SCALE', () => {
  assert.equal(zoomAt({ scale: 1, tx: 0, ty: 0 }, { factor: 0.1, px: 0, py: 0 }).scale, MIN_SCALE);
  assert.equal(zoomAt({ scale: 6, tx: 0, ty: 0 }, { factor: 100, px: 0, py: 0 }).scale, MAX_SCALE);
});

test('zoomAt：連續縮放到上限後，錨點換算仍有效（不會爆 NaN）', () => {
  let v = { ...IDENTITY };
  for (let i = 0; i < 40; i++) v = zoomAt(v, { factor: wheelFactor(-120), px: 50, py: 50 });
  assert.equal(v.scale, MAX_SCALE);
  assert.ok(Number.isFinite(v.tx) && Number.isFinite(v.ty));
});

test('clampPan：scale=1 時貼齊原點，不能被拖走', () => {
  assert.deepEqual(clampPan({ scale: 1, tx: -80, ty: 40 }, { w: 400, h: 300 }), { scale: 1, tx: 0, ty: 0 });
});

test('clampPan：放大後只能在 [容器-圖寬, 0] 之間平移', () => {
  const box = { w: 400, h: 300 };
  assert.deepEqual(clampPan({ scale: 2, tx: 50, ty: 10 }, box), { scale: 2, tx: 0, ty: 0 });
  assert.deepEqual(clampPan({ scale: 2, tx: -9999, ty: -9999 }, box), { scale: 2, tx: -400, ty: -300 });
  assert.deepEqual(clampPan({ scale: 2, tx: -120, ty: -60 }, box), { scale: 2, tx: -120, ty: -60 });
});

test('縮放後再夾限：右下角放大不會出現空白邊', () => {
  const box = { w: 400, h: 300 };
  const v = clampPan(zoomAt({ ...IDENTITY }, { factor: 3, px: 400, py: 300 }), box);
  assert.equal(v.scale, 3);
  near(v.tx, -800);
  near(v.ty, -600);
});

// 燈箱是非強制視窗（不擋右欄），快捷鍵不能搶走輸入格的鍵盤
test('isTypingTarget：輸入格／文字區／下拉／contenteditable 算在打字', () => {
  assert.equal(isTypingTarget({ tagName: 'INPUT' }), true);
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTypingTarget({ tagName: 'SELECT' }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
});

test('isTypingTarget：一般元素與 null 不算', () => {
  assert.equal(isTypingTarget({ tagName: 'DIV' }), false);
  assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget(undefined), false);
});
