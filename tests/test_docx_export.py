# -*- coding: utf-8 -*-
"""web/js/docx-export.js 產出的 Word 檔版面（用 Node 產檔、Python zipfile 檢查 XML）：
預設版型要與 V1.0 一致，換成別的 LayoutSpec 要真的換掉版面。"""
import json
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT.parent / "需求及資訊來源" / "來源資料夾範例" / "帷幕骨架" / "4F"


def _tiny_jpeg(path: Path, color, w=40, h=30):
    """沒有範例照片時用 Pillow 做一張小圖。每張顏色不同——三張一模一樣的話
    docx 會把它們去重成一張 media，媒體張數就會誤判失敗。"""
    PIL = pytest.importorskip("PIL.Image")
    PIL.new("RGB", (w, h), color).save(path, "JPEG")


def _build(tmp_path, photos, spec=None, template=None, name="out.docx"):
    """跑 build_docx.mjs 產一份 docx，回傳 (zipfile, document.xml, media 清單)。"""
    node = shutil.which("node")
    assert node, "需要 Node.js"
    out = tmp_path / name
    args = [node, "tests/js/helpers/build_docx.mjs"]
    if spec is not None:
        sp = tmp_path / "spec.json"
        sp.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
        args += ["--spec", str(sp)]
    elif template is not None:
        args += ["--template", str(ROOT / "tests" / "fixtures" / "版型" / template)]
    r = subprocess.run(
        [*args, *map(str, photos), str(out)],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
    )
    assert r.returncode == 0, r.stdout + r.stderr
    assert out.stat().st_size > 1000
    z = zipfile.ZipFile(out)
    return z, z.read("word/document.xml").decode("utf-8"), [
        n for n in z.namelist() if n.startswith("word/media/") and not n.endswith("/")
    ]


def _photos(tmp_path):
    photos = sorted(SAMPLES.glob("*.jpg"))[:3] if SAMPLES.is_dir() else []
    if not photos:
        for i, color in enumerate([(200, 60, 60), (60, 200, 60), (60, 60, 200)]):
            p = tmp_path / f"p{i}.jpg"
            _tiny_jpeg(p, color)
            photos.append(p)
    return photos


def test_docx_layout_matches_v1(tmp_path):
    photos = _photos(tmp_path)
    z, doc, media = _build(tmp_path, photos)
    header = next(n for n in z.namelist() if re.match(r"word/header\d*\.xml", n))
    hdr = z.read(header).decode("utf-8")

    # A4 與邊界（twips）
    assert 'w:w="11906"' in doc and 'w:h="16838"' in doc
    assert 'w:top="709"' in doc and 'w:left="1134"' in doc and 'w:right="851"' in doc
    # 頁首
    assert "永青營造工程股份有限公司" in hdr
    assert "施工自主檢查照片(檢查日期：115年07月25日)" in hdr
    # 表格：3 張 → 2 列照片 + 2 列說明 = 4 個 w:tr；欄寬 4915；照片列高 3798
    assert doc.count("<w:tr>") + doc.count("<w:tr ") == 4
    assert 'w:w="4915"' in doc
    assert 'w:val="3798"' in doc
    # 說明文字與字型
    assert "內容說明：說明1" in doc and "設    計：設計3" in doc and "實    際：實際2" in doc
    assert 'w:eastAsia="標楷體"' in doc
    assert 'w:val="16"' in doc  # 8pt
    # 三張照片都嵌進去
    assert len(media) == 3


# D棟3樓 那類版型：橫式、抬頭在內文、照片格跨 5 列、說明分成多列、日期戳關掉。
LANDSCAPE_SPEC = {
    "id": "t2",
    "name": "橫式測試",
    "font": "標楷體",
    "page": {"w": 16840, "h": 11907, "orient": "landscape",
             "margin": {"t": 567, "r": 737, "b": 567, "l": 851}},
    "heading": {"place": "body", "lines": [
        {"text": "範例工程", "sizePt": 18, "align": "center"},
        {"text": "施工查驗照片({date})", "sizePt": 16, "align": "center"},
    ]},
    "grid": {"perRow": 2, "blockRows": 2, "order": "col", "seq": None, "tableIndent": 0},
    "photo": {"h": 296, "maxW": 395},
    "caption": {"sizePt": 10},
    "stamp": {"on": False, "corner": "bl"},
    "block": {"cols": [5984, 1105, 576], "rows": [
        {"h": 428, "cells": [
            {"kind": "photo", "rowSpan": 5, "vAlign": "center"},
            {"kind": "text", "lines": [{"label": "照片編號", "field": "none"}]},
            {"kind": "text", "lines": [{"label": "", "field": "seq"}]},
        ]},
        {"h": 434, "cells": [{"kind": "text", "col": 1, "colSpan": 2,
                              "lines": [{"label": "拍照日期", "field": "none"}]}]},
        {"h": 525, "cells": [{"kind": "text", "col": 1, "colSpan": 2,
                              "lines": [{"label": "", "field": "photoDate"}]}]},
        {"h": 434, "cells": [{"kind": "text", "col": 1, "colSpan": 2,
                              "lines": [{"label": "圖片說明", "field": "none"}]}]},
        {"h": 2629, "cells": [{"kind": "text", "col": 1, "colSpan": 2,
                               "lines": [{"label": "", "field": "desc"}]}]},
    ]},
    "unknown": [],
}


