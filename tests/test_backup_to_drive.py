# -*- coding: utf-8 -*-
"""tools/backup_to_drive.py 的測試：打包、排除規則、輪替、雲端資料夾尋找/建立（用假 service）。"""
import datetime as dt
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import backup_to_drive as b  # noqa: E402


def _make_tree(root: Path):
    (root / "repo" / ".git").mkdir(parents=True)
    (root / "repo" / ".git" / "HEAD").write_text("ref: refs/heads/main")
    (root / "repo" / "app.py").write_text("print(1)")
    (root / "repo" / "__pycache__").mkdir()
    (root / "repo" / "__pycache__" / "app.cpython-312.pyc").write_bytes(b"x")
    (root / "repo" / "Thumbs.db").write_bytes(b"x")
    (root / "需求及資訊來源").mkdir()
    (root / "需求及資訊來源" / "需求.md").write_text("# 需求", encoding="utf-8")
    (root / "需求及資訊來源" / "~$暫存.docx").write_bytes(b"x")


def test_make_zip_includes_git_and_excludes_junk(tmp_path):
    _make_tree(tmp_path)
    out = tmp_path / "out" / "x.zip"
    count, missing = b.make_zip([tmp_path / "repo", tmp_path / "需求及資訊來源"], out)
    names = set(zipfile.ZipFile(out).namelist())
    assert names == {"repo/.git/HEAD", "repo/app.py", "需求及資訊來源/需求.md"}
    assert count == 3 and missing == 0


def test_make_zip_skips_missing_source_but_continues(tmp_path):
    _make_tree(tmp_path)
    out = tmp_path / "x.zip"
    count, missing = b.make_zip([tmp_path / "repo", tmp_path / "不存在"], out)
    assert count == 2 and missing == 1


def test_make_zip_fails_loudly_when_nothing_to_backup(tmp_path):
    with pytest.raises(RuntimeError):
        b.make_zip([tmp_path / "a", tmp_path / "b"], tmp_path / "x.zip")
    assert not (tmp_path / "x.zip").exists()


def test_zip_name_format():
    assert b.zip_name(dt.datetime(2026, 9, 2, 19, 5)) == "自懂填備份-20260902-1905.zip"


def test_rotate_keeps_newest(tmp_path):
    for i in range(10):
        (tmp_path / f"{b.ZIP_PREFIX}202609{i:02d}-1900.zip").write_bytes(b"x")
    (tmp_path / "other.zip").write_bytes(b"x")
    removed = b.rotate(tmp_path, keep=7)
    left = sorted(p.name for p in tmp_path.glob("*.zip"))
    assert len(removed) == 3
    assert f"{b.ZIP_PREFIX}20260900-1900.zip" not in left
    assert f"{b.ZIP_PREFIX}20260909-1900.zip" in left
    assert "other.zip" in left  # 不是備份檔的不動


# ---------- 假的 Drive service，只支援本工具用到的呼叫 ----------
class _Exec:
    def __init__(self, result):
        self._r = result

    def execute(self):
        if isinstance(self._r, Exception):
            raise self._r
        return self._r


class _Files:
    def __init__(self, existing: dict, valid_ids: set):
        self.existing = existing  # name -> id
        self.valid_ids = valid_ids
        self.created = []

    def get(self, fileId, fields=None):
        if fileId in self.valid_ids:
            return _Exec({"id": fileId, "trashed": False})
        return _Exec(RuntimeError("404 not found"))

    def list(self, q=None, fields=None, pageSize=None):
        hits = [{"id": i, "name": n} for n, i in self.existing.items() if f"name = '{n}'" in q]
        return _Exec({"files": hits})

    def create(self, body=None, fields=None, media_body=None):
        fid = f"new-{len(self.created) + 1}"
        self.created.append(body)
        self.valid_ids.add(fid)
        return _Exec({"id": fid})


class _Service:
    def __init__(self, existing=None, valid_ids=None):
        self._files = _Files(existing or {}, set(valid_ids or []))

    def files(self):
        return self._files


def test_find_or_create_uses_cache_when_valid(tmp_path):
    cache = tmp_path / "id.txt"
    cache.write_text("abc")
    svc = _Service(valid_ids={"abc"})
    assert b.find_or_create_folder(svc, "X", cache) == "abc"
    assert svc.files().created == []


def test_find_or_create_finds_by_name_when_cache_stale(tmp_path):
    cache = tmp_path / "id.txt"
    cache.write_text("dead")
    svc = _Service(existing={"X": "found-1"})
    assert b.find_or_create_folder(svc, "X", cache) == "found-1"
    assert cache.read_text() == "found-1"


def test_find_or_create_creates_when_absent(tmp_path):
    cache = tmp_path / "id.txt"
    svc = _Service()
    fid = b.find_or_create_folder(svc, "X", cache)
    assert fid == "new-1"
    assert svc.files().created[0]["mimeType"] == "application/vnd.google-apps.folder"
    assert cache.read_text() == "new-1"


# ---------- 授權流程：沒完成要說原因，不能默默卡住 ----------
class _Flow:
    def __init__(self, result=None, error=None):
        self.result, self.error, self.kwargs = result, error, None

    def run_local_server(self, **kwargs):
        self.kwargs = kwargs
        if self.error:
            raise self.error
        return self.result


def test_authorize_uses_timeout_and_returns_creds():
    flow = _Flow(result="creds")
    assert b.authorize(flow, timeout=42) == "creds"
    assert flow.kwargs["timeout_seconds"] == 42
    assert flow.kwargs["port"] == 0


def test_authorize_explains_when_browser_flow_fails():
    # 403 頁面不會導回 localhost，run_local_server 超時後會丟 AttributeError
    flow = _Flow(error=AttributeError("'NoneType' object has no attribute 'replace'"))
    with pytest.raises(RuntimeError) as e:
        b.authorize(flow, timeout=1)
    msg = str(e.value)
    assert "403" in msg and "發布應用程式" in msg and "AttributeError" in msg


def test_describe_client_shows_project_and_client_prefix_only(tmp_path):
    cred = tmp_path / "credentials.json"
    cred.write_text('{"installed":{"project_id":"autofit-123","client_id":"680638242094-abcdefghijklmnop.apps.googleusercontent.com","client_secret":"SECRET-XYZ"}}', encoding="utf-8")
    text = b.describe_client(cred)
    assert "autofit-123" in text and "680638242094-abcdefg" in text
    assert "SECRET" not in text and "googleusercontent" not in text


def test_describe_client_does_not_crash_on_bad_file(tmp_path):
    cred = tmp_path / "credentials.json"
    cred.write_text("not json", encoding="utf-8")
    assert "讀不出" in b.describe_client(cred)
