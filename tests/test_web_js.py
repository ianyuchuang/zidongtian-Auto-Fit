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
