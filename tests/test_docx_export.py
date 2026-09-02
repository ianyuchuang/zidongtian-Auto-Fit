# -*- coding: utf-8 -*-
"""web/js/docx-export.js 產出的 Word 檔版面要與 V1.0 一致（用 Node 產檔、Python zipfile 檢查 XML）。"""
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT.parent / "需求及資訊來源" / "來源資料夾範例" / "帷幕骨架" / "4F"


def _tiny_jpeg(path: Path, w=40, h=30):
    """沒有範例照片時用 Pillow 做一張小圖。"""
    PIL = pytest.importorskip("PIL.Image")
    PIL.new("RGB", (w, h), (120, 160, 200)).save(path, "JPEG")


def test_docx_layout_matches_v1(tmp_path):
    node = shutil.which("node")
    assert node, "需要 Node.js"
    photos = sorted(SAMPLES.glob("*.jpg"))[:3] if SAMPLES.is_dir() else []
    if not photos:
        for i in range(3):
            p = tmp_path / f"p{i}.jpg"
            _tiny_jpeg(p)
            photos.append(p)
    out = tmp_path / "out.docx"
    r = subprocess.run(
        [node, "tests/js/helpers/build_docx.mjs", *map(str, photos), str(out)],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
    )
    assert r.returncode == 0, r.stdout + r.stderr
    assert out.stat().st_size > 1000

    z = zipfile.ZipFile(out)
    doc = z.read("word/document.xml").decode("utf-8")
    header = next(n for n in z.namelist() if re.match(r"word/header\d*\.xml", n))
    hdr = z.read(header).decode("utf-8")
    media = [n for n in z.namelist() if n.startswith("word/media/") and not n.endswith("/")]

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
