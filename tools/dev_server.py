# -*- coding: utf-8 -*-
"""
本機測試用網頁伺服器：把 web/ 掛在 http://localhost:<port>/，
另外可把一個「範例照片資料夾」掛在 /samples/（唯讀，給入口頁的「載入範例」用）。

用法:
    python tools/dev_server.py                     # 只掛 web/
    python tools/dev_server.py --samples 路徑 --open   # 掛範例並自動開瀏覽器
"""
import argparse
import json
import os
import sys
import threading
import urllib.parse
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"

# 範例清單要略過的檔案（與 web/js/filename.js 的規則一致，這裡只做粗略過濾）
IGNORE_NAMES = {"thumbs.db", "desktop.ini"}


def list_samples(samples_dir: Path):
    """回傳 {'root': 資料夾名, 'files': [{'path': '4F/x.jpg', 'url': '/samples/4F/x.jpg'}]}（自然順序交給前端）。"""
    files = []
    for p in sorted(samples_dir.rglob("*")):
        if not p.is_file():
            continue
        if p.name.startswith("~$") or p.name.startswith(".") or p.name.lower() in IGNORE_NAMES:
            continue
        rel = p.relative_to(samples_dir).as_posix()
        files.append({"path": rel, "url": "/samples/" + urllib.parse.quote(rel)})
    return {"root": samples_dir.name, "files": files}


def resolve_sample_path(samples_dir: Path, url_path: str):
    """把 /samples/<rel> 轉成實際檔案路徑；跑出 samples_dir 之外回 None。"""
    rel = urllib.parse.unquote(url_path[len("/samples/"):])
    target = (samples_dir / rel).resolve()
    try:
        target.relative_to(samples_dir.resolve())
    except ValueError:
        return None
    return target


class Handler(SimpleHTTPRequestHandler):
    samples_dir = None  # 由 main() 設定

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(WEB_DIR), **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def guess_type(self, path):
        if str(path).endswith((".js", ".mjs")):
            return "text/javascript; charset=utf-8"
        return super().guess_type(path)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/samples/"):
            return self._serve_sample(path)
        return super().do_GET()

    def _serve_sample(self, path):
        if self.samples_dir is None:
            return self.send_error(404, "沒有掛範例資料夾")
        if path == "/samples/index.json":
            body = json.dumps(list_samples(self.samples_dir), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return None
        target = resolve_sample_path(self.samples_dir, path)
        if target is None or not target.is_file():
            return self.send_error(404)
        with open(target, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(str(target)))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
        return None

    def log_message(self, fmt, *args):
        sys.stdout.write("  %s\n" % (fmt % args))
        sys.stdout.flush()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--samples", help="範例照片資料夾（掛在 /samples/）")
    ap.add_argument("--open", action="store_true", help="啟動後自動開瀏覽器")
    args = ap.parse_args(argv)

    if not WEB_DIR.is_dir():
        print(f"[X] 找不到 web/ 資料夾：{WEB_DIR}")
        return 1
    if args.samples:
        sd = Path(args.samples).resolve()
        if sd.is_dir():
            Handler.samples_dir = sd
            print(f"  範例資料夾：{sd}")
        else:
            print(f"  （找不到範例資料夾，略過：{sd}）")

    url = f"http://localhost:{args.port}/"
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as e:
        print(f"[X] 無法開啟 port {args.port}：{e}（可能已經有一個在跑，直接開 {url} 試試）")
        return 1
    print(f"  網頁：{url}   （按 Ctrl+C 停止）")
    if args.open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  已停止。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
