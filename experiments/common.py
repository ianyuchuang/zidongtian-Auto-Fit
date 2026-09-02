# -*- coding: utf-8 -*-
"""
辨識實驗共用純邏輯（無模型相依）：找照片、檔名→正解、欄位抽取、正規化、CER 評分。
各模型的 run.py 只負責「跑模型拿到文字」，其餘都用這裡，方便換模型比較。
"""
import html as _html
import json
import re
import unicodedata
from pathlib import Path

IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tif", ".tiff", ".webp"}
FIELDS = ("desc", "design", "actual")
FIELD_LABELS = {"desc": "內容說明", "design": "設計", "actual": "實際"}

# 白板上的欄位名 → 三欄（docs/需求摘要.md §4）。順序＝優先序。
KEYWORDS = {
    "desc": ["檢驗項目", "檢查項目", "查驗項目", "內容說明", "項目"],
    "design": ["標準值", "設計值", "設計"],
    "actual": ["實際值", "實測值", "實際"],
}


def is_photo_name(name: str) -> bool:
    if not name or name.startswith("~$") or name.startswith("."):
        return False
    if name.lower() == "thumbs.db":
        return False
    return Path(name).suffix.lower() in IMG_EXTS


def list_photos(folder: Path):
    return sorted(p for p in Path(folder).iterdir() if p.is_file() and is_photo_name(p.name))


def parse_photo_name(name: str):
    """「內容說明-設計-實際.jpg」→ dict；不符格式回 None（與 web/js/filename.js 相同規則）。"""
    base = Path(name).stem
    parts = base.rsplit("-", 2)
    if len(parts) != 3:
        return None
    return {"desc": parts[0].strip(), "design": parts[1].strip(), "actual": parts[2].strip()}


def load_ground_truth(photos, gt_file=None, folder_name=""):
    """每張照片的正解：檔名可解析者用檔名；否則查 gt_file（{檔名: {desc,design,actual}}）；都沒有 → None。"""
    extra = {}
    if gt_file and Path(gt_file).exists():
        extra = json.loads(Path(gt_file).read_text(encoding="utf-8"))
    out = {}
    for p in photos:
        gt = parse_photo_name(p.name) or extra.get(p.name)
        out[p.name] = gt
    return out


# ---------- 正規化與評分 ----------

def normalize(s: str) -> str:
    """比對用：全形→半形、去空白、統一 ± 與 mm 大小寫、去掉尾端標點。"""
    if s is None:
        return ""
    s = unicodedata.normalize("NFKC", str(s))
    s = re.sub(r"\s+", "", s)
    s = s.replace("+-", "±").replace("+/-", "±").replace("±", "±")
    s = s.replace("MM", "mm").replace("Mm", "mm")
    s = s.strip("：:。.、,，;；|")
    return s


def cer(ref: str, hyp: str) -> float:
    """字元錯誤率 = 編輯距離 / 正解長度（正解空字串時：hyp 也空→0，否則 1）。"""
    ref, hyp = normalize(ref), normalize(hyp)
    if not ref:
        return 0.0 if not hyp else 1.0
    prev = list(range(len(hyp) + 1))
    for i, rc in enumerate(ref, 1):
        cur = [i]
        for j, hc in enumerate(hyp, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (rc != hc)))
        prev = cur
    return prev[-1] / len(ref)


def strip_floor_prefix(desc: str, folder_name: str) -> str:
    """檔名的內容說明常帶樓層（4F…），白板上可能沒寫；去掉資料夾名前綴再比一次。"""
    d = normalize(desc)
    f = normalize(folder_name)
    return d[len(f):] if f and d.startswith(f) else d


def score(gt: dict, pred: dict, folder_name: str = "", raw: str = None) -> dict:
    """回傳每欄 {exact, cer, found}；found＝正解字串有沒有出現在模型原始輸出裡（純辨識品質，不管欄位對應）。
    desc 另給 exact_nofloor（去樓層前綴後是否相同）。"""
    res = {}
    raw_n = normalize(html_to_text(raw)) if raw else None
    for f in FIELDS:
        g, p = gt.get(f, ""), (pred or {}).get(f, "") or ""
        res[f] = {"exact": normalize(g) == normalize(p), "cer": round(cer(g, p), 3)}
        if raw_n is not None:
            gn = normalize(g)
            if f == "desc":
                gn = strip_floor_prefix(g, folder_name)
            res[f]["found"] = bool(gn) and gn in raw_n
    g2 = strip_floor_prefix(gt.get("desc", ""), folder_name)
    p2 = strip_floor_prefix((pred or {}).get("desc", "") or "", folder_name)
    res["desc"]["exact_nofloor"] = g2 == p2
    return res


# ---------- 從 OCR 文字抽三欄 ----------

