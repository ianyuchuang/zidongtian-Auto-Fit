# -*- coding: utf-8 -*-
"""web/help.html：使用說明頁要存在、入口頁連得到、每張截圖都在、路徑相對。"""
import re
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"
HTML = (WEB / "help.html").read_text(encoding="utf-8")


def test_entry_links_to_help_page():
    entry = (WEB / "js" / "ui" / "entry.js").read_text(encoding="utf-8")
    assert 'href="help.html"' in entry


def test_every_screenshot_exists():
    imgs = re.findall(r'<img src="([^"]+)"', HTML)
    assert len(imgs) >= 8
    missing = [i for i in imgs if not (WEB / i).is_file()]
    assert not missing, missing


def test_uses_relative_paths_only():
    local = [m for m in re.findall(r'(?:src|href)="([^"]+)"', HTML) if not m.startswith(("http", "#"))]
    assert local and not [m for m in local if m.startswith("/")]


def test_sections_cover_the_main_flow():
    for anchor in ("entry", "template", "workbench", "recognize", "review", "organize", "export", "faq"):
        assert f'id="{anchor}"' in HTML, anchor


def test_no_scripts_and_links_privacy():
    assert "<script" not in HTML
    assert 'href="privacy.html"' in HTML
