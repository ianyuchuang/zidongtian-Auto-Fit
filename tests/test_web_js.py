# -*- coding: utf-8 -*-
"""網頁前端純邏輯的測試在 tests/js/*.test.mjs（node --test）；這裡包一層讓 pytest 一起跑。"""
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_node_tests_pass():
    node = shutil.which("node")
    assert node, "需要 Node.js 才能跑前端測試（tests/js）"
    r = subprocess.run([node, "--test", "tests/js/*.test.mjs"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, "node --test 失敗：\n" + r.stdout + r.stderr


def test_table_text_columns_share_width():
    """表格「設計」「實際」欄要按比例分寬（2026-09-04 定案：內容說明不再吃掉全部剩餘寬度），不能退回固定 118px。"""
    css = (ROOT / "web" / "css" / "app.css").read_text(encoding="utf-8")
    import re
    m = re.search(r"th\.c-design, th\.c-actual \{ width: ([^;]+); \}", css)
    assert m, "找不到 th.c-design / th.c-actual 的寬度規則"
    assert "%" in m.group(1), f"設計／實際欄應用比例分寬，目前是 {m.group(1)}"


def test_viewer_nav_sits_above_actions():
    """換頁箭頭在底部輸出列的上一行（2026-09-05 定案），不在標題列右上角。"""
    js = (ROOT / "web" / "js" / "ui" / "viewer.js").read_text(encoding="utf-8")
    assert 'class="navbar"' in js, "找不到 .navbar 換頁列"
    assert js.index('class="navbar"') < js.index('class="actions"'), "換頁列要排在輸出列前面"
    head = js[js.index('class="head"'):js.index('class="big"')]
    assert "data-nav" not in head, "標題列不該再有換頁箭頭"
