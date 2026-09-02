# -*- coding: utf-8 -*-
"""
實驗：Qwen3-VL（llama.cpp GGUF，CPU）讀白板 → 三欄正確率（docs/辨識模型實驗計畫.md）。
照片只在本機處理：腳本自己啟動 llama-server（OpenAI 相容 API，只綁 127.0.0.1），跑完關掉。

用法（在 repo 根目錄，用 venv-paddle 的 python 即可，需 Pillow）:
    python experiments/qwen3vl/run.py --size 4b                 # 單階段：整張縮到 1500px 直接讀
    python experiments/qwen3vl/run.py --size 2b --mode twostage # 兩階段：768px 找白板框 → 原圖裁切再讀
    python experiments/qwen3vl/run.py --size 4b --rescore       # 用上次 raw 重算，不跑模型
    python experiments/qwen3vl/run.py --size 4b --llama-dir ..\llama.cpp-vulkan --ngl 99 --tag vulkan  # 核顯
輸出：experiments/results/qwen3vl_<size>_<mode>.json
模型要求輸出白板上「所有列」的 JSON；評分時取與正解最接近的一列（見 common.best_row）。
"""
import argparse
import base64
import io
import json
import re
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from experiments import common  # noqa: E402

BASE = ROOT.parent
DEFAULT_PHOTOS = BASE / "需求及資訊來源" / "來源資料夾範例" / "帷幕骨架" / "4F"
RESULT_DIR = ROOT / "experiments" / "results"
LLAMA_DIR = BASE / "llama.cpp"
MODELS = {
    "4b": ("Qwen3VL-4B-Instruct-Q4_K_M.gguf", "mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf"),
    "2b": ("Qwen3VL-2B-Instruct-Q4_K_M.gguf", "mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf"),
}
PORT = 8089

PROMPT_FIELDS = """這是工地施工自主檢查照片，畫面裡有一塊寫著檢查資料的白板。
請只根據白板上的文字，輸出 JSON（不要多餘說明、不要 markdown 圍欄）：
{"rows":[{"desc":"檢查項目名稱","design":"標準值/設計值","actual":"實際值"}, ...],
 "location":"查驗位置", "date":"查驗日期"}
規則：白板上有幾個檢查項目（例如水平、垂直、焊道高度、腳長、目視）就輸出幾列；數值保留單位與公差（例如 700mm±10）；看不清楚就填空字串，不要猜。"""

PROMPT_BBOX = """找出照片裡的白板（寫字的板子）。只輸出 JSON：{"bbox_2d":[x1,y1,x2,y2]}，座標為 0–1000 的相對座標（左上到右下）。"""


# ---------- llama-server ----------

def port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


def start_server(size: str, llama_dir: Path, models_dir: Path, port: int, ngl: int = 0):
    exe = llama_dir / "llama-server.exe"
    if not exe.exists():
        exe = llama_dir / "llama-server"
    if not exe.exists():
        sys.exit(f"找不到 llama-server：{llama_dir}")
    m, mm = MODELS[size]
    for f in (models_dir / m, models_dir / mm):
        if not f.exists():
            sys.exit(f"找不到模型檔：{f}")
    cmd = [str(exe), "-m", str(models_dir / m), "--mmproj", str(models_dir / mm),
           "--host", "127.0.0.1", "--port", str(port), "-c", "16384", "-ngl", str(ngl), "--temp", "0"]
    print("啟動 llama-server:", " ".join(cmd), flush=True)
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    t = time.perf_counter()
    while time.perf_counter() - t < 300:
        if proc.poll() is not None:
            sys.exit(f"llama-server 提前結束（exit {proc.returncode}），請手動執行上面指令看錯誤")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as r:
                if r.status == 200:
                    print(f"llama-server 就緒 {time.perf_counter() - t:.1f}s", flush=True)
                    return proc
        except Exception:
            pass
        time.sleep(1)
    proc.kill()
    sys.exit("llama-server 5 分鐘內沒就緒")


def chat(port: int, prompt: str, jpeg_bytes: bytes, max_tokens: int = 800) -> str:
    b64 = base64.b64encode(jpeg_bytes).decode()
    body = {
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
        ]}],
        "max_tokens": max_tokens, "temperature": 0,
    }
    req = urllib.request.Request(f"http://127.0.0.1:{port}/v1/chat/completions",
                                 data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=1800) as r:
        data = json.loads(r.read())
    return data["choices"][0]["message"]["content"]


# ---------- 影像 ----------

def load_image(path: Path):
    from PIL import Image, ImageOps
    img = Image.open(path)
    img = ImageOps.exif_transpose(img).convert("RGB")  # 手機照片依 EXIF 轉正
    return img


def resized_jpeg(img, max_side: int) -> bytes:
    w, h = img.size
    s = min(1.0, max_side / max(w, h))
    if s < 1.0:
        img = img.resize((round(w * s), round(h * s)))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return buf.getvalue()


def parse_json(text: str):
    """模型輸出可能夾 ```json 圍欄或前後文字；抓第一個 {...}。失敗回 None。"""
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def crop_whiteboard(img, bbox, margin=0.05):
    """bbox 為 0–1000 相對座標；外擴 margin 後裁切。無效 bbox 回 None。"""
    try:
        x1, y1, x2, y2 = [float(v) / 1000 for v in bbox]
    except (TypeError, ValueError):
        return None
    if not (0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1) or (x2 - x1) * (y2 - y1) < 0.01:
        return None
    w, h = img.size
    box = (max(0, (x1 - margin) * w), max(0, (y1 - margin) * h), min(w, (x2 + margin) * w), min(h, (y2 + margin) * h))
    return img.crop(tuple(round(v) for v in box))


