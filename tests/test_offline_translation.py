import datetime as dt
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import offline_translation as offline
import translate_content as translation
from argparse import Namespace


class OfflineTranslationTests(unittest.TestCase):
    def test_protect_and_restore_math_numbers_acronyms(self):
        text = r"The $B(E2; 2^+_1 \to 0^+_1)$ of 52Ca at 42.5 MeV with HIAF."
        protected, mapping = offline.protect(text, {})
        self.assertNotIn("42.5", protected)
        self.assertNotIn("52Ca", protected)
        self.assertNotIn("HIAF", protected)
        self.assertEqual(offline.restore(protected, mapping), text)

    def test_restore_rejects_missing_extra_and_duplicate_markers(self):
        for text in ("核结构", "X100001X X100001X", "X100001X X100002X"):
            with self.assertRaises(offline.QualityError):
                offline.restore(text, {"X100001X": "$N=32$"})
        self.assertEqual(offline.restore("核素 X 100001 X", {"X100001X": "52Ca"}), "核素 52Ca")

    def test_longest_term_and_word_boundary(self):
        source = "nuclear structure and structure, structurally"
        protected, rules = offline.protect(source, {"nuclear structure": "核结构", "structure": "结构"})
        self.assertEqual(offline.restore(protected, rules), "核结构 and 结构, structurally")

    def test_literal_validation_preserves_equations_not_just_numbers(self):
        source = r"The $B(E2)$ of $^{52,54}\text{Ca}$, N = 32, 34."
        correct = r"$^{52,54}\text{Ca}$ 的 $B(E2)$，N = 32、34。"
        self.assertEqual(offline.validate_literals(source, correct), correct)
        for changed in [correct.replace('54', '55'), correct.replace('B(E2)', 'B(M2)'), correct.replace('$B(E2)$', '')]:
            with self.assertRaises(offline.QualityError):
                offline.validate_literals(source, changed)

    def test_user_term_is_required_not_just_a_prompt_hint(self):
        offline.check_user_terms("The neutron skin", "中子皮", {"neutron skin": "中子皮"})
        with self.assertRaises(offline.QualityError):
            offline.check_user_terms("The neutron skin", "中子表皮", {"neutron skin": "中子皮"})

    def test_dates_do_not_need_chinese_characters(self):
        self.assertFalse(translation.requires_translation("2026-09-11 — 2026-09-11"))
        item = {"id": "meeting", "title": "CEPC Meeting", "summary": "2026-09-11 — 2026-09-11"}
        self.assertFalse(translation.needs_translation(item, {"meeting": {"title_zh": "CEPC 会议"}}))
        self.assertTrue(translation.is_chinese("会议链接：https://example.org/very-long-latin-address/meeting 会议编号：1234 密码：4567"))

    def test_signed_quantities_cannot_change_sign(self):
        self.assertEqual(offline.validate_literals("The correction is -0.97.", "修正为-0.97。"), "修正为-0.97。")
        with self.assertRaises(offline.QualityError):
            offline.validate_literals("The correction is -0.97.", "修正为0.97。")

    def test_balanced_selection_and_retry_cooldown(self):
        now = dt.datetime.now(dt.timezone.utc)
        papers = [{"id": f"p{i}", "type": "paper", "title": "Nuclear study"} for i in range(10)]
        news = [{"id": "n", "type": "news", "title": "Nuclear news"}]
        notices = [{"id": "m", "type": "notice", "title": "Nuclear meeting"}]
        candidates = notices + news + papers
        retry = {"p0": {"source_hash": translation.source_hash(papers[0]), "last_attempt": now.isoformat(), "attempts": 1}}
        selected = translation.select_balanced(candidates, 6, retry, now)
        self.assertEqual([x["type"] for x in selected], ["paper"] * 4 + ["news", "notice"])
        self.assertNotIn("p0", [x["id"] for x in selected])
        self.assertEqual(len(translation.select_balanced(candidates, 100, retry, now + dt.timedelta(days=2))), 12)

    def test_preserve_valid_previous_title(self):
        engine = object.__new__(offline.OfflineTranslator)
        item = {"id": "p", "title": "Nuclear structure", "abstract": "New abstract"}
        with patch.object(engine, "translate", return_value="新的摘要译文") as translate:
            result = engine.translate_item(item, {"title_zh": "已经校对的核结构题目"})
        self.assertEqual(result["title_zh"], "已经校对的核结构题目")
        translate.assert_called_once_with("New abstract")

    def test_quality_failure_never_overwrites_previous_translation(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            item = {"id": "p", "type": "paper", "title": "Nuclear structure", "abstract": "Full abstract"}
            for name, records in (("papers", [item]), ("news", []), ("notices", [])):
                (data / f"{name}.json").write_text(json.dumps(records))
            old = {"items": {"p": {"title_zh": "原有中文题目"}}}
            path = data / "translations.zh-CN.json"
            path.write_text(json.dumps(old))
            with patch.object(translation, "DATA", data), patch.object(translation, "TRANSLATIONS", path), patch.object(translation, "QUEUE", data / "queue.json"), patch.object(offline, "OfflineTranslator") as cls:
                cls.return_value.translate_item.side_effect = offline.QualityError("保护项被改写")
                translation.run_offline(Namespace(limit=1, max_minutes=1, strict=False), old)
            self.assertEqual(json.loads(path.read_text()), old)
            report = json.loads((data / "translation-run.json").read_text())
            self.assertEqual(report["completed"], 0)
            self.assertEqual(report["pending"], 1)
            self.assertEqual(report["service_status"], "failed")
            cls.return_value.close.assert_called_once()

    def test_success_writes_provenance_and_real_progress(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            for name in ("papers", "news", "notices"):
                (data / f"{name}.json").write_text(json.dumps([{"id": "p", "type": "paper", "title": "Nuclear structure"}] if name == "papers" else []))
            with patch.object(translation, "DATA", data), patch.object(translation, "TRANSLATIONS", data / "translations.json"), patch.object(translation, "QUEUE", data / "queue.json"), patch.object(offline, "OfflineTranslator") as cls:
                cls.return_value.translate_item.return_value = {"title_zh": "核结构", "abstract_zh": ""}
                translation.run_offline(Namespace(limit=1, max_minutes=1, strict=False), {"items": {}})
            result = json.loads((data / "translations.json").read_text())["items"]["p"]
            self.assertEqual(result["quality"], "machine_draft")
            self.assertIn("未提供 abstract/summary", result["note"])
            self.assertEqual(json.loads((data / "queue.json").read_text())["pending"], 0)


if __name__ == "__main__":
    unittest.main()
