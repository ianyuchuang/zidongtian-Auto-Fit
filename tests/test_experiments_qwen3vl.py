# -*- coding: utf-8 -*-
"""experiments/qwen3vl/run.py 的純邏輯：JSON 解析、白板框裁切、列抽取（不啟動模型）。"""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location("qwen_run", ROOT / "experiments" / "qwen3vl" / "run.py")
qr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qr)


def test_parse_json_strips_fence_and_text():
    assert qr.parse_json('好的：```json\n{"rows":[{"desc":"a"}]}\n```') == {"rows": [{"desc": "a"}]}
    assert qr.parse_json("看不出來") is None
    assert qr.parse_json("{bad json}") is None


def test_rows_from_raw_filters_non_dict():
    assert qr.rows_from_raw('{"rows":[{"desc":"a"}, "x", 3]}') == [{"desc": "a"}]
    assert qr.rows_from_raw("nothing") == []


def test_crop_whiteboard_bbox_validation_and_margin():
    from PIL import Image
    img = Image.new("RGB", (1000, 500))
    assert qr.crop_whiteboard(img, [200, 200, 800, 700], margin=0).size == (600, 250)
    assert qr.crop_whiteboard(img, [200, 200, 800, 700], margin=0.1).size == (800, 350)  # 外擴後夾在圖內
    assert qr.crop_whiteboard(img, [800, 200, 200, 700]) is None  # x1 > x2
    assert qr.crop_whiteboard(img, [0, 0, 50, 50]) is None  # 太小
    assert qr.crop_whiteboard(img, None) is None


def test_resized_jpeg_caps_long_side():
    from PIL import Image
    import io
    img = Image.new("RGB", (3000, 2000))
    out = Image.open(io.BytesIO(qr.resized_jpeg(img, 1500)))
    assert out.size == (1500, 1000)
    assert Image.open(io.BytesIO(qr.resized_jpeg(Image.new("RGB", (800, 600)), 1500))).size == (800, 600)
