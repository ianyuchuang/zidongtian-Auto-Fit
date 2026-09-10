# -*- coding: utf-8 -*-
"""把 需求及資訊來源/版型/*.docx（與 *.xlsx）抽成測試用的 XML fixture。

只取版面需要的 word/document.xml 與預設頁首，去掉 rsid 這類雜訊，
並把工程案名、公司名、說明內容一律換成「範例…」——fixture 會進 git，
實際案名不進去。

docx 取 word/document.xml 與預設頁首；xlsx 取工作表、sharedStrings、styles 與繪圖層。

用法：python tools/make_template_fixtures.py [版型資料夾]
"""
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT.parent / "需求及資訊來源" / "版型"
OUT = ROOT / "tests" / "fixtures" / "版型"

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

NS = {
    "wpc": "http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas",
    "cx": "http://schemas.microsoft.com/office/drawing/2014/chartex",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "o": "urn:schemas-microsoft-com:office:office",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
    "v": "urn:schemas-microsoft-com:vml",
    "wp14": "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "w10": "urn:schemas-microsoft-com:office:word",
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "w14": "http://schemas.microsoft.com/office/word/2010/wordml",
    "w15": "http://schemas.microsoft.com/office/word/2012/wordml",
    "wpg": "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup",
    "wps": "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
    "a14": "http://schemas.microsoft.com/office/drawing/2010/main",
}

# xlsx 檔名 → fixture 目錄名
XLSX_NAMES = {
    "6F.xlsx": "e-xlsx-3x2",
}

# 檔名 → fixture 目錄名（英數，好在測試裡引用）
NAMES = {
    "1150614 輕隔間尺寸11F.docx": "a-portrait-3x2",
    "D棟3樓.docx": "b-landscape-5rows",
    "電氣設備 材料進場自檢(照片).docx": "c-portrait-label-cell",
    "1150614 輕隔間尺寸11F(2x2).docx": "d-portrait-2x2",
}

# 段落文字的匿名規則（照順序，第一條命中就停）；只換值，不動欄位名。
SUBS = [
    (r"^.*(市|縣).*工程$", "範例工程"),
    (r"^.*營造.*有限公司/.*$", "範例營造股份有限公司/範例機電股份有限公司"),
    (r"^.*營造.*有限公司$", "範例營造股份有限公司"),
    (r"^(內容說明：).*$", r"\1範例說明"),
    (r"^(設\s*計：).*$", r"\1範例設計"),
    (r"^(實\s*際：).*$", r"\1範例實際"),
    (r"^D棟.*$", "範例圖片說明"),
    (r"^EMT.*$", "範例說明"),
]

# 表格「值」的收尾規則：不是欄位名、不是日期的一律換掉，免得實際案子的內容漏進 fixture。
# 只套用在表格裡的段落——抬頭（工程名、標題）由上面的 SUBS 處理，才不會把標題也吃掉。
CATCH_ALL = (
    r"^(?!範例)(?!.*[：:]$)(?![\d\s.\-/年月日]+$)"
    r"(?!照片編號$)(?!拍照日期$)(?!圖片說明$)(?!內容說明$)(?!說明$).+$",
    "範例說明",
)

DROP_ATTRS = re.compile(
    r'\s(?:w:rsid[A-Za-z]*|w14:paraId|w14:textId|wp14:anchorId|wp14:editId)="[^"]*"'
)


def anonymize(p, catch_all=False):
    """段落套匿名規則；有換過就把文字集中到第一個 run，其餘清空（保留 run 結構）。"""
    ts = list(p.iter(W + "t"))
    if not ts:
        return
    text = "".join(t.text or "" for t in ts)
    for pat, rep in [*SUBS, *([CATCH_ALL] if catch_all else [])]:
        new = re.sub(pat, rep, text)
        if new != text:
            ts[0].text = new
            ts[0].set(XML_SPACE, "preserve")
            for t in ts[1:]:
                t.text = ""
            return


