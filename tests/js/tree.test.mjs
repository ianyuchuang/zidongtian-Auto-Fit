// 左樹：點節點要套哪個資料夾篩選（純判斷，不碰 DOM）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirFilterFor } from '../../web/js/ui/tree.js';

test('dirFilterFor：根節點與根層的 _回收桶 都是「全部」（null），不能把空字串塞進 dirFilter（回歸：左樹沒有節點反白、子資料夾全消失）', () => {
  assert.equal(dirFilterFor(''), null);
  assert.equal(dirFilterFor('_回收桶'), null);
  assert.equal(dirFilterFor('4F'), '4F');
  assert.equal(dirFilterFor('4F/_回收桶'), '4F', '點子資料夾的回收桶＝看那個子資料夾');
  assert.equal(dirFilterFor('4F/東側'), '4F/東側');
});
