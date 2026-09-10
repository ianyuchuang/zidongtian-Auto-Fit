# -*- coding: utf-8 -*-
"""tools/push_to_github.py：測試沒過不推、有/沒有變更的 commit 流程、失敗要回非 0。"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import push_to_github as g  # noqa: E402


class FakeGit:
    """記錄跑過哪些指令；codes 指定某些指令的回傳碼（用開頭幾個字比對）。"""

    def __init__(self, codes=None, dirty=True, ahead="2"):
        self.cmds = []
        self.codes = codes or {}
        self.dirty = dirty
        self.ahead = ahead  # 還沒推上去的 commit 數；None = 問不到（遠端還沒建）

    def call(self, cmd):
        self.cmds.append(cmd)
        for key, code in self.codes.items():
            if key in " ".join(str(c) for c in cmd):
                return code
        if cmd[:4] == ["git", "diff", "--cached", "--quiet"]:
            return 1 if self.dirty else 0  # 1 = 有變更
        return 0

    def capture(self, cmd):
        self.cmds.append(cmd)
        if cmd[:3] == ["git", "rev-list", "--count"]:
            return (1, "fatal: bad revision\n") if self.ahead is None else (0, self.ahead + "\n")
        return 0, "M\tweb/js/app.js\n"

    def ran(self, prefix):
        return any(c[:len(prefix)] == prefix for c in self.cmds)


@pytest.fixture
def git(monkeypatch):
    fake = FakeGit()
    monkeypatch.setattr(g, "call", fake.call)
    monkeypatch.setattr(g, "capture", fake.capture)
    monkeypatch.setattr(g, "ask_message", lambda: "來自測試的說明")
    return fake


def test_failed_tests_stop_the_push(git, monkeypatch):
    git.codes["pytest"] = 1
    assert g.main([]) == 1
    assert not git.ran(["git", "push"])
    assert not git.ran(["git", "commit"])


def test_full_flow_commits_then_pushes(git):
    assert g.main([]) == 0
    assert ["git", "commit", "-m", "來自測試的說明"] in git.cmds
    assert git.ran(["git", "push"])


def test_message_argument_skips_the_prompt(git, monkeypatch):
    monkeypatch.setattr(g, "ask_message", lambda: pytest.fail("有 -m 就不該問"))
    assert g.main(["-m", "指定訊息"]) == 0
    assert ["git", "commit", "-m", "指定訊息"] in git.cmds


def test_no_changes_still_pushes(git, capsys):
    git.dirty = False
    assert g.main([]) == 0
    assert not git.ran(["git", "commit"])
    assert git.ran(["git", "push"])
    # 訊息要講清楚是「沒有未 commit 的檔案」，不是「什麼都沒改」
    out = capsys.readouterr().out
    assert "工作區乾淨" in out
    assert "2 個 commit 還沒推上去" in out


def test_push_reports_nothing_to_push(git, capsys):
    git.ahead = "0"
    assert g.main([]) == 0
    assert "已經是最新的" in capsys.readouterr().out


def test_push_survives_unknown_remote_state(git, capsys):
    git.ahead = None  # 遠端還沒建 / 沒 fetch 過，問不到數量也要照樣推
    assert g.main([]) == 0
    assert git.ran(["git", "push"])
    assert "commit 還沒推上去" not in capsys.readouterr().out


def test_push_failure_returns_error(git):
    git.codes["push"] = 1
    assert g.main([]) == 1


def test_no_push_option_stops_after_commit(git):
    assert g.main(["--no-push"]) == 0
    assert git.ran(["git", "commit"])
    assert not git.ran(["git", "push"])


def test_missing_pytest_is_reported_not_crashed(git, monkeypatch):
    monkeypatch.setattr(g.deps, "ensure",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("缺少套件 pytest")))
    assert g.main([]) == 1
    assert not git.ran(["git", "push"])


def test_test_modules_are_covered_by_requirements():
    # 測試需要的套件都要寫進 requirements，否則裝了也補不齊（PIL 的套件名是 pillow、yaml 是 pyyaml）
    # 2026-09-10：test_pages_workflow.py 用 PyYAML，兩邊都沒列 → 新電腦推送時 pytest 收集就失敗
    req = (Path(__file__).resolve().parent.parent / "tools" / "requirements-tools.txt")
    text = req.read_text(encoding="utf-8").lower()
    assert {"pytest", "PIL", "yaml"} <= set(g.TEST_MODULES)
    for pkg in ("pytest", "pillow", "pyyaml"):
        assert pkg in text


def test_test_modules_cover_every_third_party_import_in_tests():
    """tests/*.py 頂層 import 的第三方模組都要在 TEST_MODULES 裡，少一個就會在新電腦上紅掉。"""
    import ast
    import sys as _sys
    stdlib = set(_sys.stdlib_module_names)
    local = {"tests", "conftest"}
    need = set()
    for path in sorted(Path(__file__).resolve().parent.glob("test_*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in tree.body:
            if isinstance(node, ast.Import):
                names = [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names = [node.module.split(".")[0]]
            else:
                continue
            for n in names:
                if n not in stdlib and n not in local:
                    need.add(n)
    # tools/ 裡的模組是 sys.path.insert 進來的、repo 根目錄的套件（experiments）是本地的，都不算第三方
    repo = Path(__file__).resolve().parent.parent
    need -= {p.stem for p in (repo / "tools").glob("*.py")}
    need -= {p.name for p in repo.iterdir() if p.is_dir()}
    assert need <= set(g.TEST_MODULES), f"TEST_MODULES 漏了：{sorted(need - set(g.TEST_MODULES))}"


def test_run_tests_checks_every_test_dependency_first(git, monkeypatch):
    seen = []
    monkeypatch.setattr(g.deps, "ensure", lambda mods, what: seen.append(list(mods)))
    assert g.main(["--no-push"]) == 0
    assert seen == [g.TEST_MODULES]
