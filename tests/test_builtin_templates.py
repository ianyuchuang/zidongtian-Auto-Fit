# -*- coding: utf-8 -*-
"""內建版型（`web/templates/`）：版型頁最頂端那一區，隨 web/ 一起發布到 GitHub Pages。

index.json 是網頁端唯一的清單（`web/js/template/builtin.js` 照它讀），
所以這裡擋住「資料夾與 index.json 對不起來」——少一份會靜靜不見，多一份會 404。
解析結果對不對由 `tests/js/template-parse*.test.mjs` 驗（吃的是同一批檔）。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TPL = ROOT / "web" / "templates"


def index():
    return json.loads((TPL / "index.json").read_text(encoding="utf-8"))["templates"]


def test_index_lists_every_folder():
    dirs = {p.name for p in TPL.iterdir() if p.is_dir()}
    assert dirs, "web/templates/ 底下沒有版型"
    assert {t["slug"] for t in index()} == dirs, "index.json 與資料夾對不起來"


def test_每一筆的檔案都在且沒漏列():
    for t in index():
        d = TPL / t["slug"]
        on_disk = sorted(p.name for p in d.iterdir() if p.suffix == ".xml")
        assert t["files"] == on_disk, f"{t['slug']} 的 files 與實際檔案不符"
        assert t["kind"] in ("docx", "xlsx")
        main = "sheet.xml" if t["kind"] == "xlsx" else "document.xml"
        assert main in on_disk, f"{t['slug']} 少了 {main}"
        assert t["name"].strip(), f"{t['slug']} 沒有顯示名稱"


def test_顯示名稱不重複():
    names = [t["name"] for t in index()]
    assert len(set(names)) == len(names), f"內建版型的名稱重複了：{names}"


def test_匿名過的內容才進得了網站():
    """這些檔會隨網站公開：只留匿名後的「範例…」，不能有實際案名／公司名的痕跡。"""
    import re

    bad = re.compile(r"(?<!範例)(營造|機電)(工程)?(股份)?有限公司")
    for p in TPL.rglob("*.xml"):
        text = p.read_text(encoding="utf-8")
        assert not bad.search(text), f"{p.relative_to(ROOT)} 裡還有沒匿名的公司名"
