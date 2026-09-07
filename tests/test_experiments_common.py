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
    assert common.normalize("700mm±10mm") == "700mm±10"  # 白板寫法 ≡ 檔名寫法
    assert common.normalize("2780mm±5mm") == "2780mm±5"
    assert common.normalize("140+70+140mm") == "140+70+140mm"
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
    text = "範例營造\n檢驗項目：帷幕骨架安裝間距尺寸檢查\n標準值 700mm±10\n實際值:700mm\n查驗位置 4F 東側"
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


def test_html_table_to_text_and_extract():
    raw = ("<table><tr><td>查驗項目</td><td colspan=\"3\">☑ 自主檢查</td></tr>"
           "<tr><td></td><td>標準值</td><td colspan=\"2\">實際值</td></tr>"
           "<tr><td>4F 帷幕骨架</td><td>水平：700mm  $ \\pm $ 10mm 垂直：≥780mm</td><td colspan=\"2\">水平：700mm 垂直：≥781mm</td></tr></table>")
    txt = common.html_to_text(raw)
    assert "700mm±10mm" in txt and "$" not in txt and "<" not in txt
    assert txt.splitlines()[0] == "| 查驗項目 | ☑ 自主檢查 |"
    # 白板一列多項目：抽取只會拿到整格，found 才看得出辨識品質
    gt = {"desc": "4F帷幕骨架安裝間距尺寸檢查", "design": "700mm±10", "actual": "700mm"}
    s = common.score(gt, common.extract_fields(raw), "4F", raw=raw)
    assert s["design"]["found"] and s["actual"]["found"] and not s["desc"]["found"]


def test_html_n_tag_becomes_newline():
    assert common.html_to_text("<td>名稱：A&lt;n&gt;地址：B</td>") == "名稱：A\n地址：B"


def test_score_without_raw_has_no_found():
    gt = {"desc": "a", "design": "b", "actual": "c"}
    assert "found" not in common.score(gt, gt)["desc"]


def test_header_row_does_not_yield_partial_keyword():
    assert common.extract_fields("| 標準值 | 實際值 |") == {"desc": "", "design": "", "actual": ""}


def test_best_row_picks_closest_design_actual():
    gt = {"desc": "4F帷幕骨架安裝間距尺寸檢查", "design": "700mm±10", "actual": "700mm"}
    rows = [{"desc": "垂直", "design": "2780mm±5", "actual": "2779mm"},
            {"desc": "水平", "design": "700mm±10mm", "actual": "700mm"},
            {"desc": "目視", "design": "完整無缺失", "actual": "完整無缺失"}]
    assert common.best_row(gt, rows)["desc"] == "水平"
    assert common.best_row(gt, []) is None
