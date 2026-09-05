# -*- coding: utf-8 -*-
"""web/js/pdf-export.js：真的用 pdf-lib + 全字庫正楷體產一份 PDF，確認頁數、版面尺寸與字型有嵌進去。
（純函式的幾何計算在 tests/js/pdf-export.test.mjs。）"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "web" / "vendor" / "fonts" / "TW-Kai-98_1.ttf"


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    node = shutil.which("node")
    assert node, "需要 Node.js"
    if not FONT.exists():
        pytest.skip(f"缺備用字型 {FONT.name}（到全字庫下載放進 web/vendor/fonts/）")
    out = tmp_path_factory.mktemp("pdf") / "out.pdf"
    r = subprocess.run(
        [node, "tests/js/helpers/build_pdf.mjs", str(out)],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
    )
    assert r.returncode == 0, "build_pdf.mjs 失敗：\n" + r.stdout + r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1]), out.read_bytes()


def test_pdf_pages_and_no_failures(built):
    info, data = built
    # 3 張（每頁 6 張）+ 1 張 = 兩個資料夾各一頁，接成同一份
    assert info["pages"] == 2, info
    assert info["failures"] == [], info
    assert info["warnings"] == [], info
    assert data.startswith(b"%PDF-"), "產出的不是 PDF"
    assert len(info["sizes"]) == 2, info


def test_pdf_font_is_subset(built):
    info, data = built
    # 完整的 TW-Kai 是 37MB；沒子集化的話 PDF 會跟著肥成那樣
    assert info["bytes"] < 3_000_000, f'PDF {info["bytes"]} bytes，子集化大概沒生效'
    assert len(data) == info["bytes"]


def test_pdf_page_size_is_a4(built):
    info, _ = built
    # A4 直式：595.3 x 841.9 pt（11906 x 16838 twips）
    for w, h in info["sizes"]:
        assert abs(w - 595.3) < 1 and abs(h - 841.9) < 1, f"版面 {w}x{h} 不是 A4"
