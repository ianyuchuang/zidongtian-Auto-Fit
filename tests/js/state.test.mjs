import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS,
  statusFromResult,
  fieldWarnings,
  filterPhotos,
  counts,
  nextPendingReview,
  sortPhotos,
  reorderWithinDir,
  assignOrder,
  TRASH_DIR,
  isTrashDir,
  isTrashed,
  trashDirOf,
  ownerOfTrash,
  groupDirOf,
  pruneChecked,
  moveSummary,
} from '../../web/js/state.js';

const mk = (id, dir, status, extra = {}) => ({ id, dir, status, desc: id, name: `${id}.jpg`, order: 0, ...extra });
const photos = [
  mk('a', '4F', STATUS.PARSED, { order: 0 }),
  mk('b', '4F', STATUS.PARSED, { order: 1 }),
  mk('c', '5F', STATUS.AI, { order: 0, confidence: 92 }),
  mk('d', '5F', STATUS.LOW, { order: 1, confidence: 61 }),
  mk('e', '5F', STATUS.CONFIRMED, { order: 2 }),
  mk('f', '', STATUS.PENDING, { order: 0 }),
];

const OK = { desc: '輕隔間 1107梯廳', design: '555×450', actual: '556×450 cm' };

test('statusFromResult：門檻 85，欄位健全才看信心', () => {
  assert.equal(statusFromResult({ ...OK, confidence: 92 }), STATUS.AI);
  assert.equal(statusFromResult({ ...OK, confidence: 85 }), STATUS.AI);
  assert.equal(statusFromResult({ ...OK, confidence: 84.9 }), STATUS.LOW);
  // 沒給信心 → 當低信心，不要靜靜當成可用（回歸：舊版當成 AI 待校對）
  assert.equal(statusFromResult({ ...OK, confidence: null }), STATUS.LOW);
  assert.equal(statusFromResult({}), STATUS.LOW);
});

test('statusFromResult：欄位有毛病時，信心再高也算低信心（回歸：Haiku 全錯卻給 68%）', () => {
  assert.equal(statusFromResult({ ...OK, desc: '', confidence: 99 }), STATUS.LOW);
  assert.equal(statusFromResult({ ...OK, actual: '', confidence: 99 }), STATUS.LOW);
  assert.equal(statusFromResult({ ...OK, design: '標準尺寸未能完全辨識', confidence: 99 }), STATUS.LOW);
  assert.equal(statusFromResult({ ...OK, actual: '106', confidence: 99 }), STATUS.LOW);
});

test('fieldWarnings：每種毛病都說得出原因；正常的三欄沒有警告', () => {
  assert.deepEqual(fieldWarnings(OK), []);
  assert.deepEqual(fieldWarnings({ ...OK, desc: '  ' }), ['內容說明是空的']);
  assert.deepEqual(fieldWarnings({ ...OK, design: '' }), ['設計或實際是空的']);
  assert.match(fieldWarnings({ ...OK, actual: '無法辨識' })[0], /讀不出來/);
  assert.match(fieldWarnings({ ...OK, design: '443×182 cm', actual: '182' })[0], /數字個數/);
  // 單位不同但數字組數一樣 → 不算毛病（443×182 vs 443x182cm）
  assert.deepEqual(fieldWarnings({ ...OK, design: '443×182', actual: '443x182cm' }), []);
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

test('回收桶：每個資料夾各一個，路徑任何一層叫 _回收桶 都算', () => {
  assert.equal(TRASH_DIR, '_回收桶');
  assert.equal(isTrashDir('_回收桶'), true);
  assert.equal(isTrashDir('4F/_回收桶'), true);
  assert.equal(isTrashDir('4F/_回收桶/舊'), true);
  assert.equal(isTrashDir('_回收桶2'), false);
  assert.equal(isTrashDir('4F'), false);
  assert.equal(isTrashDir(''), false);
  assert.equal(isTrashDir(undefined), false);
  assert.equal(isTrashed({ dir: '4F/_回收桶' }), true);
  assert.equal(isTrashed({ dir: '4F' }), false);
});

test('trashDirOf / ownerOfTrash / groupDirOf：刪除的去處與還原的目的地', () => {
  assert.equal(trashDirOf(''), '_回收桶');
  assert.equal(trashDirOf('4F'), '4F/_回收桶');
  assert.equal(trashDirOf('4F/東側'), '4F/東側/_回收桶');
  assert.equal(ownerOfTrash('4F/_回收桶'), '4F');
  assert.equal(ownerOfTrash('_回收桶'), '');
  assert.equal(ownerOfTrash('4F'), '4F');
  // 已刪除的照片在表格裡仍歸原資料夾
  assert.equal(groupDirOf({ dir: '4F/_回收桶' }), '4F');
  assert.equal(groupDirOf({ dir: '4F' }), '4F');
});

test('已刪除的照片：只在「全部」出現、不進統計、排在該資料夾最後', () => {
  const withTrash = [...photos, mk('t1', '4F/_回收桶', STATUS.LOW, { order: 0, confidence: 50 })];
  // chip
  assert.ok(filterPhotos(withTrash, { chip: 'all' }).some((p) => p.id === 't1'));
  assert.ok(!filterPhotos(withTrash, { chip: 'low' }).some((p) => p.id === 't1'));
  assert.ok(!filterPhotos(withTrash, { chip: 'ai' }).some((p) => p.id === 't1'));
  // 資料夾篩選看的是「原本的資料夾」
  assert.deepEqual(filterPhotos(withTrash, { dir: '4F' }).map((p) => p.id), ['a', 'b', 't1']);
  // 統計
  const c = counts(withTrash);
  assert.equal(c.all, 6, '已刪除的不算進全部');
  assert.equal(c.low, 1);
  assert.equal(c.trashed, 1);
  // 排序：留在 4F 群組，但排最後
  assert.deepEqual(sortPhotos(withTrash, ['', '4F', '5F']).map((p) => p.id), ['f', 'a', 'b', 't1', 'c', 'd', 'e']);
});

test('搜尋：內容說明找不到時也比對檔名', () => {
  assert.deepEqual(filterPhotos(photos, { query: 'e.jpg' }).map((p) => p.id), ['e']);
  assert.deepEqual(filterPhotos(photos, { query: 'zzz' }), []);
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

test('classifyDrop：入口頁拖進來的東西怎麼分（拖歪了也要認得出來）', async () => {
  const { classifyDrop } = await import('../../web/js/ui/dnd.js');
  assert.equal(classifyDrop({ isDirectory: true }), 'folder');
  assert.equal(classifyDrop({ isDirectory: true, fileName: 'x.docx' }), 'folder'); // 資料夾優先
  assert.equal(classifyDrop({ fileName: '版型.docx' }), 'template');
  assert.equal(classifyDrop({ fileName: '版型.DOCX' }), 'template');
  assert.equal(classifyDrop({ fileName: '舊的.doc' }), 'old-doc');
  assert.equal(classifyDrop({ fileName: 'a.jpg' }), 'other-file');
  assert.equal(classifyDrop({}), 'unsupported');
});