def test_docx_follows_custom_spec(tmp_path):
    z, doc, media = _build(tmp_path, _photos(tmp_path), spec=LANDSCAPE_SPEC, name="t2.docx")

    # 頁面換成橫式 A4
    assert 'w:w="16840"' in doc and 'w:h="11907"' in doc
    assert 'w:orient="landscape"' in doc
    # 抬頭在內文，不在頁首
    assert "範例工程" in doc
    assert "施工查驗照片(115年07月25日)" in doc
    assert not [n for n in z.namelist() if re.match(r"word/header\d*\.xml", n)]
    # 3 張、每列 2 張、每張 5 列 → 2 個區塊列 × 5 = 10 個 w:tr
    assert doc.count("<w:tr>") + doc.count("<w:tr ") == 10
    # 照片格跨列合併
    assert "<w:vMerge" in doc
    # 欄寬照 block.cols × perRow
    for w in ("5984", "1105", "576"):
        assert f'w:w="{w}"' in doc
    # 每一格都垂直置中（照手改的正確版；樣本裡文字格本來是靠上）
    # （跨列合併讓出來的續格 vMerge continue 是空的，不算）
    real_cells = doc.count("<w:tc>") - doc.count('<w:vMerge w:val="continue"/>')
    assert real_cells == doc.count('<w:vAlign w:val="center"/>') > 0
    # 說明欄位換成「照片編號／拍照日期／圖片說明」，V1.0 的三欄不該出現
    assert "照片編號" in doc and "圖片說明" in doc
    # 「拍照日期」不讀 EXIF，一律填該資料夾的檢查日期（點分隔、月日不補 0）
    assert doc.count("115.7.25") == 3
    assert "內容說明：" not in doc
    # 由上而下填：1、2 在左欄的上下兩格，3 在右欄第一格 → 文件順序是 1、3、2
    assert doc.index("說明1") < doc.index("說明3") < doc.index("說明2")
    assert len(media) == 3


def test_docx_from_parsed_template(tmp_path):
    """換版型的完整路徑：解析 b 版型的 XML → 直接拿解析結果產 Word。"""
    z, doc, media = _build(tmp_path, _photos(tmp_path), template="b-landscape-5rows", name="parsed.docx")

    assert 'w:orient="landscape"' in doc and 'w:w="16840"' in doc
    assert "範例工程" in doc and "施工查驗照片" in doc      # 抬頭在內文
    assert not [n for n in z.namelist() if re.match(r"word/header\d*\.xml", n)]
    assert doc.count("<w:tr>") + doc.count("<w:tr ") == 10  # 3 張 → 2 個區塊列 × 5 列
    assert "<w:vMerge" in doc                                # 照片格跨 5 列
    assert "照片編號" in doc and "拍照日期" in doc and "圖片說明" in doc
    assert "內容說明：" not in doc                            # 換版型後就不該有 V1.0 的欄位名
    assert len(media) == 3


def test_docx_from_parsed_template_a_matches_v1_layout(tmp_path):
    """a 版型就是 V1.0 的版面：解析出來的結果要和預設版型產出同樣的骨架。"""
    z, doc, media = _build(tmp_path, _photos(tmp_path), template="a-portrait-3x2", name="parsed_a.docx")
    hdr = z.read(next(n for n in z.namelist() if re.match(r"word/header\d*\.xml", n))).decode("utf-8")

    assert 'w:w="11906"' in doc and 'w:h="16838"' in doc
    assert 'w:w="4915"' in doc and 'w:val="3798"' in doc
    assert doc.count("<w:tr>") + doc.count("<w:tr ") == 4
    assert "內容說明：說明1" in doc and "設    計：設計3" in doc
    assert "範例營造股份有限公司" in hdr
    assert "施工自主檢查照片(檢查日期：115年07月25日)" in hdr
    assert len(media) == 3


def test_docx_from_parsed_template_c_label_cell(tmp_path):
    """c 版型：欄位名是獨立的一格，值在右邊那格。"""
    z, doc, media = _build(tmp_path, _photos(tmp_path), template="c-portrait-label-cell", name="parsed_c.docx")

    assert 'w:w="11906"' in doc and 'w:orient="portrait"' in doc   # 直式
    assert 'w:w="988"' in doc and 'w:w="4392"' in doc              # 欄寬照版型
    assert doc.count("<w:tr>") + doc.count("<w:tr ") == 4          # 3 張 → 2 個區塊列 × 2 列
    assert "說明：" in doc and "說明1" in doc                       # 欄位名照印、值填進右邊那格
    assert "內容說明：" not in doc
    assert len(media) == 3
