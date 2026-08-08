from __future__ import annotations

import json
import unittest
import urllib.parse
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class RepositoryTests(unittest.TestCase):
    def test_required_json_is_valid(self):
        for path in [
            ROOT / "config" / "topics.json",
            ROOT / "config" / "sources.json",
            ROOT / "config" / "runtime.json",
            ROOT / "data" / "papers.json",
            ROOT / "data" / "news.json",
            ROOT / "data" / "notices.json",
            ROOT / "data" / "status.json",
            ROOT / "data" / "translations.zh-CN.json",
            ROOT / "site" / "data" / "translations.zh-CN.json",
        ]:
            with self.subTest(path=path):
                json.loads(path.read_text(encoding="utf-8"))

    def test_every_paper_has_traceable_source(self):
        papers = json.loads((ROOT / "data" / "papers.json").read_text(encoding="utf-8"))
        for paper in papers:
            with self.subTest(id=paper.get("id")):
                self.assertTrue(paper.get("id"))
                self.assertTrue(paper.get("title"))
                self.assertTrue(paper.get("source"))
                self.assertTrue(paper.get("url"))
                self.assertIsInstance(paper.get("categories"), list)
                self.assertEqual(len(paper.get("categories", [])), len(set(paper.get("categories", []))))

    def test_figure_records_are_license_gated_and_bounded(self):
        papers = json.loads((ROOT / "data" / "papers.json").read_text(encoding="utf-8"))
        for paper in papers:
            figures = paper.get("figures", [])
            with self.subTest(id=paper.get("id")):
                self.assertLessEqual(len(figures), 2)
                if figures:
                    license_url = paper.get("license", "").lower()
                    self.assertTrue(
                        "creativecommons.org/licenses/by/" in license_url
                        or "creativecommons.org/publicdomain/zero/" in license_url
                    )
                    self.assertEqual(paper.get("rights_status"), "reusable")
                    for figure in figures:
                        self.assertTrue(figure.get("url"))
                        self.assertTrue(figure.get("caption"))
                        self.assertTrue(figure.get("source_url"))
                        parsed = urllib.parse.urlsplit(figure["url"])
                        self.assertEqual(parsed.scheme, "https")
                        self.assertIn(parsed.hostname, {"arxiv.org", "export.arxiv.org"})

    def test_core_nuclear_taxonomy_is_present(self):
        topics = json.loads((ROOT / "config" / "topics.json").read_text(encoding="utf-8"))
        ids = {item["id"] for item in topics["categories"]}
        for category in [
            "experimental-nuclear", "theoretical-nuclear", "nuclear-structure",
            "nuclear-decay", "nuclear-reactions", "detectors-daq",
        ]:
            self.assertIn(category, ids)

    def test_codex_translations_match_existing_papers(self):
        papers = json.loads((ROOT / "data" / "papers.json").read_text(encoding="utf-8"))
        translations = json.loads((ROOT / "data" / "translations.zh-CN.json").read_text(encoding="utf-8"))
        paper_ids = {paper["id"] for paper in papers}
        self.assertEqual(translations.get("provider"), "Codex")
        self.assertGreaterEqual(len(translations.get("items", {})), 1)
        for paper_id, item in translations["items"].items():
            with self.subTest(id=paper_id):
                self.assertIn(paper_id, paper_ids)
                self.assertTrue(item.get("title_zh"))
                self.assertTrue(item.get("abstract_zh"))

    def test_site_entrypoint_exists(self):
        index = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="cardList"', index)
        self.assertIn('id="scopeSelect"', index)
        self.assertIn('value="custom"', index)
        self.assertIn('id="customDateRange"', index)
        self.assertIn('id="dateFrom"', index)
        self.assertIn('id="dateTo"', index)
        self.assertNotIn('id="homeHubGrid"', index)
        self.assertIn('class="metrics briefing-metrics"', index)
        self.assertEqual(index.count('id="paperCount"'), 1)
        self.assertNotIn('class="paper-figures"', index)
        self.assertIn('id="noteDialog"', index)
        self.assertIn('id="noteInput"', index)
        self.assertIn('id="favoriteDialog"', index)
        self.assertIn('id="myKeywordList"', index)
        self.assertIn('id="mySpaceNav"', index)
        self.assertIn('id="myItemDialog"', index)
        self.assertIn("小康康的物理世界", index)
        self.assertIn("window.location.protocol === 'file:'", index)
        self.assertIn('dataset.dayTheme', index)
        self.assertIn('src="./app.js"', index)

    def test_reader_ui_is_text_first_and_private_note_safe(self):
        index = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        runtime = json.loads((ROOT / "config" / "runtime.json").read_text(encoding="utf-8"))
        self.assertEqual(runtime.get("figure_enrichment_limit"), 0)
        self.assertNotIn("appendFigureGallery", app)
        self.assertNotIn("论文关键图", index + app)
        self.assertIn("function publicSyncEvent", app)
        self.assertIn("function openNoteDialog", app)
        self.assertIn("不会上传或公开到 GitHub", index)
        self.assertIn("state.scope === 'custom'", app)


if __name__ == "__main__":
    unittest.main()
