# -*- coding: utf-8 -*-
"""tools/dev_server.py：範例清單與路徑安全。"""
import io
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import dev_server as ds  # noqa: E402


def _samples(tmp_path):
    root = tmp_path / "帷幕骨架"
    (root / "4F").mkdir(parents=True)
    (root / "5F").mkdir()
    (root / "4F" / "a-1-2.jpg").write_bytes(b"x")
    (root / "4F" / "~$tmp.docx").write_bytes(b"x")
    (root / "5F" / "203662_0.jpg").write_bytes(b"x")
    (root / "5F" / "Thumbs.db").write_bytes(b"x")
    (root / "6F").mkdir()  # 空資料夾：唯讀複本也要看得到
    return root


def test_list_samples_skips_junk_and_uses_posix_paths(tmp_path):
    root = _samples(tmp_path)
    idx = ds.list_samples(root)
    assert idx["root"] == "帷幕骨架"
    assert [f["path"] for f in idx["files"]] == ["4F/a-1-2.jpg", "5F/203662_0.jpg"]
    assert idx["files"][0]["url"].startswith("/samples/4F/")
    assert idx["dirs"] == ["4F", "5F", "6F"], "空資料夾也要列出來，否則唯讀複本看不到沒照片的樓層"


def test_list_samples_skips_everything_under_dot_folders(tmp_path):
    """rglob 會把 .git、.回收桶 等資料夾「裡面」的檔案也列出來，只跳過資料夾本身不夠（2026-09-10）。"""
    root = _samples(tmp_path)
    (root / ".git" / "objects").mkdir(parents=True)
    (root / ".git" / "HEAD").write_bytes(b"x")
    (root / ".git" / "objects" / "ab.jpg").write_bytes(b"x")
    (root / "4F" / ".hidden").mkdir()
    (root / "4F" / ".hidden" / "z.jpg").write_bytes(b"x")
    (root / "4F" / ".DS_Store").write_bytes(b"x")
    idx = ds.list_samples(root)
    assert [f["path"] for f in idx["files"]] == ["4F/a-1-2.jpg", "5F/203662_0.jpg"]
    assert idx["dirs"] == ["4F", "5F", "6F"]


def test_resolve_sample_path_blocks_traversal(tmp_path):
    root = _samples(tmp_path)
    ok = ds.resolve_sample_path(root, "/samples/4F/a-1-2.jpg")
    assert ok == (root / "4F" / "a-1-2.jpg").resolve()
    assert ds.resolve_sample_path(root, "/samples/../secret.txt") is None
    assert ds.resolve_sample_path(root, "/samples/4F/%2e%2e/%2e%2e/x") is None


def test_default_samples_points_at_source_folder():
    # 預設值搬到 Python（.bat 不能放中文路徑），指向 repo 上一層的範例資料夾
    assert ds.DEFAULT_SAMPLES.name == "帷幕骨架"
    assert ds.DEFAULT_SAMPLES.parent.parent.name == "需求及資訊來源"
    assert ds.DEFAULT_SAMPLES.parent.parent.parent == ds.ROOT.parent


class _FakeServer:
    """接住 main() 傳給 Server 的位址，馬上結束 serve_forever。"""

    seen = None

    def __init__(self, addr, handler):
        _FakeServer.seen = addr

    def serve_forever(self):
        raise KeyboardInterrupt


def _run(monkeypatch, argv):
    monkeypatch.setattr(ds, "Server", _FakeServer)
    _FakeServer.seen = None
    assert ds.main(argv) == 0
    return _FakeServer.seen


def test_default_binds_localhost_only(monkeypatch):
    # 沒說要開內網就只綁本機，別讓整個辦公室連得到
    assert _run(monkeypatch, [])[0] == "127.0.0.1"


def test_lan_flag_binds_all_interfaces(monkeypatch):
    assert _run(monkeypatch, ["--lan"]) == ("0.0.0.0", 8765)


def test_host_option_wins_over_lan(monkeypatch):
    assert _run(monkeypatch, ["--lan", "--host", "192.168.1.23", "--port", "9000"]) == ("192.168.1.23", 9000)


def test_server_does_not_reuse_address_on_windows():
    """Windows 的 SO_REUSEADDR 允許綁到已在 LISTEN 的 port，port 被佔時不會丟 OSError，
    「可能已經有一個在跑」的提示永遠印不出來（2026-09-10）。"""
    assert issubclass(ds.Server, ds.ThreadingHTTPServer)
    assert ds.Server.allow_reuse_address == (sys.platform != "win32")


def test_second_server_on_same_port_fails_loudly(monkeypatch):
    """實際綁一個 port，再用 allow_reuse_address=False 綁第二次一定要 OSError（各平台皆然）。"""
    import socketserver

    class Strict(ds.Server):
        allow_reuse_address = False

    first = ds.Server(("127.0.0.1", 0), ds.Handler)
    try:
        port = first.server_address[1]
        with pytest.raises(OSError):
            Strict(("127.0.0.1", port), ds.Handler)
        monkeypatch.setattr(ds, "Server", Strict)
        assert ds.main(["--port", str(port)]) == 1
    finally:
        first.server_close()


def test_banner_localhost_says_nobody_else_can_connect():
    lines = "\n".join(ds.banner_lines("127.0.0.1", 8765))
    assert "http://localhost:8765/" in lines
    assert "只有這台電腦連得到" in lines
    assert "chrome://flags" not in lines


def test_banner_lan_shows_url_and_chrome_flag():
    lines = "\n".join(ds.banner_lines("0.0.0.0", 8765, "192.168.1.23"))
    assert "http://192.168.1.23:8765/" in lines
    # http 內網位址不是 secure context，同事沒設這個旗標就只能唯讀
    assert "chrome://flags/#unsafely-treat-insecure-origin-as-secure" in lines
    assert "http://192.168.1.23:8765" in lines
    assert "防火牆" in lines


def test_banner_lan_without_ip_tells_user_to_run_ipconfig():
    lines = "\n".join(ds.banner_lines("0.0.0.0", 8765, None))
    assert "ipconfig" in lines


def test_lan_ip_returns_none_or_dotted_quad():
    ip = ds.lan_ip()
    assert ip is None or len(ip.split(".")) == 4


class _NoCloseBytesIO(io.BytesIO):
    """Handler.finish() 會 close 掉 wfile，關掉就讀不到回應；這裡讓 close 不生效。"""

    def close(self):
        pass


class _FakeRequest:
    """假 socket：餵一段 HTTP 請求、收回應。"""

    def __init__(self, raw):
        self.rfile = io.BytesIO(raw)
        self.wfile = _NoCloseBytesIO()

    def makefile(self, mode, *a, **kw):
        return self.rfile if "r" in mode else self.wfile

    def sendall(self, data):
        self.wfile.write(data)


def _get(path, samples_dir):
    saved = ds.Handler.samples_dir
    ds.Handler.samples_dir = samples_dir
    req = _FakeRequest(f"GET {path} HTTP/1.1\r\nHost: x\r\n\r\n".encode("ascii"))
    try:
        ds.Handler(req, ("127.0.0.1", 1), None)
    finally:
        ds.Handler.samples_dir = saved
    return req.wfile.getvalue()


def test_samples_without_dir_returns_404_not_traceback():
    # 狀態行只能是 latin-1：原本 send_error(404, "沒有掛範例資料夾") 每次入口頁載入都噴 UnicodeEncodeError
    out = _get("/samples/index.json", None)
    assert out.startswith(b"HTTP/1.0 404 no samples\r\n"), out[:80]
    assert "沒有掛範例資料夾".encode("utf-8") in out
