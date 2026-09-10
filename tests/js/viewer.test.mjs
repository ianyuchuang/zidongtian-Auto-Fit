// 檢視器不碰 DOM 的判斷：大圖載入旗標、裁切要不要重做、「確認，下一張」的提示。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoadGate, cropNeedsReload, confirmFeedback, CROP_FAILED } from '../../web/js/ui/viewer.js';
import { createApp } from '../../web/js/app.js';
import { MemoryDirectoryHandle } from '../../web/js/fs/memory.js';

test('大圖載入旗標：上一張的 finally 不能把這一張的旗標清掉（回歸：同一張大圖重複 fullUrl() 多建 blob URL）', () => {
  const gate = createLoadGate();
  assert.equal(gate.begin(1), true);
  assert.equal(gate.begin(1), false, '同一輪還在載：patch() 進來不能再叫一次');
  // 換到第 2 張（第 1 張的 fullUrl 還沒回來）
  assert.equal(gate.begin(2), true);
  gate.end(1); // 第 1 張這時才回來
  assert.equal(gate.loading, 2, '第 2 張的旗標要還在');
  assert.equal(gate.begin(2), false, '所以 patch() 仍不會重載第 2 張');
  gate.end(2);
  assert.equal(gate.loading, null);
  assert.equal(gate.begin(2), true, '結束後（例如失敗按重試）可以再載');
});

test('裁切重做：重跑辨識後 p.cropUrl 變 null（或換了）而畫面上還是舊圖 → 要重裁（回歸：舊 <img> 還在就不重做）', () => {
  const bbox = { x: 0.6, y: 0.6, w: 0.3, h: 0.3 };
  assert.equal(cropNeedsReload({ bbox, cropUrl: 'blob:old' }, 'blob:old'), false, '同一張圖不重做');
  assert.equal(cropNeedsReload({ bbox, cropUrl: null }, 'blob:old'), true, '重跑後 cropUrl 被清掉');
  assert.equal(cropNeedsReload({ bbox, cropUrl: 'blob:new' }, 'blob:old'), true, '換了裁切');
  assert.equal(cropNeedsReload({ bbox, cropUrl: null }, null), true, '辨識完剛拿到 bbox、還沒裁');
  assert.equal(cropNeedsReload({ bbox: null, cropUrl: null }, null), false, '還沒辨識：沒東西可裁');
  assert.equal(cropNeedsReload({ bbox: { x: 0, y: 0, w: 1, h: 1 }, cropUrl: null }, null), false, '框不合理不裁');
  assert.equal(cropNeedsReload({ bbox, cropUrl: null }, CROP_FAILED), false, '裁切失敗不自動重試（會一直閃）');
});

test('確認，下一張：已刪除的講「不能確認」、沒有下一張講「沒有其他待校對」（跟「跳過」一致）、正常不提示', async () => {
  assert.equal(confirmFeedback({ confirmed: false, next: false }), '已刪除的照片不能確認');
  assert.equal(confirmFeedback({ confirmed: true, next: false }), '沒有其他待校對的照片了');
  assert.equal(confirmFeedback({ confirmed: true, next: true }), null);
  // 跟 app.confirmAndNext 接起來
  const root = new MemoryDirectoryHandle('r');
  const f = await root.getDirectoryHandle('4F', { create: true });
  f.putFile('a.jpg', new File(['a'], 'a.jpg'));
  f.putFile('b.jpg', new File(['b'], 'b.jpg'));
  const app = createApp();
  app.state.root = root;
  await app.rescan();
  await app.trash(['4F/a.jpg']);
  assert.equal(confirmFeedback(app.confirmAndNext('4F/_回收桶/a.jpg')), '已刪除的照片不能確認');
  assert.equal(confirmFeedback(app.confirmAndNext('4F/b.jpg')), '沒有其他待校對的照片了');
  assert.equal(app.photo('4F/b.jpg').status, 'confirmed');
});
