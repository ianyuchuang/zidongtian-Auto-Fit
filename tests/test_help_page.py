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


def test_batch_edit_scope_matches_topbar():
    """批次修改設計值的範圍是「目前篩選出的 N 列／目前選取的資料夾／全部」，不是勾選的照片。"""
    topbar = (WEB / "js" / "ui" / "topbar.js").read_text(encoding="utf-8")
    for opt in ("目前篩選出的", "目前選取的資料夾", "全部"):
        assert opt in topbar and opt in HTML, opt
    assert "把選到的照片" not in HTML


def test_drop_faq_not_stale():
    """main.js 已在 window 擋掉預設拖放，「變成一片空白」不再是常態，FAQ 只能寫「若還發生」。"""
    main = (WEB / "js" / "main.js").read_text(encoding="utf-8")
    assert "'dragover', 'drop'" in main
    assert "若還發生" in HTML
    assert "那是拖到了頁面上沒有接住的地方" not in HTML


def test_lightbox_double_click_matches_code():
    """燈箱：100% 時雙擊放大到 250%、放大後雙擊還原（lightbox.js dblclick 用 zoom(2.5)）。"""
    lb = (WEB / "js" / "ui" / "lightbox.js").read_text(encoding="utf-8")
    assert "zoom(2.5" in lb
    assert "雙擊放大到 250%" in HTML
    assert "放大後雙擊還原" in HTML


def test_export_button_label_mentioned_in_workbench_section():
    """第 3 節提到 xlsx 版型時按鈕顯示「產生 Excel 檔」並指向第 7 節，不重複長段。"""
    wb = HTML.split('id="workbench"')[1].split('id="recognize"')[0]
    assert "產生 Excel 檔" in wb and "第 7 節" in wb
