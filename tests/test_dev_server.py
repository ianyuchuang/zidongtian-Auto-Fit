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
    return root


def test_list_samples_skips_junk_and_uses_posix_paths(tmp_path):
    root = _samples(tmp_path)
    idx = ds.list_samples(root)
    assert idx["root"] == "帷幕骨架"
    assert [f["path"] for f in idx["files"]] == ["4F/a-1-2.jpg", "5F/203662_0.jpg"]
    assert idx["files"][0]["url"].startswith("/samples/4F/")


def test_resolve_sample_path_blocks_traversal(tmp_path):
    root = _samples(tmp_path)
    ok = ds.resolve_sample_path(root, "/samples/4F/a-1-2.jpg")
    assert ok == (root / "4F" / "a-1-2.jpg").resolve()
    assert ds.resolve_sample_path(root, "/samples/../secret.txt") is None
    assert ds.resolve_sample_path(root, "/samples/4F/%2e%2e/%2e%2e/x") is None
