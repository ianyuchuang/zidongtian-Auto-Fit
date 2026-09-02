# -*- coding: utf-8 -*-
"""
實驗：PaddleOCR-VL-1.6 讀白板 → 三欄正確率（docs/辨識模型實驗計畫.md）。
照片只在本機處理。每張照片：整張送模型 → 拿 markdown 文字 → common.extract_fields 抽三欄 → 與檔名正解比對。

用法（在 repo 根目錄、裝好 paddleocr 的 Python）:
    python experiments/paddleocr_vl/run.py                 # 預設跑 4F 範例
    python experiments/paddleocr_vl/run.py --photos 路徑    # 指定資料夾
    python experiments/paddleocr_vl/run.py --rescore       # 不跑模型，用上次存的 raw 文字重新抽欄位＋評分
輸出：experiments/results/paddleocr_vl.json（含每張的 raw 文字，供調整抽取規則）。
"""
import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from experiments import common  # noqa: E402

MODEL = "PaddleOCR-VL-1.6"
DEFAULT_PHOTOS = ROOT.parent / "需求及資訊來源" / "來源資料夾範例" / "帷幕骨架" / "4F"
RESULT = ROOT / "experiments" / "results" / "paddleocr_vl.json"


def load_pipeline():
    try:
        from paddleocr import PaddleOCRVL
    except ImportError as e:  # 大聲失敗，附安裝提示
        sys.exit(f"找不到 paddleocr：{e}\n請在同一個 Python 執行：pip install paddlepaddle==3.2.1 && pip install -U \"paddleocr[doc-parser]>=3.6.0\"")
    t = time.perf_counter()
    pipe = PaddleOCRVL(pipeline_version="v1.6")
    print(f"模型載入 {time.perf_counter() - t:.1f}s")
    return pipe


def run_one(pipe, img: Path) -> tuple[str, float]:
    """回傳 (markdown/純文字, 秒數)。用 save_to_markdown 落地再讀回，避免依賴結果物件的內部屬性名。"""
    t = time.perf_counter()
    outputs = list(pipe.predict(str(img)))
    secs = time.perf_counter() - t
    texts = []
    with tempfile.TemporaryDirectory() as td:
        for res in outputs:
            md = getattr(res, "markdown", None)
            if isinstance(md, dict) and md.get("markdown_texts"):
                texts.append(str(md["markdown_texts"]))
                continue
            res.save_to_markdown(save_path=td)
            for f in sorted(Path(td).glob("*.md")):
                texts.append(f.read_text(encoding="utf-8"))
                f.unlink()
    text = "\n".join(texts).strip()
    if not text:
        raise RuntimeError(f"{img.name}: 模型沒有回傳任何文字")
    return text, round(secs, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--photos", type=Path, default=DEFAULT_PHOTOS)
    ap.add_argument("--gt", type=Path, default=None, help="檔名不可解析時的正解 JSON")
    ap.add_argument("--out", type=Path, default=RESULT)
    ap.add_argument("--rescore", action="store_true", help="用 --out 裡存的 raw 文字重算，不跑模型")
    args = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    if args.rescore:
        prev = json.loads(args.out.read_text(encoding="utf-8"))
        raw = {r["name"]: r["raw"] for r in prev["rows"]}
        photos = [Path(prev["photos"]) / n for n in raw]
        secs = {r["name"]: r.get("seconds") for r in prev["rows"]}
    else:
        if not args.photos.is_dir():
            sys.exit(f"找不到照片資料夾：{args.photos}")
        photos = common.list_photos(args.photos)
        if not photos:
            sys.exit(f"資料夾裡沒有照片：{args.photos}")
        raw, secs = {}, {}
        pipe = load_pipeline()
        for p in photos:
            print(f"辨識 {p.name} …", flush=True)
            raw[p.name], secs[p.name] = run_one(pipe, p)

    folder = photos[0].parent.name if photos else ""
    gts = common.load_ground_truth(photos, args.gt, folder)
    rows = []
    for p in photos:
        pred = common.extract_fields(raw[p.name])
        gt = gts[p.name]
        rows.append({
            "name": p.name, "gt": gt, "pred": pred,
            "score": common.score(gt, pred, folder) if gt else None,
            "seconds": secs.get(p.name), "raw": raw[p.name],
        })
    summary = common.summarize([r for r in rows if r["gt"]])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"model": MODEL, "photos": str(photos[0].parent), "summary": summary, "rows": rows},
                                   ensure_ascii=False, indent=2), encoding="utf-8")
    common.print_report(MODEL, rows, summary)
    print(f"\n結果已存 {args.out}")


if __name__ == "__main__":
    main()
