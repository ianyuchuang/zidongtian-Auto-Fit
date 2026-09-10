# -*- coding: utf-8 -*-
"""tools/bat/*.bat：內容必須全是 ASCII。

理由見 docs/bat.md：cmd.exe 在 chcp 65001 下讀含中文的批次檔會算錯位置，
把註解當指令跑。這個測試是那次修復的回歸測試。
"""
from pathlib import Path

import pytest

BAT_DIR = Path(__file__).resolve().parent.parent / "tools" / "bat"
BAT_FILES = sorted(BAT_DIR.glob("*.bat")) + sorted(BAT_DIR.glob("*.cmd"))


def test_bat_dir_is_not_empty():
    assert len(BAT_FILES) == 6


@pytest.mark.parametrize("path", BAT_FILES, ids=lambda p: p.name)
def test_content_is_pure_ascii(path):
    data = path.read_bytes()
    bad = [(i, b) for i, b in enumerate(data) if b > 0x7F]
    assert not bad, f"{path.name} 有非 ASCII 位元組（位置 {bad[0][0]}）；中文請寫進 Python 或 docs/bat.md"


@pytest.mark.parametrize("path", BAT_FILES, ids=lambda p: p.name)
def test_uses_crlf(path):
    data = path.read_bytes()
    assert b"\n" in data
    assert data.count(b"\r\n") == data.count(b"\n"), f"{path.name} 要用 CRLF 換行"


@pytest.mark.parametrize("path", [p for p in BAT_FILES if p.suffix == ".bat"], ids=lambda p: p.name)
def test_bat_finds_repo_at_runtime_and_calls_python(path):
    text = path.read_text(encoding="ascii")
    assert 'call "%~dp0_repo.cmd"' in text
    assert "cd /d \"%REPO%\"" in text
    assert "python tools\\" in text
    assert "chcp 65001" in text


def test_repo_helper_globs_the_version_folder():
    text = (BAT_DIR / "_repo.cmd").read_text(encoding="ascii")
    assert 'for /d %%D in ("%~dp0*-V2.0")' in text


def test_firewall_bat_reports_when_uac_is_refused():
    """UAC 按「否」時 Start-Process 會失敗，原本直接 exit /b 0 視窗就關掉、沒半句話（2026-09-10）。"""
    text = next(p for p in BAT_FILES if p.name.startswith("0_")).read_text(encoding="ascii")
    i = text.index("-Verb RunAs")
    after = text[i:]
    assert "if errorlevel 1" in after
    assert "pause" in after.split("exit /b 0")[0], "拒絕提權時要 pause 讓人看到訊息"
    assert "exit /b 1" in after.split("exit /b 0")[0]


def test_gitattributes_forces_crlf_for_batch_files():
    """cmd 對 LF 批次檔行為不穩，別讓 git 的 autocrlf 設定把它們變成 LF。"""
    text = (BAT_DIR.parent.parent / ".gitattributes").read_text(encoding="utf-8")
    rules = [ln.split() for ln in text.splitlines() if ln.strip() and not ln.startswith("#")]
    patterns = {r[0]: r[1:] for r in rules}
    for pat in ("tools/bat/*", "*.bat", "*.cmd"):
        assert pat in patterns, f".gitattributes 缺 {pat}"
        assert "text" in patterns[pat] and "eol=crlf" in patterns[pat]
