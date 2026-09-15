// 內建版型（web/js/template/builtin.js）：讀 web/templates/index.json → 解析 → 版面相同的只留一份。
// fetch 用假的，直接從磁碟讀同一批檔案，測的是「讀哪些檔、怎麼去重、壞掉怎麼辦」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadBuiltins, layoutKey, dedupeByLayout } from '../../web/js/template/builtin.js';
import { defaultSpec, validateSpec } from '../../web/js/template/spec.js';

const BASE = new URL('../../web/templates/', import.meta.url);
const DIR = join(dirname(fileURLToPath(import.meta.url)), '../../web/templates');

/** 假的 fetch：只認得 BASE 底下的檔，讀得到回 200、讀不到回 404（跟瀏覽器一樣）。 */
function diskFetch(missing = []) {
  const asked = [];
  const fn = async (url) => {
    const rel = String(url).slice(String(BASE).length);
    asked.push(rel);
    if (missing.includes(rel)) return { ok: false, status: 404, text: async () => '' };
    try {
      return { ok: true, status: 200, text: async () => readFileSync(join(DIR, rel), 'utf8') };
    } catch {
      return { ok: false, status: 404, text: async () => '' };
    }
  };
  fn.asked = asked;
  return fn;
}

test('index.json 裡每一份都解析得出來，而且都是能直接用的版型', async () => {
  const list = await loadBuiltins({ base: BASE, fetchFn: diskFetch() });
  assert.ok(list.length >= 5, `內建版型只讀到 ${list.length} 份`);
  for (const t of list) {
    assert.ok(t.name && t.slug, '每一份都要有名稱與 slug');
    assert.deepEqual(t.spec.unknown, [], `${t.slug} 有讀不懂的地方`);
    assert.deepEqual(validateSpec(t.spec), [], `${t.slug} 不是可以直接用的版型`);
    assert.equal(t.spec.name, t.name, 'spec 的名稱要用 index.json 上的顯示名稱');
  }
});

test('只讀 index.json 上列到的檔，沒列到的（例如沒有頁首的那幾份）不會去要', async () => {
  const f = diskFetch();
  await loadBuiltins({ base: BASE, fetchFn: f });
  assert.ok(f.asked.includes('index.json'));
  assert.ok(f.asked.includes('a-portrait-3x2/header.xml'), 'a 有頁首，要讀');
  assert.ok(!f.asked.includes('b-landscape-5rows/header.xml'), 'b 沒有頁首，不該去要（會白白 404）');
  assert.ok(f.asked.includes('e-xlsx-3x2/sheet.xml'), 'xlsx 讀的是工作表不是 document.xml');
  assert.ok(!f.asked.includes('e-xlsx-3x2/document.xml'));
});

test('版面相同的只留一份，被蓋掉的名字記在 dupes（不是靜靜消失）', () => {
  const a = defaultSpec();
  const b = defaultSpec();
  b.heading.lines = (b.heading.lines ?? []).map((l) => ({ ...l, text: '換個抬頭字句' })); // 只差文字
  const c = defaultSpec();
  c.grid.perRow = 1; // 版面真的不一樣
  const out = dedupeByLayout([
    { slug: 'x', name: '甲', spec: a },
    { slug: 'y', name: '乙', spec: b },
    { slug: 'z', name: '丙', spec: c },
  ]);
  assert.deepEqual(out.map((t) => t.slug), ['x', 'z']);
  assert.deepEqual(out[0].dupes, ['乙']);
  assert.deepEqual(out[1].dupes, []);
});

test('layoutKey：抬頭字句不算版面，格數算', () => {
  const a = defaultSpec();
  const b = defaultSpec();
  b.name = '另一個名字';
  b.heading.lines = (b.heading.lines ?? []).map((l) => ({ ...l, text: '別的字' }));
  assert.equal(layoutKey(a), layoutKey(b));
  const c = defaultSpec();
  c.grid.blockRows = 2;
  assert.notEqual(layoutKey(a), layoutKey(c));
});

test('一份壞掉不拖垮其他份；index.json 讀不到才整個丟錯', async () => {
  const list = await loadBuiltins({ base: BASE, fetchFn: diskFetch(['a-portrait-3x2/document.xml']) });
  assert.ok(list.length >= 4);
  assert.ok(!list.some((t) => t.slug === 'a-portrait-3x2'), '讀不到的那份要跳過');
  await assert.rejects(() => loadBuiltins({ base: BASE, fetchFn: diskFetch(['index.json']) }), /index\.json/);
  await assert.rejects(() => loadBuiltins({ base: BASE, fetchFn: null }), /fetch/);
});