def write_xml(el, path: Path):
    xml = DROP_ATTRS.sub("", ET.tostring(el, encoding="unicode"))
    path.write_text('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xml, encoding="utf-8")


def extract(src: Path, dst: Path):
    z = zipfile.ZipFile(src)
    dst.mkdir(parents=True, exist_ok=True)

    doc = ET.fromstring(z.read("word/document.xml"))
    in_table = {id(p) for t in doc.iter(W + "tbl") for p in t.iter(W + "p")}
    for p in doc.iter(W + "p"):
        anonymize(p, catch_all=id(p) in in_table)
    write_xml(doc, dst / "document.xml")

    rels = ET.fromstring(z.read("word/_rels/document.xml.rels"))
    target = {r.get("Id"): r.get("Target") for r in rels}
    ref = None
    for sect in doc.iter(W + "sectPr"):
        for h in sect.findall(W + "headerReference"):
            if h.get(W + "type") == "default":
                ref = target.get(h.get(R + "id"))
    if ref:
        hdr = ET.fromstring(z.read("word/" + ref))
        for p in hdr.iter(W + "p"):
            anonymize(p)
        write_xml(hdr, dst / "header.xml")


# ---------- xlsx ----------

SS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def anonymize_text(text: str) -> str:
    """sharedStrings 的一個字串：逐行套 SUBS，都沒中的非日期行換成「範例說明」。"""
    out = []
    for line in text.split("\n"):
        new = line
        for pat, rep in SUBS:
            hit = re.sub(pat, rep, line)
            if hit != line:
                new = hit
                break
        else:
            if line.strip() and not re.search(r"\d", line) and not line.strip().startswith("範例"):
                new = "範例說明"
        out.append(new)
    return "\n".join(out)


def extract_xlsx(src: Path, dst: Path):
    z = zipfile.ZipFile(src)
    dst.mkdir(parents=True, exist_ok=True)
    names = set(z.namelist())

    sheet = next(n for n in sorted(names) if re.fullmatch(r"xl/worksheets/sheet\d*\.xml", n))
    dst.joinpath("sheet.xml").write_bytes(z.read(sheet))
    for part, out in [("xl/styles.xml", "styles.xml")]:
        if part in names:
            dst.joinpath(out).write_bytes(z.read(part))
    drawing = next((n for n in sorted(names) if re.fullmatch(r"xl/drawings/drawing\d*\.xml", n)), None)
    if drawing:
        dst.joinpath("drawing.xml").write_bytes(z.read(drawing))

    if "xl/sharedStrings.xml" in names:
        sst = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in sst.iter(SS + "si"):
            ts = []  # si 底下的 t，但不含注音（rPh）裡的
            for child in si:
                if child.tag == SS + "t":
                    ts.append(child)
                elif child.tag == SS + "r":
                    ts += [t for t in child if t.tag == SS + "t"]
            if not ts:
                continue
            text = "".join(t.text or "" for t in ts)
            new = anonymize_text(text.replace("\r\n", "\n"))
            ts[0].text = new
            ts[0].set(XML_SPACE, "preserve")
            for t in ts[1:]:
                t.text = ""
        write_xml(sst, dst / "sharedStrings.xml")


def main(argv):
    src_dir = Path(argv[1]) if len(argv) > 1 else SRC
    if not src_dir.is_dir():
        print(f"找不到 {src_dir}", file=sys.stderr)
        return 1
    for prefix, uri in NS.items():
        ET.register_namespace(prefix, uri)
    for name, slug in NAMES.items():
        src = src_dir / name
        if not src.is_file():
            print(f"跳過（沒有這份）：{name}", file=sys.stderr)
            continue
        extract(src, OUT / slug)
        print(f"OK {slug}")
    for prefix, uri in [("", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")]:
        ET.register_namespace(prefix, uri)
    for name, slug in XLSX_NAMES.items():
        src = src_dir / name
        if not src.is_file():
            print(f"跳過（沒有這份）：{name}", file=sys.stderr)
            continue
        extract_xlsx(src, OUT / slug)
        print(f"OK {slug}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
