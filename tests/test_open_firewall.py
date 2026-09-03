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


def test_any_profile_opens_all_profiles():
    assert "profile=any" in " ".join(fw.add_rule_cmd(profile="any"))


# 2026-09-03 實測：這台同時有 Tailscale(Private) 和乙太網路(Public)
REAL = [("100.64.0.1", "Private"), ("192.168.1.95", "Public")]


def test_public_only_network_is_not_enough():
    # 辦公室網路被歸成「公用網路」時，profile=private 的規則對不上，同事會連不到
    assert fw.private_profile_is_enough([("192.168.1.95", "Public")], "192.168.1.95") is False
    assert fw.private_profile_is_enough([("192.168.1.95", "Private")], "192.168.1.95") is True
    assert fw.private_profile_is_enough([("192.168.1.95", "DomainAuthenticated")], "192.168.1.95") is True
    assert fw.private_profile_is_enough([], "192.168.1.95") is True, "偵測不到就別亂猜"


def test_virtual_adapter_does_not_mask_a_public_lan():
    # 回歸測試：舊版只問「有沒有任何一張是 Private」，Tailscale 那張就把判斷騙過去，
    # 於是不會問使用者，規則加了也沒用。要看的是同事實際要連的那個 IP。
    assert fw.private_profile_is_enough(REAL, "192.168.1.95") is False
    assert fw.private_profile_is_enough(REAL, "100.64.0.1") is True
    assert fw.category_for_ip(REAL, "192.168.1.95") == "Public"
    assert fw.category_for_ip(REAL, "10.0.0.1") is None


def test_public_network_prompts_and_switches_to_any(monkeypatch):
    monkeypatch.setattr(fw.sys, "platform", "win32")
    monkeypatch.setattr(fw, "is_admin", lambda: True)
    monkeypatch.setattr(fw, "network_profiles", lambda: REAL)
    monkeypatch.setattr(fw, "lan_ip", lambda: "192.168.1.95")
    monkeypatch.setattr("builtins.input", lambda *a: "y")
    calls = []

    class _R:
        returncode = 0
        stdout = stderr = ""

    monkeypatch.setattr(fw.subprocess, "run", lambda cmd, **kw: calls.append(cmd) or _R())
    assert fw.main([]) == 0
    assert "profile=any" in " ".join(calls[1])


def test_public_network_answered_no_keeps_private(monkeypatch):
    monkeypatch.setattr(fw.sys, "platform", "win32")
    monkeypatch.setattr(fw, "is_admin", lambda: True)
    monkeypatch.setattr(fw, "network_profiles", lambda: REAL)
    monkeypatch.setattr(fw, "lan_ip", lambda: "192.168.1.95")
    monkeypatch.setattr("builtins.input", lambda *a: "")
    calls = []

    class _R:
        returncode = 0
        stdout = stderr = ""

    monkeypatch.setattr(fw.subprocess, "run", lambda cmd, **kw: calls.append(cmd) or _R())
    assert fw.main([]) == 0
    assert "profile=private" in " ".join(calls[1])


def test_add_deletes_first_so_reruns_do_not_stack(monkeypatch):
    monkeypatch.setattr(fw.sys, "platform", "win32")
    monkeypatch.setattr(fw, "is_admin", lambda: True)
    monkeypatch.setattr(fw, "network_profiles", lambda: [("192.168.1.95", "Private")])
    monkeypatch.setattr(fw, "lan_ip", lambda: "192.168.1.95")
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
