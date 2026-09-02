# -*- coding: utf-8 -*-
"""tools/deps.py：缺套件的偵測、詢問、安裝、以及裝不起來要大聲失敗。"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import deps  # noqa: E402


def test_missing_reports_only_absent_modules():
    assert deps.missing(["json", "pathlib"]) == []
    assert deps.missing(["json", "沒有這個模組_xyz"]) == ["沒有這個模組_xyz"]


def test_ensure_passes_when_all_present():
    deps.ensure(["json"], "測試", ask=lambda q: pytest.fail("不該問"))


def test_ensure_raises_when_user_declines():
    with pytest.raises(RuntimeError) as e:
        deps.ensure(["缺的模組_xyz"], "測試", ask=lambda q: False,
                    install=lambda req: pytest.fail("不該安裝"))
    assert "缺的模組_xyz" in str(e.value)


def test_ensure_installs_then_succeeds(monkeypatch):
    calls = []
    seq = iter([["缺的模組_xyz"], []])  # 安裝前缺、安裝後有
    monkeypatch.setattr(deps, "missing", lambda mods: next(seq))
    deps.ensure(["缺的模組_xyz"], "測試", ask=lambda q: True,
                install=lambda req: calls.append(req) or 0)
    assert len(calls) == 1


def test_ensure_raises_when_install_did_not_help(monkeypatch):
    monkeypatch.setattr(deps, "missing", lambda mods: ["缺的模組_xyz"])
    with pytest.raises(RuntimeError):
        deps.ensure(["缺的模組_xyz"], "測試", ask=lambda q: True, install=lambda req: 0)


def test_pip_install_uses_current_interpreter():
    seen = {}
    deps.pip_install(Path("req.txt"), runner=lambda cmd: seen.setdefault("cmd", cmd) and 0)
    assert seen["cmd"][:4] == [sys.executable, "-m", "pip", "install"]
    assert seen["cmd"][-1] == "req.txt"
