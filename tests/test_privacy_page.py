# -*- coding: utf-8 -*-
"""web/privacy.html：隱私權政策頁要存在、入口頁要連得到、內容要跟程式實際行為一致。"""
import re
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"
HTML = (WEB / "privacy.html").read_text(encoding="utf-8")


def test_entry_links_to_privacy_page():
    entry = (WEB / "js" / "ui" / "entry.js").read_text(encoding="utf-8")
    assert 'href="privacy.html"' in entry


def test_uses_relative_paths_only():
    """放在 Pages 子路徑下，站內連結不能以 / 開頭。"""
    local = [m for m in re.findall(r'(?:src|href)="([^"]+)"', HTML) if not m.startswith("http")]
    assert local and not [m for m in local if m.startswith("/")]


def test_mentions_every_place_data_is_stored():
    """程式碼裡用到的儲存位置，政策頁都要提到。"""
    for word in ("localStorage", "sessionStorage", "IndexedDB", "File System Access", "127.0.0.1"):
        assert word in HTML, word


def test_lists_all_wired_api_providers():
    """接上的 LLM API 每一家都要有隱私權政策連結；Grok 尚未接，不列。"""
    for name in ("anthropic.com/privacy", "policies.google.com/privacy", "openai.com/policies/privacy-policy"):
        assert name in HTML, name
    assert "x.ai" not in HTML


def test_no_tracking_scripts():
    """頁面宣稱沒有分析與廣告，所以自己也不能載外部腳本。"""
    assert "<script" not in HTML
    assert "issues" in HTML  # 聯絡方式：GitHub Issues
