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
