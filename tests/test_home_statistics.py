import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_site import paper_library_stats
from translate_content import source_hash


class HomeStatisticsTests(unittest.TestCase):
    def test_full_library_deduplicates_and_uses_worker_completion_rules(self):
        daily = {"id": "daily", "type": "paper", "title": "Nuclear structure",
                 "source": "Physical Review C", "source_type": "journal",
                 "published": "2026-11-10", "doi": "10.1103/example", "abstract": ""}
        historical_duplicate = {**daily, "id": "old"}
        untranslated = {**daily, "id": "pending", "doi": "10.1103/pending",
                        "title": "Nuclear reactions", "published": "2001-01-01"}
        native = {**daily, "id": "native", "doi": "10.1103/native", "title": "原子核结构"}
        excluded = {**daily, "id": "excluded", "doi": "10.1103/excluded",
                    "title": "Higgs boson couplings", "source": "Physical Review D"}
        # 无发布日期的论文仍属于全库；统计不依赖历史按月索引。
        undated = {**daily, "id": "undated", "doi": "10.1103/undated", "published": ""}
        translations = {"items": {
            "daily": {"title_zh": "Nuclear 核", "source_hash": source_hash(daily),
                      "content_validation": "disabled"},
            "pending": {"title_zh": "旧版中文标题", "source_hash": "stale"},
        }}
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            for name, value in {
                "papers.json": [daily, native, undated],
                "news.json": [{"id": "news", "type": "news", "title": "News"}],
                "notices.json": [],
                "history/papers/2001/01.json": [historical_duplicate, untranslated, excluded],
                "translations.zh-CN.json": translations,
            }.items():
                path = data / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(value))
            stats = paper_library_stats(data)
        self.assertEqual(stats["total"], 4)
        self.assertEqual(stats["translated"], 1)
        self.assertEqual(stats["native"], 1)
        self.assertEqual(stats["complete"], 2)
        self.assertEqual(stats["pending"], 2)
        self.assertEqual(stats["published_counts"], {"2026-11-10": 2, "2001-01-01": 1})

    def test_empty_library_has_no_completed_papers(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            (data / "translations.zh-CN.json").write_text('{"items": {}}')
            stats = paper_library_stats(data)
        self.assertEqual(stats["total"], 0)
        self.assertEqual(stats["complete"], 0)
        self.assertEqual(stats["pending"], 0)


if __name__ == "__main__":
    unittest.main()
