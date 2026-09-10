# -*- coding: utf-8 -*-
"""web/js/xlsx-export.js 產出的 Excel 檔（用 Node 產檔、Python zipfile 檢查 XML）：
版面要照 LayoutSpec 走，且 xlsx 版型與 docx 版型都要能產出。
（單位換算與 ZIP 打包的純邏輯在 tests/js/xlsx-units.test.mjs、tests/js/zip.test.mjs。）"""
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures" / "版型"
SAMPLES = ROOT.parent / "需求及資訊來源" / "來源資料夾範例" / "帷幕骨架" / "4F"


def _tiny_jpeg(path: Path, color, w=400, h=300):
    PIL = pytest.importorskip("PIL.Image")
    PIL.new("RGB", (w, h), color).save(path, "JPEG")


def _photos(tmp_path, n):
    photos = sorted(SAMPLES.glob("*.jpg"))[:n] if SAMPLES.is_dir() else []
    if len(photos) < n:
        photos = []
        for i in range(n):
            p = tmp_path / f"p{i}.jpg"
            _tiny_jpeg(p, ((37 * i + 60) % 256, (91 * i + 60) % 256, (151 * i + 60) % 256))
            photos.append(p)
    return photos


def _build(tmp_path, photos, template=None, template_xlsx=None, name="out.xlsx"):
    """跑 build_xlsx.mjs 產一份 xlsx，回傳 (zipfile, sheet1.xml, drawing1.xml, media 清單)。"""
    node = shutil.which("node")
    assert node, "需要 Node.js"
    out = tmp_path / name
    args = [node, "tests/js/helpers/build_xlsx.mjs"]
    if template_xlsx:
        args += ["--template-xlsx", str(FIX / template_xlsx)]
    elif template:
        args += ["--template", str(FIX / template)]
    r = subprocess.run(
        [*args, *map(str, photos), str(out)],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
    )
    assert r.returncode == 0, r.stdout + r.stderr
    z = zipfile.ZipFile(out)
    return (
        z,
        z.read("xl/worksheets/sheet1.xml").decode("utf-8"),
        z.read("xl/drawings/drawing1.xml").decode("utf-8"),
        [n for n in z.namelist() if n.startswith("xl/media/")],
    )


def test_zip_is_readable_and_parts_complete(tmp_path):
    """自己寫的 ZIP 打包要能被標準 zipfile 讀，且 OPC 需要的零件都在。"""
    z, sheet, drawing, media = _build(tmp_path, _photos(tmp_path, 3), template_xlsx="e-xlsx-3x2")
    assert z.testzip() is None, "ZIP 內容毀損"
    for part in ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml",
                 "xl/_rels/workbook.xml.rels", "xl/styles.xml",
                 "xl/worksheets/_rels/sheet1.xml.rels", "xl/drawings/_rels/drawing1.xml.rels"]:
        assert part in z.namelist(), part
    assert len(media) == 3


def test_xlsx_layout_follows_template(tmp_path):
    """e 版型（3 列 × 2 張）：7 張要排成兩頁，每頁最上面各一列抬頭，第 2 頁前有強制分頁。"""
    z, sheet, drawing, media = _build(tmp_path, _photos(tmp_path, 7), template_xlsx="e-xlsx-3x2")
    # 抬頭：每頁都有（不是只有第一頁），且 {date} 換成這次的檢查日期
    assert sheet.count("施工自主檢查照片（檢查日期：115年07月25日）") == 2
    assert "{date}" not in sheet
    # 列：每頁 1 列抬頭 + 3×(照片列 + 說明列)；第 2 頁只剩 1 張 → 1 個區塊列
    assert len(re.findall(r"<row ", sheet)) == 1 + 6 + 1 + 2
    # 欄寬與列高照版型（46.71 字元、192pt）
    assert 'width="46.7143"' in sheet
    assert sheet.count('ht="192"') == 4
    # 抬頭橫跨兩欄
    assert '<mergeCell ref="A1:B1"/>' in sheet
    # 強制分頁：第 2 頁的抬頭之前
    assert '<rowBreaks count="1" manualBreakCount="1">' in sheet
    assert '<brk id="7"' in sheet
    # A4 直式、邊界照版型（567 twips = 0.39375 吋）
    # fitToWidth：欄寬換算的進位差不能把一頁拆成左右兩頁
    assert '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>' in sheet
    assert '<pageSetUpPr fitToPage="1"/>' in sheet
    assert 'left="0.39375"' in sheet
    # 說明欄位真的填進去了
    assert "內容說明：說明1" in sheet and "設    計：設計7" in sheet
    # 7 張照片各自一個錨點、各自一份 media
    assert drawing.count("<xdr:oneCellAnchor>") == 7
    assert len(media) == 7


def test_xlsx_uses_kai_font_and_borders(tmp_path):
    z, sheet, _, _ = _build(tmp_path, _photos(tmp_path, 2), template_xlsx="e-xlsx-3x2")
    styles = z.read("xl/styles.xml").decode("utf-8")
    assert '<name val="標楷體"/>' in styles
    assert '<sz val="8"/>' in styles and '<sz val="14"/>' in styles
    assert 'style="thin"' in styles


def test_normal_style_font_is_calibri_11(tmp_path):
    """回歸（2026-09-10）：0 號字型（「一般」樣式）必須是 Calibri 11。
    Excel 的欄寬單位是「幾個字元」，換成像素時用的就是這個字型的數字寬（MDW＝7px）；
    放成標楷體的話欄會被重算成更寬，兩欄擠不下一頁而被拆成左右兩頁。"""
    z, sheet, _, _ = _build(tmp_path, _photos(tmp_path, 2), template_xlsx="e-xlsx-3x2")
    styles = z.read("xl/styles.xml").decode("utf-8")
    first = re.search(r"<fonts[^>]*>(<font>.*?</font>)", styles).group(1)
    assert '<name val="Calibri"/>' in first and '<sz val="11"/>' in first, first
    # 說明格用的不是 0 號字型
    assert re.search(r'<xf [^>]*fontId="(?!0")', styles), styles


def test_docx_template_also_exports_to_xlsx(tmp_path):
    """docx 解析出來的版型（a：3 列 × 2 張、抬頭在頁首）也要能產 Excel——
    Excel 沒有頁首，抬頭改成每頁最上面各印一列。"""
    z, sheet, drawing, media = _build(tmp_path, _photos(tmp_path, 3), template="a-portrait-3x2")
    assert "範例營造股份有限公司" in sheet
    assert "施工自主檢查照片(檢查日期：115年07月25日)" in sheet
    assert drawing.count("<xdr:oneCellAnchor>") == 3
    assert len(media) == 3
    # a 版型欄寬 4915 dxa → 327.67 px → 46.0952 字元
    assert re.search(r'width="46\.09', sheet), sheet[:400]


def test_landscape_template_exports_landscape(tmp_path):
    """b 版型是 A4 橫式、照片格跨 5 列：方向要跟著、合併儲存格要出現。"""
    z, sheet, drawing, media = _build(tmp_path, _photos(tmp_path, 2), template="b-landscape-5rows")
    assert 'orientation="landscape"' in sheet
    assert "<mergeCells" in sheet
    assert drawing.count("<xdr:oneCellAnchor>") == 2
