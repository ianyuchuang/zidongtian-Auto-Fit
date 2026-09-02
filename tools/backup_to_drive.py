# -*- coding: utf-8 -*-
"""
backup_to_drive.py — 自懂填 Auto-Fit 備份至 Google 雲端硬碟

做的事：
  1. 把兩個資料夾打包成一個 zip：
       <repo>/                     整個 repo，含 .git（還原得回版本歷史）
       <repo 上一層>/需求及資訊來源/   需求文件、範例照片、V1.0 安裝包
  2. zip 放在 %USERPROFILE%\\.autofit\\backups\\，檔名 自懂填備份-YYYYMMDD-HHMM.zip，只留最近 7 份
  3. 上傳到 Google 雲端硬碟資料夾「自懂填-Auto-Fit 備份」（沒有就建）；雲端舊備份不自動刪

用法：
  python tools\\backup_to_drive.py              打包 + 上傳
  python tools\\backup_to_drive.py --no-upload  只打包不上傳
  python tools\\backup_to_drive.py --dry-run    只列出會做什麼

Google 授權（第一次）：
  1. 把 OAuth 用戶端的 credentials.json 放到 %USERPROFILE%\\.autofit\\credentials.json
     （可沿用施工儀錶板那組，或到 Google Cloud Console 另建「桌面應用程式」用戶端）
  2. 第一次執行會開瀏覽器要求授權，之後 token 存在 %USERPROFILE%\\.autofit\\token.json

需求：pip install -r tools\\requirements-tools.txt
"""

from __future__ import annotations

import argparse
import datetime as _dt
import fnmatch
import logging
import os
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deps  # noqa: E402

# ------------------------- 設定 -------------------------
REPO_DIR = Path(__file__).resolve().parent.parent
SOURCE_DIRS = [REPO_DIR, REPO_DIR.parent / "需求及資訊來源"]

HOME_DIR = Path(os.environ.get("AUTOFIT_HOME") or (Path.home() / ".autofit"))
BACKUP_DIR = HOME_DIR / "backups"
LOG_DIR = HOME_DIR / "logs"
CREDENTIALS_PATH = HOME_DIR / "credentials.json"
TOKEN_PATH = HOME_DIR / "token.json"
FOLDER_ID_PATH = HOME_DIR / "drive_folder_id.txt"

KEEP_LOCAL = 7
ZIP_PREFIX = "自懂填備份-"
DRIVE_FOLDER_NAME = "自懂填-Auto-Fit 備份"
SCOPES = ["https://www.googleapis.com/auth/drive.file"]
AUTH_TIMEOUT = 180  # 瀏覽器授權等幾秒；沒完成就放棄並說明原因，不要一直卡著
AUDIENCE_URL = "https://console.cloud.google.com/auth/audience"
# 上傳需要的套件（import 名稱），缺了先問要不要裝
GOOGLE_MODULES = ["googleapiclient", "google_auth_oauthlib", "google.oauth2", "google.auth"]

# 打包時略過（.git 要保留，所以不在這裡）
EXCLUDE_DIRS = {"__pycache__", ".venv", "venv", "node_modules", ".pytest_cache"}
EXCLUDE_FILES = ["*.pyc", "*.pyo", "Thumbs.db", "desktop.ini", ".DS_Store", "~$*", "*.tmp"]

log = logging.getLogger("backup")


# ------------------------- 打包 -------------------------
def is_excluded_file(name: str) -> bool:
    return any(fnmatch.fnmatch(name, pat) for pat in EXCLUDE_FILES)


def iter_files(root: Path):
    """走訪 root 底下所有要打包的檔案，回傳 (絕對路徑, zip 內相對路徑)。"""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in EXCLUDE_DIRS)
        for fn in sorted(filenames):
            if is_excluded_file(fn):
                continue
            full = Path(dirpath) / fn
            yield full, Path(root.name) / full.relative_to(root)


def zip_name(now: _dt.datetime | None = None) -> str:
    now = now or _dt.datetime.now()
    return f"{ZIP_PREFIX}{now:%Y%m%d-%H%M}.zip"


def make_zip(sources: list[Path], out_path: Path) -> tuple[int, int]:
    """把 sources 全部打進 out_path。回傳 (檔案數, 略過的來源資料夾數)。找不到任何來源就丟錯。"""
    existing = [s for s in sources if s.is_dir()]
    missing = [s for s in sources if not s.is_dir()]
    for m in missing:
        log.warning("找不到來源資料夾，略過: %s", m)
    if not existing:
        raise RuntimeError("所有來源資料夾都不存在，未建立備份。")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for src in existing:
            for full, arc in iter_files(src):
                zf.write(full, arc.as_posix())
                count += 1
    if count == 0:
        out_path.unlink(missing_ok=True)
        raise RuntimeError("來源資料夾裡沒有任何檔案，未建立備份。")
    return count, len(missing)


def rotate(backup_dir: Path, keep: int = KEEP_LOCAL) -> list[Path]:
    """只留最近 keep 份（依檔名排序，檔名含時間戳）。回傳刪掉的檔案。"""
    zips = sorted(backup_dir.glob(f"{ZIP_PREFIX}*.zip"))
    removed = zips[:-keep] if keep > 0 else zips
    for p in removed:
        p.unlink()
        log.info("刪除舊備份: %s", p.name)
    return removed


