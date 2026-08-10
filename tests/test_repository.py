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
            ROOT / "config" / "notice_portals.json",
            ROOT / "data" / "papers.json",
            ROOT / "data" / "news.json",
            ROOT / "data" / "notices.json",
            ROOT / "data" / "status.json",
            ROOT / "data" / "translations.zh-CN.json",
            ROOT / "site" / "data" / "translations.zh-CN.json",
            ROOT / "site" / "data" / "notice-portals.json",
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
        self.assertIn('id="homeDashboard"', index)
        self.assertIn('id="dailyPaperCount"', index)
        self.assertIn('id="homeNewsList"', index)
        self.assertIn('id="homeNoticeList"', index)
        self.assertIn('id="homeFeaturedList"', index)
        self.assertIn('id="noticePortalDialog"', index)
        self.assertIn('id="noticePortalSearch"', index)
        self.assertIn('id="dailyNoticeDashboard"', index)
        self.assertIn('id="dailyNoticeCategories"', index)
        self.assertIn('id="deadlineList"', index)
        self.assertIn('id="dailyNoticeList"', index)
        self.assertIn('Nature Communications', index)
        self.assertEqual(index.count('id="paperCount"'), 1)
        self.assertNotIn('class="paper-figures"', index)
        self.assertIn('id="noteDialog"', index)
        self.assertIn('id="noteInput"', index)
        self.assertIn('id="favoriteDialog"', index)
        self.assertIn('id="myKeywordList"', index)
        self.assertIn('id="mySpaceNav"', index)
        self.assertIn('id="myItemDialog"', index)
        self.assertIn('data-my-section="translations"', index)
        self.assertIn('id="translationShelfPanel"', index)
        self.assertIn('id="translationGlossaryDialog"', index)
        self.assertIn("小康康的物理世界", index)
        self.assertIn("window.location.protocol === 'file:'", index)
        self.assertIn('dataset.dayTheme', index)
        self.assertIn('src="./app.js?v=', index)

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

    def test_paper_information_panel_omits_title_and_reading_actions(self):
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        panel = app.split("function renderAssistantPaperDetail(item) {", 1)[1].split(
            "function renderPaperAssistant", 1
        )[0]
        self.assertNotIn('<h3>${text(item.title)}</h3>', panel)
        self.assertNotIn('<span>阅读操作</span>', panel)
        self.assertNotIn('id="assistantReadAction"', panel)

    def test_translation_collection_and_custom_glossary_are_persistent(self):
        index = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        styles = (ROOT / "site" / "styles.css").read_text(encoding="utf-8")
        self.assertIn("translationFavorites", app)
        self.assertIn("translationGlossary", app)
        self.assertIn("function applyTranslationGlossary", app)
        self.assertIn("function toggleTranslationFavorite", app)
        self.assertIn("function saveTranslationGlossary", app)
        self.assertIn('id="translationPhraseSource"', index)
        self.assertIn('id="translationPhraseTarget"', index)
        self.assertIn(".translation-shelf-panel", styles)

    def test_notice_portal_is_official_categorized_and_searchable(self):
        payload = json.loads((ROOT / "config" / "notice_portals.json").read_text(encoding="utf-8"))
        categories = {item["id"] for item in payload["categories"]}
        required = {
            "funding-national", "funding-local", "talent", "beam-domestic",
            "beam-international", "meetings-nuclear", "funding-international",
        }
        self.assertTrue(required.issubset(categories))
        self.assertGreaterEqual(len(payload["entries"]), 45)
        ids = [item["id"] for item in payload["entries"]]
        self.assertEqual(len(ids), len(set(ids)))
        searchable_text = " ".join(
            " ".join([item["name"], item.get("scope", ""), *(item.get("tags") or [])])
            for item in payload["entries"]
        )
        for keyword in ["国家自然科学基金", "博士后", "CSC", "RIBLL", "NUSYS", "核电子学", "核结构"]:
            self.assertIn(keyword, searchable_text)
        for item in payload["entries"]:
            with self.subTest(id=item["id"]):
                self.assertIn(item["category"], categories)
                self.assertTrue(item["name"])
                self.assertTrue(item["description"])
                parsed = urllib.parse.urlsplit(item["url"])
                self.assertEqual(parsed.scheme, "https")
                self.assertTrue(parsed.hostname)

    def test_notice_portal_only_scrolls_vertically(self):
        styles = (ROOT / "site" / "styles.css").read_text(encoding="utf-8")
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        self.assertIn(".notice-portal-list", styles)
        self.assertIn("overflow-x: hidden", styles)
        self.assertIn("overflow-y: auto", styles)
        self.assertIn("function renderNoticePortal", app)
        self.assertIn("noticePortalQuery", app)

    def test_daily_notice_sources_and_ui_are_categorized(self):
        sources = json.loads((ROOT / "config" / "sources.json").read_text(encoding="utf-8"))["notice_pages"]
        monitored = [item for item in sources if item.get("kind", "notice") == "notice"]
        self.assertGreaterEqual(len(monitored), 30)
        categories = {item.get("notice_category") for item in monitored}
        self.assertTrue({
            "funding-national", "funding-local", "talent", "beam-domestic",
            "beam-international", "meetings-nuclear", "funding-international",
        }.issubset(categories))
        app = (ROOT / "site" / "app.js").read_text(encoding="utf-8")
        styles = (ROOT / "site" / "styles.css").read_text(encoding="utf-8")
        self.assertIn("function renderDailyNotices", app)
        self.assertIn("function deadlineState", app)
        self.assertIn(".daily-notice-list", styles)
        self.assertIn("overflow-x: hidden", styles)

    def test_published_notice_feed_excludes_non_physics_fields(self):
        notices = json.loads((ROOT / "data" / "notices.json").read_text(encoding="utf-8"))
        self.assertGreater(len(notices), 0)
        forbidden = [
            "生物", "医学", "医疗", "疾病", "癌症", "肿瘤", "药物", "细胞", "基因", "化学", "化工",
            "biology", "biomedical", "medicine", "medical", "chemistry", "chemical",
        ]
        for item in notices:
            with self.subTest(title=item.get("title")):
                value = " ".join([item.get("title", ""), item.get("summary", "")]).lower()
                self.assertFalse(any(term in value for term in forbidden))

        index = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        self.assertIn("只展示物理领域通知", index)
        self.assertIn("自动排除生物、医学和化学主题", index)


if __name__ == "__main__":
    unittest.main()
