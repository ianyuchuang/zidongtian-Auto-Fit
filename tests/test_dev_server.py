# -*- coding: utf-8 -*-
"""tools/dev_server.py：範例清單與路徑安全。"""
import sys
from pathlib import Path

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
    """接住 main() 傳給 ThreadingHTTPServer 的位址，馬上結束 serve_forever。"""

    seen = None

    def __init__(self, addr, handler):
        _FakeServer.seen = addr

    def serve_forever(self):
        raise KeyboardInterrupt


def _run(monkeypatch, argv):
    monkeypatch.setattr(ds, "ThreadingHTTPServer", _FakeServer)
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