# ------------------------- Google 雲端硬碟 -------------------------
def get_drive_service():
    """取得 Drive API service；token 過期會自動更新，沒有 token 就跑一次授權流程。"""
    deps.ensure(GOOGLE_MODULES, "Google 雲端硬碟備份")
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build
    except ImportError as e:
        raise RuntimeError(f"Google 套件載入失敗（{e}），請重新執行: {deps.INSTALL_HINT}") from e

    creds = None
    if TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    if not creds or not creds.valid:
        if not CREDENTIALS_PATH.exists():
            raise RuntimeError(
                f"找不到 Google 授權檔: {CREDENTIALS_PATH}\n"
                "請把 OAuth 用戶端的 credentials.json 放到那裡再執行一次。\n"
                "還沒有的話，申請步驟見 docs\\bat.md 的「第一次備份」。"
            )
        flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_PATH), SCOPES)
        creds = authorize(flow)
        TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_PATH.write_text(creds.to_json(), encoding="utf-8")
        log.info("已儲存授權 token: %s", TOKEN_PATH)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def authorize(flow, timeout: int = AUTH_TIMEOUT):
    """開瀏覽器跑一次 OAuth；沒完成（403、瀏覽器沒開、超時）就大聲說明原因，不要卡住。"""
    log.info("第一次使用：會開瀏覽器請你用 Google 帳號授權（%d 秒內沒完成就放棄）。", timeout)
    try:
        return flow.run_local_server(
            port=0,
            timeout_seconds=timeout,
            authorization_prompt_message="瀏覽器沒有自動打開的話，把這個網址貼到 Chrome / Edge：\n{url}\n",
            success_message="授權完成，可以關掉這個分頁，回到備份視窗。",
        )
    except Exception as e:
        raise RuntimeError(
            "Google 授權沒有完成。\n"
            "  - 瀏覽器顯示「已封鎖存取權 / 403 access_denied」：那支 app 還在「測試中」，\n"
            f"    到 {AUDIENCE_URL} 按「發布應用程式」，或把自己的 Gmail 加進「測試使用者」，等一兩分鐘再跑\n"
            "  - 瀏覽器沒有打開：把上面印出的網址貼到 Chrome / Edge\n"
            f"  - 超過 {timeout} 秒沒按完：再跑一次\n"
            f"  （原始錯誤：{type(e).__name__}: {e}）"
        ) from e


def find_or_create_folder(service, name: str = DRIVE_FOLDER_NAME, cache_path: Path = FOLDER_ID_PATH) -> str:
    """回傳雲端備份資料夾的 id；先看快取，再用名稱找，都沒有就建一個。"""
    if cache_path.exists():
        fid = cache_path.read_text(encoding="utf-8").strip()
        if fid:
            try:
                meta = service.files().get(fileId=fid, fields="id, trashed").execute()
                if not meta.get("trashed"):
                    return fid
            except Exception as e:  # 快取的 id 已失效
                log.warning("快取的雲端資料夾 id 無效 (%s)，重新尋找。", e)

    q = (
        f"name = '{name}' and mimeType = 'application/vnd.google-apps.folder' "
        "and trashed = false"
    )
    res = service.files().list(q=q, fields="files(id, name)", pageSize=5).execute()
    files = res.get("files", [])
    if files:
        fid = files[0]["id"]
    else:
        meta = {"name": name, "mimeType": "application/vnd.google-apps.folder"}
        fid = service.files().create(body=meta, fields="id").execute()["id"]
        log.info("已在雲端建立資料夾「%s」", name)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(fid, encoding="utf-8")
    return fid


def upload(service, zip_path: Path, folder_id: str) -> str:
    from googleapiclient.http import MediaFileUpload

    media = MediaFileUpload(str(zip_path), mimetype="application/zip", resumable=True)
    meta = {"name": zip_path.name, "parents": [folder_id]}
    req = service.files().create(body=meta, media_body=media, fields="id")
    resp = None
    while resp is None:
        _status, resp = req.next_chunk()
    return resp["id"]


# ------------------------- 主流程 -------------------------
def setup_logging():
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_file = LOG_DIR / f"backup-{_dt.datetime.now():%Y-%m}.log"
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S")
    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setFormatter(fmt)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(logging.Formatter("%(message)s"))
    log.setLevel(logging.INFO)
    log.handlers[:] = [fh, sh]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="自懂填 Auto-Fit 備份至 Google 雲端硬碟")
    ap.add_argument("--no-upload", action="store_true", help="只打包不上傳")
    ap.add_argument("--dry-run", action="store_true", help="只列出會做什麼")
    args = ap.parse_args(argv)

    setup_logging()
    out_path = BACKUP_DIR / zip_name()

    if args.dry_run:
        for s in SOURCE_DIRS:
            n = sum(1 for _ in iter_files(s)) if s.is_dir() else "（不存在）"
            print(f"來源: {s}  → {n} 個檔案")
        print(f"輸出: {out_path}")
        print(f"上傳: {'否' if args.no_upload else '是，資料夾「' + DRIVE_FOLDER_NAME + '」'}")
        return 0

    log.info("=== 開始備份 ===")

    # 先把「會不會上傳失敗」問完（套件、授權），再花時間打包。
    service = None
    if not args.no_upload:
        service = get_drive_service()

    count, _missing = make_zip(SOURCE_DIRS, out_path)
    size_mb = out_path.stat().st_size / 1024 / 1024
    log.info("已打包 %d 個檔案 → %s (%.1f MB)", count, out_path, size_mb)
    rotate(BACKUP_DIR, KEEP_LOCAL)

    if service is None:
        log.info("--no-upload：不上傳。")
        return 0

    folder_id = find_or_create_folder(service)
    file_id = upload(service, out_path, folder_id)
    log.info("已上傳到雲端資料夾「%s」(file id %s)", DRIVE_FOLDER_NAME, file_id)
    log.info("=== 備份完成 ===")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    try:
        sys.exit(main())
    except Exception as e:
        log.error("備份失敗: %s", e)
        sys.exit(1)
