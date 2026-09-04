// 極簡 XML 讀取器：只做 OOXML 用得到的部分（元素、屬性、文字）。
// 不用瀏覽器的 DOMParser，是為了讓 Node 測試與瀏覽器跑同一份程式碼。
// 節點：{ name, attrs, children }，children 的元素是節點或字串。

const ATTR_RE = /([^\s=/]+)\s*=\s*"([^"]*)"/g;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(parseInt(e[1] === 'x' || e[1] === 'X' ? e.slice(2) : e.slice(1), e[1] === 'x' || e[1] === 'X' ? 16 : 10));
    return ENTITIES[e] ?? m;
  });
}

/** 解析成節點樹；回傳的根節點是 '#root'，真正的文件根在 children[0]。 */
export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) stack[stack.length - 1].children.push(decode(xml.slice(i, lt)));
    const c = xml[lt + 1];
    if (c === '?' || c === '!') {
      const end = xml.startsWith('<!--', lt) ? xml.indexOf('-->', lt) + 3 : xml.indexOf('>', lt) + 1;
      if (end <= 0) break;
      i = end;
      continue;
    }
    const gt = xml.indexOf('>', lt);
    if (gt < 0) break;
    const raw = xml.slice(lt + 1, gt);
    if (c === '/') {
      const name = raw.slice(1).trim();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
    } else {
      const selfClose = raw.endsWith('/');
      const body = selfClose ? raw.slice(0, -1) : raw;
      const sp = body.search(/\s/);
      const name = (sp < 0 ? body : body.slice(0, sp)).trim();
      const attrs = {};
      if (sp >= 0) {
        ATTR_RE.lastIndex = 0;
        let m;
        while ((m = ATTR_RE.exec(body.slice(sp)))) attrs[m[1]] = decode(m[2]);
      }
      const node = { name, attrs, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!selfClose) stack.push(node);
    }
    i = gt + 1;
  }
  return root;
}

const isNode = (x) => x && typeof x === 'object';

/** 直接子節點（可指定名稱）。 */
export function kids(node, name) {
  return (node?.children ?? []).filter((c) => isNode(c) && (!name || c.name === name));
}

/** 第一個同名子孫（深度優先）。 */
export function find(node, name) {
  for (const c of node?.children ?? []) {
    if (!isNode(c)) continue;
    if (c.name === name) return c;
    const hit = find(c, name);
    if (hit) return hit;
  }
  return null;
}

/** 所有同名子孫（深度優先）。 */
export function findAll(node, name, out = []) {
  for (const c of node?.children ?? []) {
    if (!isNode(c)) continue;
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

export function attr(node, name) {
  return node?.attrs?.[name];
}

export function num(node, name) {
  const v = Number(attr(node, name));
  return Number.isFinite(v) ? v : null;
}

/** 節點底下所有文字接起來（w:t 的內容）。 */
export function text(node) {
  let out = '';
  for (const c of node?.children ?? []) out += isNode(c) ? text(c) : c;
  return out;
}
