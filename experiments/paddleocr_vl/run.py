# -*- coding: utf-8 -*-
"""
實驗：PaddleOCR-VL-1.6 讀白板 → 三欄正確率（docs/辨識模型實驗計畫.md）。
照片只在本機處理。每張照片：整張送模型 → 拿 markdown 文字 → common.extract_fields 抽三欄 → 與檔名正解比對。

用法（在 repo 根目錄、裝好 paddleocr 的 Python）:
    python experiments/paddleocr_vl/run.py                 # 預設跑 4F 範例
    python experiments/paddleocr_vl/run.py --photos 路徑    # 指定資料夾
    python experiments/paddleocr_vl/run.py --mode ocr      # 關版面分析，整張直接當文字讀（prompt_label=ocr）
    python experiments/paddleocr_vl/run.py --mode table    # 關版面分析，整張當表格讀
    python experiments/paddleocr_vl/run.py --rescore       # 不跑模型，用上次存的 raw 文字重新抽欄位＋評分
    python experiments/paddleocr_vl/run.py --mode ocr --max-side 1024   # 先縮圖再辨識（CPU 慢或卡住時用）
每張辨識完就先寫檔（Ctrl+C 中斷也保留已完成的），並印秒數與前 120 字。
模式：layout（預設，PP-DocLayoutV3 先切版面再辨識；對工地照片常誤判成圖片/發票）、ocr、table。
輸出：experiments/results/paddleocr_vl_<mode>.json（含每張的 raw 文字，供調整抽取規則）。
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
RESULT_DIR = ROOT / "experiments" / "results"
MODES = {  # mode → predict() 參數
    "layout": {},
    "ocr": {"use_layout_detection": False, "prompt_label": "ocr"},
    "table": {"use_layout_detection": False, "prompt_label": "table"},
}


def load_pipeline():
    try:
        from paddleocr import PaddleOCRVL
    except ImportError as e:  # 大聲失敗，附安裝提示
        sys.exit(f"找不到 paddleocr：{e}\n請在同一個 Python 執行：pip install paddlepaddle==3.2.1 && pip install -U \"paddleocr[doc-parser]>=3.6.0\"")
    t = time.perf_counter()
    pipe = PaddleOCRVL(pipeline_version="v1.6")
    print(f"模型載入 {time.perf_counter() - t:.1f}s")
    return pipe


def load_input(img: Path, max_side: int):
    """max_side>0 時縮圖（依 EXIF 轉正）後以 numpy 陣列（BGR）送模型；否則直接給路徑。"""
    if not max_side:
        return str(img)
    import numpy as np
    from PIL import Image, ImageOps
    im = ImageOps.exif_transpose(Image.open(img)).convert("RGB")
    w, h = im.size
    s = min(1.0, max_side / max(w, h))
    if s < 1.0:
        im = im.resize((round(w * s), round(h * s)))
    return np.asarray(im)[:, :, ::-1].copy()


def run_one(pipe, img: Path, predict_kwargs: dict, max_side: int = 0) -> tuple[str, float]:
    """回傳 (markdown/純文字, 秒數)。用 save_to_markdown 落地再讀回，避免依賴結果物件的內部屬性名。"""
    t = time.perf_counter()
    outputs = list(pipe.predict(load_input(img, max_side), **predict_kwargs))
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
    ap.add_argument("--mode", choices=MODES, default="layout")
    ap.add_argument("--out", type=Path, default=None, help="預設 experiments/results/paddleocr_vl_<mode>.json")
    ap.add_argument("--rescore", action="store_true", help="用 --out 裡存的 raw 文字重算，不跑模型")
    ap.add_argument("--max-side", type=int, default=0, help="送模型前把最長邊縮到此像素；0＝原圖")
    args = ap.parse_args()
    if args.out is None:
        args.out = RESULT_DIR / f"paddleocr_vl_{args.mode}.json"
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
        try:
            for p in photos:
                print(f"辨識 {p.name} …", flush=True)
                raw[p.name], secs[p.name] = run_one(pipe, p, MODES[args.mode], args.max_side)
                print(f"  {secs[p.name]}s  {raw[p.name][:120]!r}", flush=True)
                write_results(args, photos, raw, secs, partial=True)  # 每張存一次
        except KeyboardInterrupt:
            print("\n中斷，保留已完成的照片", flush=True)
        photos = [p for p in photos if p.name in raw]
        if not photos:
            sys.exit("沒有任何照片完成")

    rows, summary = write_results(args, photos, raw, secs)
    common.print_report(f"{MODEL} [{args.mode}]", rows, summary)
    print(f"\n結果已存 {args.out}")


def write_results(args, photos, raw, secs, partial=False):
    photos = [p for p in photos if p.name in raw]
    folder = photos[0].parent.name if photos else ""
    gts = common.load_ground_truth(photos, args.gt, folder)
    rows = []
    for p in photos:
        pred = common.extract_fields(raw[p.name])
        gt = gts[p.name]
        rows.append({
            "name": p.name, "gt": gt, "pred": pred,
            "score": common.score(gt, pred, folder, raw=raw[p.name]) if gt else None,
            "seconds": secs.get(p.name), "raw": raw[p.name],
        })
    summary = common.summarize([r for r in rows if r["gt"]])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"model": MODEL, "mode": args.mode, "max_side": args.max_side, "partial": partial,
                                    "photos": str(photos[0].parent), "summary": summary, "rows": rows},
                                   ensure_ascii=False, indent=2), encoding="utf-8")
    return rows, summary


if __name__ == "__main__":
    main()
