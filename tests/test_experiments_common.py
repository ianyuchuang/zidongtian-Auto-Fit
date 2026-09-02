# -*- coding: utf-8 -*-
"""experiments/common.py：檔名正解、正規化、CER、欄位抽取、彙總。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from experiments import common  # noqa: E402


def test_parse_photo_name_rsplit_two():
    assert common.parse_photo_name("4F帷幕骨架安裝間距尺寸檢查-700mm±10-700mm.jpg") == {
        "desc": "4F帷幕骨架安裝間距尺寸檢查", "design": "700mm±10", "actual": "700mm"}
    assert common.parse_photo_name("203662_0.jpg") is None


def test_is_photo_name_skips_junk():
    assert common.is_photo_name("a-b-c.JPG")
    assert not common.is_photo_name("~$50725 4f東側.docx")
    assert not common.is_photo_name("Thumbs.db")


def test_normalize_and_cer():
    assert common.normalize("７００ｍｍ ± １０") == "700mm±10"
    assert common.normalize("700mm+-10") == "700mm±10"
    assert common.cer("700mm", "700mm") == 0
    assert common.cer("700mm", "780mm") == 0.2
    assert common.cer("", "") == 0 and common.cer("", "x") == 1


def test_score_desc_without_floor_prefix():
    gt = {"desc": "4F帷幕骨架銲道目視檢查", "design": "完整無缺失", "actual": "完整無缺失"}
    pred = {"desc": "帷幕骨架銲道目視檢查", "design": "完整無缺失", "actual": "完整無缺失"}
    s = common.score(gt, pred, "4F")
    assert not s["desc"]["exact"] and s["desc"]["exact_nofloor"]
    assert s["design"]["exact"] and s["actual"]["cer"] == 0


def test_extract_fields_colon_lines():
    text = "永青營造\n檢驗項目：帷幕骨架安裝間距尺寸檢查\n標準值 700mm±10\n實際值:700mm\n查驗位置 4F 東側"
    assert common.extract_fields(text) == {"desc": "帷幕骨架安裝間距尺寸檢查", "design": "700mm±10", "actual": "700mm"}


def test_extract_fields_markdown_table_and_next_line():
    text = "| 檢驗項目 | 帷幕骨架銲道目視檢查 |\n|---|---|\n| 標準值 | 完整無缺失 |\n實際值\n完整無缺失"
    assert common.extract_fields(text) == {"desc": "帷幕骨架銲道目視檢查", "design": "完整無缺失", "actual": "完整無缺失"}


def test_extract_fields_missing_is_empty():
    assert common.extract_fields("看不出來") == {"desc": "", "design": "", "actual": ""}


def test_summarize_rates():
    gt = {"desc": "a", "design": "b", "actual": "c"}
    rows = [
        {"gt": gt, "pred": gt, "score": common.score(gt, gt), "seconds": 10},
        {"gt": gt, "pred": {"desc": "a", "design": "x", "actual": "c"}, "score": common.score(gt, {"desc": "a", "design": "x", "actual": "c"}), "seconds": 20},
    ]
    s = common.summarize(rows)
    assert s["n"] == 2 and s["desc"]["exact_rate"] == 1 and s["design"]["exact_rate"] == 0.5 and s["mean_seconds"] == 15
