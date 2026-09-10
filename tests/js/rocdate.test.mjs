import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRocInput, rocCompact, rocDisplay, rocDot, stampText, todayRoc } from '../../web/js/rocdate.js';

test('parseRocInput：民國 7 碼', () => {
  const d = parseRocInput('1150725');
  assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate()], [2026, 7, 25]);
});

test('parseRocInput：西元 8 碼與含分隔符', () => {
  assert.equal(rocCompact(parseRocInput('2026-07-25')), '1150725');
  assert.equal(rocCompact(parseRocInput('115/07/25')), '1150725');
});

test('parseRocInput：看不懂或不存在的日期要丟錯', () => {
  assert.throws(() => parseRocInput('abc'), /看不懂的日期/);
  assert.throws(() => parseRocInput('1150230'), /日期不存在/);
  assert.throws(() => parseRocInput(''), /看不懂的日期/);
});

test('格式化', () => {
  const d = new Date(2026, 6, 25);
  assert.equal(rocCompact(d), '1150725');
  assert.equal(rocDisplay(d), '115年07月25日');
  assert.equal(rocDot(d), '115.7.25'); // 拍照日期欄：月日不補 0
  assert.equal(rocDot(new Date(2026, 5, 14)), '115.6.14');
  assert.equal(stampText(d), '2026-07-25');
  assert.equal(todayRoc(new Date(2026, 8, 2)), '1150902');
});

test('parseRocInput：照文件格式打 115.6.14 也要過（回歸：去掉點變六碼就被拒）；西元帶點、中文年月日也可以', () => {
  assert.equal(rocCompact(parseRocInput('115.6.14')), '1150614');
  assert.equal(rocCompact(parseRocInput('115/6/14')), '1150614');
  assert.equal(rocCompact(parseRocInput('2026.6.14')), '1150614');
  assert.equal(rocCompact(parseRocInput('115年6月14日')), '1150614');
  assert.equal(rocCompact(parseRocInput(' 115-06-14 ')), '1150614');
});

test('parseRocInput：六碼純數字（115614）分不出月日 → 丟錯，訊息要顯示使用者打的原字串', () => {
  assert.throws(() => parseRocInput('115614'), (e) => e.message.includes('115614') && /看不懂的日期/.test(e.message));
  assert.throws(() => parseRocInput('115.13.1'), /日期不存在：115\.13\.1/);
  assert.throws(() => parseRocInput('115072511'), /看不懂的日期/); // 9 碼
});
