# -*- coding: utf-8 -*-
"""tools/make_template_fixtures.py 的匿名規則：案名、營造公司名要被換成範例字串。

規則寫成通用樣式（「…市／縣…工程」、「…營造…有限公司」），程式碼本身不帶真實名稱。
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import make_template_fixtures as mtf  # noqa: E402


def apply(text):
    for pat, rep in mtf.SUBS:
        new = re.sub(pat, rep, text)
        if new != text:
            return new
    return text


def test_project_name_becomes_example():
    assert apply("某某市某某段某某新建統包工程") == "範例工程"
    assert apply("某某縣某某大樓興建工程") == "範例工程"


def test_company_names_become_example():
    assert apply("某某營造工程股份有限公司") == "範例營造股份有限公司"
    assert apply("某某營造工程股份有限公司/某某機電有限公司") == "範例營造股份有限公司/範例機電股份有限公司"


def test_field_labels_are_kept():
    assert apply("內容說明：4F 帷幕骨架") == "內容說明：範例說明"
    assert apply("施工自主檢查照片") == "施工自主檢查照片"  # 沒命中就原樣
