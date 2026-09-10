# -*- coding: utf-8 -*-
"""`.github/workflows/pages.yml`：發布 web/ 到 GitHub Pages 的設定。

網站是純前端、沒有建置步驟，所以 workflow 只該做「上傳 web/ → 部署」；
這裡擋住之後不小心改壞的幾個關鍵點（路徑、觸發分支、權限）。說明見 docs/部署.md。
"""
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
WF = ROOT / ".github" / "workflows" / "pages.yml"


def load():
    return yaml.safe_load(WF.read_text(encoding="utf-8"))


def test_workflow_exists_and_parses():
    assert WF.is_file()
    assert isinstance(load(), dict)


def test_triggers_on_push_to_main():
    wf = load()
    on = wf.get("on", wf.get(True))  # PyYAML 會把 `on` 讀成布林 True
    assert on["push"]["branches"] == ["main"]
    assert "workflow_dispatch" in on


def test_permissions_for_pages_deploy():
    perms = load()["permissions"]
    assert perms == {"contents": "read", "pages": "write", "id-token": "write"}


def test_concurrency_does_not_cancel_running_deploy():
    """cancel-in-progress=true 會把進行中的 Pages 部署砍掉，留下半套；只能排隊、不能取消。"""
    c = load()["concurrency"]
    assert c["group"] == "pages"
    assert c["cancel-in-progress"] is False


def test_uploads_web_dir_and_deploys():
    steps = load()["jobs"]["deploy"]["steps"]
    uses = [s.get("uses", "") for s in steps]
    assert any(u.startswith("actions/upload-pages-artifact@") for u in uses)
    assert any(u.startswith("actions/deploy-pages@") for u in uses)
    upload = next(s for s in steps if s.get("uses", "").startswith("actions/upload-pages-artifact@"))
    assert upload["with"]["path"] == "web"
    assert (ROOT / "web" / "index.html").is_file()


def test_index_uses_relative_paths():
    """Pages 網址在 /zidongtian-Auto-Fit/ 子路徑下，index.html 的 src/href 不能以 / 開頭。"""
    import re

    html = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    bad = [m for m in re.findall(r'(?:src|href)="([^"]+)"', html) if m.startswith("/")]
    assert not bad, f"這些路徑以 / 開頭，放到 Pages 子路徑會 404：{bad}"
