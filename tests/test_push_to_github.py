# -*- coding: utf-8 -*-
"""tools/push_to_github.py：測試沒過不推、有/沒有變更的 commit 流程、失敗要回非 0。"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import push_to_github as g  # noqa: E402


class FakeGit:
    """記錄跑過哪些指令；codes 指定某些指令的回傳碼（用開頭幾個字比對）。"""

    def __init__(self, codes=None, dirty=True):
        self.cmds = []
        self.codes = codes or {}
        self.dirty = dirty

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


def test_no_changes_still_pushes(git):
    git.dirty = False
    assert g.main([]) == 0
    assert not git.ran(["git", "commit"])
    assert git.ran(["git", "push"])


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
    # 測試需要的套件都要寫進 requirements，否則裝了也補不齊（PIL 的套件名是 pillow）
    req = (Path(__file__).resolve().parent.parent / "tools" / "requirements-tools.txt")
    text = req.read_text(encoding="utf-8").lower()
    assert {"pytest", "PIL"} <= set(g.TEST_MODULES)
    for pkg in ("pytest", "pillow"):
        assert pkg in text


def test_run_tests_checks_every_test_dependency_first(git, monkeypatch):
    seen = []
    monkeypatch.setattr(g.deps, "ensure", lambda mods, what: seen.append(list(mods)))
    assert g.main(["--no-push"]) == 0
    assert seen == [g.TEST_MODULES]
