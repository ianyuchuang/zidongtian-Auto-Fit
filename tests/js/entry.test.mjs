// 入口頁不碰 DOM 的判斷。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanOutcome } from '../../web/js/ui/entry.js';

test('scanOutcome：掃到一半入口頁被拆掉（拖 docx 進版型頁）→ 只更新 state、不動 DOM（回歸：對已拆掉的元素寫入變 unhandled rejection）', () => {
  const live = { isConnected: true };
  assert.equal(scanOutcome({ seq: 1, pickSeq: 1, el: live }), 'live');
  assert.equal(scanOutcome({ seq: 1, pickSeq: 1, el: { isConnected: false } }), 'detached');
  assert.equal(scanOutcome({ seq: 1, pickSeq: 1, el: null }), 'detached');
  assert.equal(scanOutcome({ seq: 1, pickSeq: 2, el: live }), 'stale', '期間又選了別的資料夾：什麼都不做');
  assert.equal(scanOutcome({ seq: 1, pickSeq: 2, el: null }), 'stale', '換了資料夾又拆頁：仍以 stale 為準，不寫舊摘要');
});
