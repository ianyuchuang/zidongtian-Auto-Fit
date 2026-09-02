# -*- coding: utf-8 -*-
"""push_to_github.py — 測試 → commit → 推上 GitHub

給 2_推至GitHub.bat 呼叫。所有中文訊息都在這裡（.bat 只留 ASCII，
否則 cmd 在 chcp 65001 下讀 UTF-8 批次檔會算錯位置、把註解當指令跑）。

用法：
  python tools\\push_to_github.py                 測試 → commit → push
  python tools\\push_to_github.py -m "說明"        不互動，直接用這個 commit 訊息
  python tools\\push_to_github.py --no-push       只到 commit 為止
  python tools\\push_to_github.py --skip-tests    跳過測試（不建議）
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deps  # noqa: E402

REPO_DIR = Path(__file__).resolve().parent.parent
DEFAULT_MESSAGE = "更新自懂填 Auto-Fit"
BRANCH = "main"

PUSH_HINTS = """
[X] 推送失敗。常見原因：
    - GitHub 上還沒建 repo：到 github.com 建私有 repo「zidongtian-Auto-Fit」（不要勾 README）
    - 帳號驗證：GitHub 不收密碼，要用 Personal Access Token
      （fine-grained token，權限 Contents: Read and write）
    - 清掉舊的認證再試一次：
        cmdkey /delete:git:https://github.com
    - 別台電腦改過，要先 git pull
    - 不在公司網路 / 防火牆擋住
"""


def call(cmd) -> int:
    """跑一個指令，輸出直接顯示在畫面上，回傳 exit code。"""
    return subprocess.call(cmd, cwd=str(REPO_DIR))


def capture(cmd) -> tuple[int, str]:
    """跑一個指令並收回輸出。"""
    p = subprocess.run(cmd, cwd=str(REPO_DIR), capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def ask_message() -> str:
    """問這次的 commit 說明；直接按 Enter 用預設。"""
    if not sys.stdin or not sys.stdin.isatty():
        return DEFAULT_MESSAGE
    msg = input("請輸入這次的修改說明（直接按 Enter 用預設）: ").strip()
    return msg or DEFAULT_MESSAGE


def run_tests() -> bool:
    print("\n[1/3] 測試...")
    deps.ensure(["pytest"], "測試")
    if call([sys.executable, "-m", "pytest", "-q"]) != 0:
        print("\n[X] 測試沒過，先不要推。把上面的訊息貼給 Claude。")
        return False
    return True


def commit_changes(message=None) -> bool:
    """git add -A → 有變更就 commit。沒變更回 True（照樣可以推）。"""
    print("\n[2/3] 檢查變更...")
    if call(["git", "add", "-A"]) != 0:
        print("[X] git add 失敗。")
        return False

    # --quiet: 有差異回 1，沒差異回 0
    if call(["git", "diff", "--cached", "--quiet"]) == 0:
        print("    沒有任何檔案變更，直接嘗試推送。")
        return True

    _code, out = capture(["git", "diff", "--cached", "--name-status"])
    print(out.rstrip())
    msg = message or ask_message()
    if call(["git", "commit", "-m", msg]) != 0:
        print("[X] commit 失敗。")
        return False
    return True


def push() -> bool:
    print("\n[3/3] 推送到 GitHub...")
    if call(["git", "push", "-u", "origin", BRANCH]) != 0:
        print(PUSH_HINTS)
        return False
    return True


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="測試 → commit → 推上 GitHub")
    ap.add_argument("-m", "--message", help="commit 訊息（給了就不互動詢問）")
    ap.add_argument("--no-push", action="store_true", help="只到 commit 為止")
    ap.add_argument("--skip-tests", action="store_true", help="跳過測試（不建議）")
    args = ap.parse_args(argv)

    try:
        if not args.skip_tests and not run_tests():
            return 1
        if not commit_changes(args.message):
            return 1
        if args.no_push:
            print("\n--no-push：不推送。")
            return 0
        if not push():
            return 1
    except RuntimeError as e:
        print(f"\n[X] {e}")
        return 1

    print("\n  推送完成。程式碼已經備份到 GitHub。")
    return 0


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    sys.exit(main())
