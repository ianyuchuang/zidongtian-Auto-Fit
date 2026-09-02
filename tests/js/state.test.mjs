import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS,
  statusFromConfidence,
  filterPhotos,
  counts,
  nextPendingReview,
  sortPhotos,
  reorderWithinDir,
  assignOrder,
  TRASH_DIR,
  isTrashDir,
  pruneChecked,
  moveSummary,
} from '../../web/js/state.js';

const mk = (id, dir, status, extra = {}) => ({ id, dir, status, desc: id, order: 0, ...extra });
const photos = [
  mk('a', '4F', STATUS.PARSED, { order: 0 }),
  mk('b', '4F', STATUS.PARSED, { order: 1 }),
  mk('c', '5F', STATUS.AI, { order: 0, confidence: 92 }),
  mk('d', '5F', STATUS.LOW, { order: 1, confidence: 61 }),
  mk('e', '5F', STATUS.CONFIRMED, { order: 2 }),
  mk('f', '', STATUS.PENDING, { order: 0 }),
];

test('statusFromConfidence：門檻 70', () => {
  assert.equal(statusFromConfidence(92), STATUS.AI);
  assert.equal(statusFromConfidence(70), STATUS.AI);
  assert.equal(statusFromConfidence(69.9), STATUS.LOW);
  assert.equal(statusFromConfidence(null), STATUS.AI);
});

test('filterPhotos：chip / 搜尋 / 資料夾', () => {
  assert.deepEqual(filterPhotos(photos, { chip: 'parsed' }).map((p) => p.id), ['a', 'b']);
  assert.deepEqual(filterPhotos(photos, { chip: 'ai' }).map((p) => p.id), ['c', 'd']);
  assert.deepEqual(filterPhotos(photos, { chip: 'low' }).map((p) => p.id), ['d']);
  assert.deepEqual(filterPhotos(photos, { dir: '5F' }).map((p) => p.id), ['c', 'd', 'e']);
  assert.deepEqual(filterPhotos(photos, { query: ' E ' }).map((p) => p.id), ['e']);
  assert.deepEqual(filterPhotos(photos, { chip: 'ai', dir: '4F' }), []);
});

test('counts', () => {
  const c = counts(photos);
  assert.equal(c.all, 6);
  assert.equal(c.parsed, 2);
  assert.equal(c.ai, 2);
  assert.equal(c.low, 1);
  assert.equal(c.confirmed, 1);
  assert.equal(c.pending, 1);
  assert.equal(c.recognized, 5);
  assert.equal(c.toReview, 2);
});

test('nextPendingReview：從目前之後循環找', () => {
  assert.equal(nextPendingReview(photos, 'c').id, 'd');
  assert.equal(nextPendingReview(photos, 'd').id, 'c'); // 繞回去
  assert.equal(nextPendingReview(photos, 'zzz').id, 'c'); // 找不到起點就從頭
  assert.equal(nextPendingReview([photos[0]], 'a'), null);
  assert.equal(nextPendingReview([], 'a'), null);
});

test('sortPhotos：依資料夾順序再依 order', () => {
  const sorted = sortPhotos(photos, ['', '4F', '5F']);
  assert.deepEqual(sorted.map((p) => p.id), ['f', 'a', 'b', 'c', 'd', 'e']);
});

test('reorderWithinDir：同資料夾前後插入；跨資料夾回 null', () => {
  assert.deepEqual(reorderWithinDir(photos, 'e', 'c', 'before'), ['e', 'c', 'd']);
  assert.deepEqual(reorderWithinDir(photos, 'c', 'd', 'after'), ['d', 'c', 'e']);
  assert.equal(reorderWithinDir(photos, 'a', 'c', 'before'), null);
  assert.equal(reorderWithinDir(photos, 'a', 'a', 'before'), null);
  const order = assignOrder(['e', 'c', 'd']);
  assert.equal(order.get('e'), 0);
  assert.equal(order.get('d'), 2);
});

test('isTrashDir：回收桶本身與其下層', () => {
  assert.equal(TRASH_DIR, '_回收桶');
  assert.equal(isTrashDir('_回收桶'), true);
  assert.equal(isTrashDir('_回收桶/舊'), true);
  assert.equal(isTrashDir('_回收桶2'), false);
  assert.equal(isTrashDir('4F/_回收桶'), false);
  assert.equal(isTrashDir(''), false);
  assert.equal(isTrashDir(undefined), false);
});

test('pruneChecked：只留還存在的 id', () => {
  const checked = new Set(['a', 'zzz', 'e']);
  assert.equal(pruneChecked(checked, photos), 1);
  assert.deepEqual([...checked], ['a', 'e']);
  assert.equal(pruneChecked(checked, photos), 0);
});

test('moveSummary：成功 / 部分失敗 / 沒動 / 唯讀', () => {
  assert.equal(moveSummary({ moved: 3, failed: [] }, '5F'), '已搬 3 張到「5F」');
  assert.equal(moveSummary({ moved: 1, failed: [] }, '5F', { readOnly: true }), '已搬 1 張到「5F」（唯讀複本，未動到實際檔案）');
  assert.equal(
    moveSummary({ moved: 1, failed: [{ name: 'a.jpg', error: '同名' }] }, '5F'),
    '已搬 1 張到「5F」。1 張失敗：a.jpg（同名）',
  );
  assert.equal(moveSummary({ moved: 0, failed: [] }, '5F'), '沒有需要搬移的照片');
});
