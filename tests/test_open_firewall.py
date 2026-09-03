# -*- coding: utf-8 -*-
"""tools/open_firewall.py：規則內容、權限不足時要大聲失敗。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import open_firewall as fw  # noqa: E402


def test_rule_only_opens_private_profile_tcp_8765():
    cmd = " ".join(fw.add_rule_cmd())
    assert "protocol=TCP" in cmd
    assert "localport=8765" in cmd
    assert "profile=private" in cmd, "公用網路不要開"
    assert "dir=in" in cmd and "action=allow" in cmd


def test_rule_name_has_no_space():
    # 名字有空白就得在 .bat / 命令列多包一層引號，容易出錯
    assert " " not in fw.RULE_NAME
    assert f"name={fw.RULE_NAME}" in fw.add_rule_cmd()
    assert f"name={fw.RULE_NAME}" in fw.delete_rule_cmd()


def test_refuses_without_admin(monkeypatch, capsys):
    monkeypatch.setattr(fw.sys, "platform", "win32")
    monkeypatch.setattr(fw, "is_admin", lambda: False)
    assert fw.main([]) == 1
    assert "系統管理員" in capsys.readouterr().out


def test_refuses_off_windows(monkeypatch, capsys):
    monkeypatch.setattr(fw.sys, "platform", "linux")
    assert fw.main([]) == 1
    assert "Windows" in capsys.readouterr().out


def test_add_deletes_first_so_reruns_do_not_stack(monkeypatch):
    monkeypatch.setattr(fw.sys, "platform", "win32")
    monkeypatch.setattr(fw, "is_admin", lambda: True)
    calls = []

    class _R:
        returncode = 0
        stdout = stderr = ""

    monkeypatch.setattr(fw.subprocess, "run", lambda cmd, **kw: calls.append(cmd) or _R())
    assert fw.main([]) == 0
    assert calls[0][:6] == fw.delete_rule_cmd()[:6]
    assert calls[1][:5] == fw.add_rule_cmd()[:5]


def test_remove_only_deletes(monkeypatch):
    monkeypatch.setattr(fw.sys, "platform", "win32")
    monkeypatch.setattr(fw, "is_admin", lambda: True)
    calls = []

    class _R:
        returncode = 0
        stdout = stderr = ""

    monkeypatch.setattr(fw.subprocess, "run", lambda cmd, **kw: calls.append(cmd) or _R())
    assert fw.main(["--remove"]) == 0
    assert calls == [fw.delete_rule_cmd()]
