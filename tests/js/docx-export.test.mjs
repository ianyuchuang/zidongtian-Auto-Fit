// buildDocxBlob 的行為（不驗 XML，版面 XML 由 tests/test_docx_export.py 驗）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const iife = readFileSync(join(here, '../../web/vendor/docx-9.7.1.iife.js'), 'utf8');
globalThis.docx = new Function(`${iife}; return docx;`)();

const { buildDocxBlob } = await import('../../web/js/docx-export.js');
const { defaultSpec } = await import('../../web/js/template/spec.js');

const JPEG_1PX = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

function fakeRender(seen) {
  return async (file, opts) => {
    seen.push(opts.stamp);
    return { data: new Uint8Array(JPEG_1PX), width: 1, height: 1, type: 'jpg' };
  };
}

const group = { photos: [{ name: 'a.jpg', file: 'a', desc: 'A', design: 'D', actual: 'R' }] };

test('日期戳：spec.stamp.on 決定要不要烙上去', async () => {
  let seen = [];
  await buildDocxBlob(group, { spec: defaultSpec(), rocDisplay: '115年07月25日', stamp: '2026-07-25', render: fakeRender(seen) });
  assert.deepEqual(seen, ['2026-07-25']);

  const off = defaultSpec();
  off.stamp.on = false;
  seen = [];
  await buildDocxBlob(group, { spec: off, rocDisplay: '115年07月25日', stamp: '2026-07-25', render: fakeRender(seen) });
  assert.deepEqual(seen, ['']);
});

test('照片讀不出來只列進 failures，不中斷整份輸出', async () => {
  const render = async (file) => {
    if (file === 'bad') throw new Error('壞檔');
    return { data: new Uint8Array(JPEG_1PX), width: 1, height: 1, type: 'jpg' };
  };
  const g = { photos: [{ name: 'a.jpg', file: 'a', desc: 'A' }, { name: 'b.jpg', file: 'bad', desc: 'B' }] };
  const { blob, failures } = await buildDocxBlob(g, { spec: defaultSpec(), rocDisplay: '115年07月25日', render });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /b\.jpg：壞檔/);
  assert.ok(blob.size > 500);
});

test('版型不完整就大聲失敗，不產出錯的 Word', async () => {
  const bad = defaultSpec();
  bad.unknown = ['每頁列數'];
  await assert.rejects(
    () => buildDocxBlob(group, { spec: bad, rocDisplay: '115年07月25日', render: fakeRender([]) }),
    /版型不完整/,
  );
});
