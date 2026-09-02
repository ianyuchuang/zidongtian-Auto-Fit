# -*- coding: utf-8 -*-
"""缺套件時的共用處理：講清楚缺什麼，互動時問一次要不要現在裝。

給 tools/ 底下的腳本用（backup_to_drive.py、push_to_github.py）。
"""
from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parent.parent
REQUIREMENTS = REPO_DIR / "tools" / "requirements-tools.txt"

INSTALL_HINT = "pip install -r tools\\requirements-tools.txt"


def missing(modules) -> list[str]:
    """回傳 modules 裡找不到的 import 名稱（保持原順序）。"""
    out = []
    for m in modules:
        try:
            found = importlib.util.find_spec(m) is not None
        except (ImportError, ValueError, ModuleNotFoundError):
            found = False
        if not found:
            out.append(m)
    return out


def pip_install(requirements: Path = REQUIREMENTS, runner=subprocess.call) -> int:
    """跑 python -m pip install -r <requirements>，回傳 exit code。"""
    return runner([sys.executable, "-m", "pip", "install", "-r", str(requirements)])


def _default_ask(question: str) -> bool:
    if not sys.stdin or not sys.stdin.isatty():
        return False
    return input(f"{question} (Y/n) ").strip().lower() not in {"n", "no"}


def ensure(modules, what: str, requirements: Path = REQUIREMENTS,
           ask=_default_ask, install=pip_install) -> None:
    """確認 modules 都裝好；缺的話問一次要不要裝，裝完再確認一次。

    不裝、或裝完仍然缺 → 丟 RuntimeError（大聲失敗，不要靜靜跳過）。
    """
    lack = missing(modules)
    if not lack:
        return

    names = "、".join(lack)
    print(f"[!] {what}需要的套件還沒裝：{names}")
    if not ask("要現在自動安裝嗎？"):
        raise RuntimeError(f"缺少套件 {names}，請先執行: {INSTALL_HINT}")

    print(f"    安裝中：{requirements} ...")
    code = install(requirements)
    lack = missing(modules)
    if code != 0 or lack:
        still = "、".join(lack) or names
        raise RuntimeError(
            f"套件安裝沒成功（缺 {still}）。請自己開一個命令視窗執行：\n  {INSTALL_HINT}"
        )
    print("    安裝完成。")