# 抬頭在內文的版型：每頁 1 張，用來驗「每一頁都要有抬頭」。
BODY_HEADING_SPEC = {
    "id": "t3",
    "name": "每頁抬頭測試",
    "font": "標楷體",
    "page": {"w": 11906, "h": 16838, "orient": "portrait",
             "margin": {"t": 454, "r": 567, "b": 454, "l": 567}},
    "heading": {"place": "body", "lines": [
        {"text": "範例營造/範例機電", "sizePt": 16, "bold": True, "align": "center"},
        {"text": "自主檢查照片(檢查日期:{date})", "sizePt": 16, "align": "center"},
    ]},
    "grid": {"perRow": 1, "blockRows": 1, "order": "row", "seq": None, "tableIndent": 0},
    "photo": {"h": 258, "maxW": 344},
    "caption": {"sizePt": 12},
    "stamp": {"on": False, "corner": "bl"},
    "block": {"cols": [988, 4392], "rows": [
        {"h": 3969, "cells": [{"kind": "photo", "colSpan": 2, "vAlign": "center"}]},
        {"h": 567, "cells": [
            {"kind": "text", "lines": [{"label": "說明：", "field": "none"}]},
            {"kind": "text", "lines": [{"label": "", "field": "desc"}]},
        ]},
    ]},
    "unknown": [],
}


def test_body_heading_repeats_on_every_page(tmp_path):
    """回歸（2026-09-04）：抬頭在內文時，原本只印在第一頁，第二頁起是空的。
    現在改成一頁一張表、每張表前各印一次抬頭，第 2 頁起強制分頁。"""
    z, doc, media = _build(tmp_path, _photos(tmp_path), spec=BODY_HEADING_SPEC, name="body_heading.docx")

    assert not [n for n in z.namelist() if re.match(r"word/header\d*\.xml", n)]  # 不放頁首
    assert doc.count("範例營造/範例機電") == 3                    # 3 張、每頁 1 張 → 3 頁都有抬頭
    assert doc.count("自主檢查照片(檢查日期:115年07月25日)") == 3
    assert doc.count("<w:tbl>") == 3                              # 一頁一張表
    assert doc.count("<w:pageBreakBefore") == 2                   # 第 2、3 頁各強制分頁
    assert len(media) == 3


def test_header_heading_stays_one_table(tmp_path):
    """抬頭在頁首時維持整份一張表（Word 自己每頁重印），不要被上面的改動拆開。"""
    z, doc, media = _build(tmp_path, _photos(tmp_path))
    assert doc.count("<w:tbl>") == 1
    assert "<w:pageBreakBefore" not in doc
def test_multi_field_line_joins_with_typed_text(tmp_path):
    """同一行放多個欄位、中間用打的字隔開（有些自檢表是逗號分隔）：
    要串成同一個段落，值是空的也照原樣印，分隔的逗號不會自己消失。"""
    import copy

    spec = copy.deepcopy(BODY_HEADING_SPEC)
    spec["block"]["rows"][1]["cells"][1]["lines"] = [
        {"parts": [{"field": "desc"}, {"text": "，"}, {"field": "design"}, {"text": "，"}, {"field": "actual"}]}
    ]
    z, doc, media = _build(tmp_path, _photos(tmp_path), spec=spec, name="multifield.docx")

    assert "說明1，設計1，實際1" in doc          # 一行三個欄位串成同一段落
    assert "說明3，設計3，實際3" in doc
    assert doc.count("說明：") == 3            # 左邊的欄位名照舊每張一次
    assert "，，" not in doc                    # 三個值都有，不該出現空值連著的逗號
def test_line_break_inside_paragraph(tmp_path):
    """段落內換行（版型調整頁按 Shift+Enter）要變成 Word 的 <w:br/>，不是另起一段。"""
    import copy

    spec = copy.deepcopy(BODY_HEADING_SPEC)
    spec["block"]["rows"][1]["cells"][1]["lines"] = [
        {"parts": [{"field": "desc"}, {"br": True}, {"field": "design"}]}
    ]
    z, doc, media = _build(tmp_path, _photos(tmp_path), spec=spec, name="linebreak.docx")

    assert doc.count("<w:br/>") == 3           # 3 張各一個換行
    assert "說明1" in doc and "設計1" in doc
    assert doc.count("<w:tbl>") == 3           # 還是 3 頁 3 張表，沒被拆成多一段

    # 瀏覽器把 Shift+Enter 存成文字裡的 \n（white-space: pre-wrap 的行為），也要一樣
    spec["block"]["rows"][1]["cells"][1]["lines"] = [{"parts": [{"field": "desc"}, {"text": "\n備註"}]}]
    z, doc, media = _build(tmp_path, _photos(tmp_path), spec=spec, name="linebreak2.docx")
    assert doc.count("<w:br/>") == 3 and "備註" in doc