def html_to_text(raw: str) -> str:
    """PaddleOCR-VL 常回 HTML 表格：<td>→以 | 分隔、<tr>→換行、<br>/<n>→換行、去標籤、$ \\pm $→±。純文字原樣回傳。"""
    if not raw or ("<" not in raw and "&lt;" not in raw):
        return raw or ""
    t = _html.unescape(raw)
    t = re.sub(r"\$\s*\\pm\s*\$|\\pm", "±", t)
    t = re.sub(r"<n>|<br\s*/?>", "\n", t, flags=re.I)
    t = re.sub(r"</t[dh]>", " | ", t, flags=re.I)
    t = re.sub(r"</tr>|</p>|</div>", "\n", t, flags=re.I)
    t = re.sub(r"<[^>]+>", "", t)
    lines = []
    for ln in t.splitlines():
        ln = re.sub(r"[ \t]+", " ", ln).strip().strip("|").strip()
        ln = re.sub(r"\s*±\s*", "±", ln)
        ln = re.sub(r"\s*\|\s*", " | ", ln)
        ln = re.sub(r"(\s*\|\s*)+$", "", ln)  # 去尾端空儲存格
        if ln:
            lines.append("| " + ln + " |" if "|" in ln else ln)
    return "\n".join(lines)


_CELL_SPLIT = re.compile(r"\s*\|\s*")


def _clean_value(v: str) -> str:
    v = re.sub(r"<[^>]+>", "", v)  # 去 html 標籤（markdown 表格有時夾 <br>）
    v = v.strip().strip("：:|").strip()
    return v


_ALL_KEYWORDS = [kw for kws in KEYWORDS.values() for kw in kws]


def _is_keyword_cell(c: str) -> bool:
    """表頭列（| 標準值 | 實際值 |）的儲存格不是值。"""
    c2 = _clean_value(c)
    return any(c2.startswith(kw) for kw in _ALL_KEYWORDS)


def extract_fields(text: str) -> dict:
    """
    從 OCR 輸出（純文字或 markdown 表格）抽「檢驗項目／標準值／實際值」。
    支援：'標準值：700mm±10'、'標準值 700mm±10'、markdown 列 '| 標準值 | 700mm±10 |'、
    以及「關鍵字一行、值在下一行」。找不到的欄位回空字串。
    """
    lines = [ln.strip() for ln in html_to_text(text or "").splitlines()]
    lines = [ln for ln in lines if ln and not re.fullmatch(r"[\|\-\s:]+", ln)]  # 去表格分隔列
    found = {f: "" for f in FIELDS}
    for idx, ln in enumerate(lines):
        cells = [c for c in _CELL_SPLIT.split(ln.strip("|")) if c] if "|" in ln else None
        for f in FIELDS:
            if found[f]:
                continue
            for kw in KEYWORDS[f]:
                if cells:
                    matched = False
                    for ci, c in enumerate(cells):
                        c2 = re.sub(r"<[^>]+>", "", c).strip()
                        if c2.startswith(kw):
                            matched = True
                            rest = _clean_value(c2[len(kw):])
                            if not rest and ci + 1 < len(cells) and not _is_keyword_cell(cells[ci + 1]):
                                rest = _clean_value(cells[ci + 1])
                            if rest:
                                found[f] = rest
                            break
                    if matched:  # 長關鍵字已命中（即使值是空的）就不再用短關鍵字重試，避免「實際值」被切成「值」
                        break
                else:
                    m = re.match(r"^\W*" + re.escape(kw) + r"\W*(.*)$", ln)
                    if m:
                        rest = _clean_value(m.group(1))
                        if not rest and idx + 1 < len(lines):
                            rest = _clean_value(lines[idx + 1])
                        if rest:
                            found[f] = rest
                        break
    return found


def summarize(rows: list) -> dict:
    """rows: [{name, gt, pred, score, seconds}] → 各欄完全正確率、平均 CER、平均秒數。"""
    n = len([r for r in rows if r.get("gt")])
    out = {"n": n}
    for f in FIELDS:
        sc = [r["score"][f] for r in rows if r.get("gt")]
        out[f] = {
            "exact_rate": round(sum(1 for s in sc if s["exact"]) / n, 3) if n else None,
            "mean_cer": round(sum(s["cer"] for s in sc) / n, 3) if n else None,
        }
        if n and all("found" in s for s in sc):
            out[f]["found_rate"] = round(sum(1 for s in sc if s["found"]) / n, 3)
    nf = [r["score"]["desc"]["exact_nofloor"] for r in rows if r.get("gt")]
    out["desc"]["exact_rate_nofloor"] = round(sum(nf) / n, 3) if n else None
    secs = [r["seconds"] for r in rows if r.get("seconds") is not None]
    out["mean_seconds"] = round(sum(secs) / len(secs), 1) if secs else None
    return out


def print_report(model: str, rows: list, summary: dict):
    print(f"\n=== {model} ===")
    for r in rows:
        print(f"\n[{r['name']}]  {r.get('seconds', '?')}s")
        for f in FIELDS:
            g = (r.get("gt") or {}).get(f, "")
            p = (r.get("pred") or {}).get(f, "")
            s = r["score"][f] if r.get("score") else {}
            mark = "✔" if s.get("exact") else ("~" if f == "desc" and s.get("exact_nofloor") else "✘")
            found = "" if "found" not in s else ("  原文有" if s["found"] else "  原文沒有")
            print(f"  {mark} {FIELD_LABELS[f]}: 正解「{g}」 辨識「{p}」 CER={s.get('cer')}{found}")
    print("\n--- 彙總 ---")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
