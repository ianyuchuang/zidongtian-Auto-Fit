# -*- coding: utf-8 -*-
"""
本機測試用網頁伺服器：把 web/ 掛在 http://localhost:<port>/，
另外可把一個「範例照片資料夾」掛在 /samples/（唯讀，給入口頁的「載入範例」用）。

用法:
    python tools/dev_server.py                     # 只掛 web/（只有本機連得到）
    python tools/dev_server.py --samples 路徑 --open   # 掛範例並自動開瀏覽器
    python tools/dev_server.py --lan               # 綁 0.0.0.0，讓辦公室內網同事連得到
"""
import argparse
import json
import os
import socket
import sys
import threading
import urllib.parse
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"

# 預設的範例照片資料夾（在 repo 上一層的「需求及資訊來源」裡）。
# 放在這裡而不是寫在 .bat 裡：.bat 只能放 ASCII，中文路徑會讓 cmd 解析錯亂。
DEFAULT_SAMPLES = ROOT.parent / "需求及資訊來源" / "來源資料夾範例" / "帷幕骨架"

# 範例清單要略過的檔案（與 web/js/filename.js 的規則一致，這裡只做粗略過濾）
IGNORE_NAMES = {"thumbs.db", "desktop.ini"}


def list_samples(samples_dir: Path):
    """回傳 {'root': 資料夾名, 'dirs': ['4F', ...], 'files': [{'path': ..., 'url': ...}]}（自然順序交給前端）。

    dirs 連空資料夾也列出來，否則唯讀複本會看不到沒有照片的樓層。
    """
    files = []
    dirs = []
    for p in sorted(samples_dir.rglob("*")):
        relpath = p.relative_to(samples_dir)
        # 路徑任一段以「.」開頭（.git、.回收桶…）整串跳過：rglob 不會因為跳過資料夾就不列其內檔案
        if any(part.startswith(".") for part in relpath.parts):
            continue
        rel = relpath.as_posix()
        if p.is_dir():
            dirs.append(rel)
            continue
        if not p.is_file():
            continue
        if p.name.startswith("~$") or p.name.lower() in IGNORE_NAMES:
            continue
        files.append({"path": rel, "url": "/samples/" + urllib.parse.quote(rel)})
    return {"root": samples_dir.name, "dirs": dirs, "files": files}


def resolve_sample_path(samples_dir: Path, url_path: str):
    """把 /samples/<rel> 轉成實際檔案路徑；跑出 samples_dir 之外回 None。"""
    rel = urllib.parse.unquote(url_path[len("/samples/"):])
    target = (samples_dir / rel).resolve()
    try:
        target.relative_to(samples_dir.resolve())
    except ValueError:
        return None
    return target


def lan_ip():
    """猜這台電腦在內網的 IP。用 UDP socket「連」外部位址，不會真的送封包；拿不到回 None。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def banner_lines(host, port, ip=None):
    """啟動訊息。綁在內網時多印同事要用的網址與 Chrome 設定，因為 http 內網位址
    拿不到安全內容環境（secure context），不設就只能唯讀。"""
    lines = [f"  本機網址：http://localhost:{port}/"]
    if host == "127.0.0.1":
        lines.append("  只有這台電腦連得到（要讓同事連，加 --lan）")
        return lines
    if ip:
        base = f"http://{ip}:{port}"
        lines.append(f"  內網網址：{base}/   <- 把這個給同事")
        lines.append("")
        lines.append("  同事的 Chrome 要先做一次設定，否則只能唯讀（不能搬移、刪除、寫回資料夾）：")
        lines.append("    1. 網址列輸入 chrome://flags/#unsafely-treat-insecure-origin-as-secure")
        lines.append(f"    2. 空格填 {base}")
        lines.append("    3. 右邊選 Enabled -> 按右下角 Relaunch 重開 Chrome")
    else:
        lines.append(f"  已綁 {host}，但抓不到內網 IP，請用 ipconfig 自己看")
    lines.append("")
    lines.append("  防火牆第一次會跳詢問：勾「私人網路」-> 允許存取。")
    lines.append("  這個視窗關掉，同事就連不到了。")
    return lines


class Server(ThreadingHTTPServer):
    """Windows 的 SO_REUSEADDR 語意不同：允許綁到別人已在 LISTEN 的 port，port 被佔時不會報錯，
    第二個伺服器會靜靜搶不到連線。所以 Windows 上關掉；其他平台保留（重啟時不必等 TIME_WAIT）。"""

    allow_reuse_address = sys.platform != "win32"


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
            # 狀態行只能是 latin-1，中文放 explain（進 body）；放在 message 會 UnicodeEncodeError
            return self.send_error(404, "no samples", "沒有掛範例資料夾")
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
    ap.add_argument("--host", help="綁定位址；預設 127.0.0.1（只有本機連得到）")
    ap.add_argument("--lan", action="store_true", help="綁 0.0.0.0，讓同一區網的同事連得到")
    ap.add_argument("--samples", help="範例照片資料夾（掛在 /samples/）；不給就用預設的")
    ap.add_argument("--open", action="store_true", help="啟動後自動開瀏覽器")
    args = ap.parse_args(argv)

    if not WEB_DIR.is_dir():
        print(f"[X] 找不到 web/ 資料夾：{WEB_DIR}")
        return 1
    sd = Path(args.samples).resolve() if args.samples else DEFAULT_SAMPLES.resolve()
    if sd.is_dir():
        Handler.samples_dir = sd
        print(f"  範例資料夾：{sd}")
    elif args.samples:
        print(f"  （找不到範例資料夾，略過：{sd}）")
    else:
        print(f"  （沒有預設範例資料夾，「載入範例」不會有東西：{sd}）")

    host = args.host or ("0.0.0.0" if args.lan else "127.0.0.1")
    url = f"http://localhost:{args.port}/"
    try:
        httpd = Server((host, args.port), Handler)
    except OSError as e:
        print(f"[X] 無法開啟 {host}:{args.port}：{e}（可能已經有一個在跑，直接開 {url} 試試）")
        return 1
    for line in banner_lines(host, args.port, lan_ip() if host != "127.0.0.1" else None):
        print(line)
    print("  （按 Ctrl+C 停止）")
    if args.open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  已停止。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