# ---------- 主流程 ----------

def recognize(port: int, img, mode: str, max_side: int) -> dict:
    """回傳 {raw, bbox, stage_seconds}。twostage 找不到白板時退回整張。"""
    out = {"bbox": None, "stage_seconds": {}}
    target = img
    if mode == "twostage":
        t = time.perf_counter()
        ans = chat(port, PROMPT_BBOX, resized_jpeg(img, 768), max_tokens=100)
        out["stage_seconds"]["bbox"] = round(time.perf_counter() - t, 1)
        js = parse_json(ans) or {}
        crop = crop_whiteboard(img, js.get("bbox_2d"))
        if crop is not None:
            out["bbox"] = js.get("bbox_2d")
            target = crop
        else:
            print(f"  白板框無效，退回整張：{ans[:80]!r}", flush=True)
    t = time.perf_counter()
    out["raw"] = chat(port, PROMPT_FIELDS, resized_jpeg(target, max_side))
    out["stage_seconds"]["fields"] = round(time.perf_counter() - t, 1)
    return out


def rows_from_raw(raw: str) -> list:
    js = parse_json(raw) or {}
    rows = js.get("rows") if isinstance(js, dict) else None
    return [r for r in (rows or []) if isinstance(r, dict)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", choices=MODELS, default="4b")
    ap.add_argument("--mode", choices=["full", "twostage"], default="full")
    ap.add_argument("--max-side", type=int, default=1500, help="送辨識的影像最長邊（整張或白板裁切）")
    ap.add_argument("--photos", type=Path, default=DEFAULT_PHOTOS)
    ap.add_argument("--gt", type=Path, default=None)
    ap.add_argument("--llama-dir", type=Path, default=LLAMA_DIR)
    ap.add_argument("--models-dir", type=Path, default=BASE / "models")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--ngl", type=int, default=0, help="卸載到 GPU 的層數；CPU 版執行檔用 0，Vulkan/SYCL 版可用 99（核顯）")
    ap.add_argument("--tag", default="", help="結果檔名附加字（例如 vulkan），區分不同執行檔的結果")
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--rescore", action="store_true")
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    model = f"Qwen3-VL-{args.size.upper()}-Instruct Q4_K_M"
    out_path = args.out or RESULT_DIR / f"qwen3vl_{args.size}_{args.mode}{'_' + args.tag if args.tag else ''}.json"

    if args.rescore:
        prev = json.loads(out_path.read_text(encoding="utf-8"))
        photos = [Path(prev["photos"]) / r["name"] for r in prev["rows"]]
        results = {r["name"]: {"raw": r["raw"], "bbox": r.get("bbox"), "stage_seconds": r.get("stage_seconds", {})} for r in prev["rows"]}
        secs = {r["name"]: r.get("seconds") for r in prev["rows"]}
    else:
        if not args.photos.is_dir():
            sys.exit(f"找不到照片資料夾：{args.photos}")
        photos = common.list_photos(args.photos)
        if not photos:
            sys.exit(f"資料夾裡沒有照片：{args.photos}")
        proc = None
        if not port_open(args.port):
            proc = start_server(args.size, args.llama_dir, args.models_dir, args.port, args.ngl)
        else:
            print(f"port {args.port} 已有 server，直接用（請確認是 {args.size} 的模型）")
        results, secs = {}, {}
        try:
            for p in photos:
                print(f"辨識 {p.name} …", flush=True)
                t = time.perf_counter()
                results[p.name] = recognize(args.port, load_image(p), args.mode, args.max_side)
                secs[p.name] = round(time.perf_counter() - t, 1)
                print(f"  {secs[p.name]}s  {results[p.name]['raw'][:120]!r}", flush=True)
        finally:
            if proc:
                proc.kill()

    folder = photos[0].parent.name if photos else ""
    gts = common.load_ground_truth(photos, args.gt, folder)
    rows = []
    for p in photos:
        r = results[p.name]
        cand = rows_from_raw(r["raw"])
        gt = gts[p.name]
        pred = common.best_row(gt, cand) if gt else (cand[0] if cand else None)
        rows.append({
            "name": p.name, "gt": gt, "pred": pred, "rows_found": len(cand),
            "score": common.score(gt, pred, folder, raw=r["raw"]) if gt else None,
            "seconds": secs.get(p.name), "stage_seconds": r.get("stage_seconds"), "bbox": r.get("bbox"), "raw": r["raw"],
        })
    summary = common.summarize([r for r in rows if r["gt"]])
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({"model": model, "mode": args.mode, "max_side": args.max_side,
                                    "llama_dir": str(args.llama_dir), "ngl": args.ngl,
                                    "photos": str(photos[0].parent), "summary": summary, "rows": rows},
                                   ensure_ascii=False, indent=2), encoding="utf-8")
    common.print_report(f"{model} [{args.mode}]", rows, summary)
    print(f"\n結果已存 {out_path}")


if __name__ == "__main__":
    main()
